import { SandboxWebSocket } from './websocket'
import { ApiClient, type ContainerDetails } from './api-client'

/**
 * Type guard to ensure exhaustive checks in switch statements
 * @internal
 * @param _value - Value that should never be reached
 * @throws {Error} Always throws an error if reached
 */
function exhaustiveGuard(_value: never): never {
	throw new Error(
		`ERROR! Reached forbidden guard function with unexpected value: ${JSON.stringify(_value)}`
	)
}

/**
 * Normalizes file paths for the sandbox environment
 * - Expands ~ to /home/damner/code
 * - Validates that path starts with either ~ or /home/damner/code
 * @internal
 * @param path - The input path (must start with ~ or /home/damner/code)
 * @returns Normalized path
 * @throws {Error} If path doesn't start with ~ or /home/damner/code
 */
function normalizePath(path: string): string {
	let normalizedPath

	if (path.startsWith('~')) {
		normalizedPath = path.replace(/^~/, '/home/damner/code')
	} else if (path.startsWith('/home/damner/code')) {
		normalizedPath = path
	} else {
		throw new Error(`Path must start with ~ or /home/damner/code. Got: "${path}".`)
	}

	return normalizedPath
}

/**
 * Main Sandbox class for managing code execution containers
 *
 * @remarks
 * This class provides a high-level interface to create, manage, and interact with
 * isolated code execution environments. It handles container provisioning,
 * WebSocket connections, file operations, and command execution.
 *
 * @example
 * ```typescript
 * // Create and connect to a new sandbox
 * const sandbox = new Sandbox({
 *   apiKey: 'your-api-key',
 *   gitRepoUrl: 'https://github.com/user/repo.git',
 *   shouldBackupFilesystem: true
 * })
 * await sandbox.connect()
 *
 * // Run commands
 * const result = await sandbox.runCommand({
 *   cmd: 'node',
 *   args: ['--version']
 * })
 * console.log(result.stdout)
 *
 * // Clean up
 * await sandbox.disconnect()
 * ```
 *
 * @public
 */
export class Sandbox {
	/** The active playground session identifier */
	private playgroundSessionId: string | null = null

	/** The playground snippet identifier */
	private playgroundSnippetId: string | null = null

	/** Container connection details including subdomain and access token */
	private containerDetails: ContainerDetails | null = null

	/** API key for authentication with the sandbox service */
	private apiKey: string | null = null

	/** Container provisioning timeout in milliseconds @defaultValue 30000 */
	private timeout = 30000

	/** WebSocket connection instance for real-time communication */
	private ws: SandboxWebSocket | null = null

	/**
	 * Creates a new Sandbox instance
	 *
	 * @remarks
	 * This constructor initializes the sandbox with configuration but does not
	 * establish a connection. Call connect() after construction to provision
	 * the container and establish the connection.
	 *
	 * @param options - Configuration options
	 * @param options.apiKey - API key for authentication with the sandbox service (required)
	 * @param options.gitRepoUrl - Optional git repository URL to clone during connection
	 * @param options.shouldBackupFilesystem - Whether to persist filesystem changes after shutdown (default: false)
	 *
	 * @example
	 * ```typescript
	 * // Basic sandbox
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.connect()
	 *
	 * // With git repository
	 * const sandbox = new Sandbox({
	 *   apiKey: 'your-api-key',
	 *   gitRepoUrl: 'https://github.com/user/repo.git',
	 *   shouldBackupFilesystem: true
	 * })
	 * await sandbox.connect()
	 * ```
	 *
	 * @public
	 */
	constructor({ apiKey }: { apiKey: string }) {
		this.apiKey = apiKey
	}

	/**
	 * Connects to the sandbox and initializes the container
	 *
	 * @remarks
	 * This method provisions a new container and establishes a connection. It:
	 * 1. Creates a playground snippet with the configured settings
	 * 2. Starts a playground session
	 * 3. Waits for container provisioning (polls until ready or timeout)
	 * 4. Establishes WebSocket connection to the container
	 * 5. Waits for container server to be ready
	 * 6. Clones the git repository if configured
	 *
	 * Call this method after constructing the Sandbox instance to establish
	 * the connection and begin using the sandbox.
	 *
	 * @returns Promise that resolves when the sandbox is fully connected and ready
	 *
	 * @throws {Error} If container provisioning times out (default: 30 seconds)
	 * @throws {Error} If session creation fails or requires attention
	 * @throws {Error} If WebSocket connection fails
	 * @throws {Error} If git clone fails (when gitRepoUrl is provided)
	 *
	 * @example
	 * ```typescript
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.connect()
	 * console.log('Sandbox ready!')
	 * ```
	 *
	 * @public
	 */
	async create({
		shouldBackupFilesystem = false,
		gitRepoUrl
	}: {
		shouldBackupFilesystem: boolean
		gitRepoUrl?: string
	}): Promise<string> {
		const api = new ApiClient(this.apiKey)

		const snippetData = await api.createPlaygroundSnippet({
			bootParams: {
				source: 'empty',
				shouldBackupFilesystem
			}
		})

		this.playgroundSnippetId = snippetData.playgroundSnippetId

		const sessionData = await api.startPlaygroundSession({
			playgroundSnippetId: this.playgroundSnippetId
		})

		if (sessionData.response.status === 'attention-needed') {
			switch (sessionData.response.attentionType) {
				case 'cannot-get-new':
					throw new Error('Cannot get new session')
				case 'can-terminate-and-get-new':
					throw new Error('Can terminate and get new session')
				case 'can-create-account-and-get-new':
					throw new Error('Can create account and get new session')
				default:
					exhaustiveGuard(sessionData.response.attentionType)
			}
		}

		this.playgroundSessionId = sessionData.response.playgroundSessionId

		const interval = 500
		const max = Math.ceil(this.timeout / interval)

		for (let i = 0; i < max; i++) {
			const detailsData = await api.getRunningPlaygroundSessionDetails({
				params: {
					playgroundSessionId: this.playgroundSessionId,
					isWaitingForUpscale: false,
					playgroundType: 'PlaygroundSnippet',
					playgroundSnippetId: this.playgroundSnippetId
				}
			})

			if (detailsData.response.isWaitingForUpscale === false) {
				this.containerDetails = detailsData.response.containerDetails

				// Establish WebSocket connection
				if (this.containerDetails != null) {
					if (this.isConnected()) {
						throw new Error('WebSocket already connected')
					} // TODO: check if we need to throw here
					const wsUrl = `wss://${this.containerDetails.subdomain}-13372.run-code.com`

					this.ws = new SandboxWebSocket({
						url: wsUrl,
						token: this.containerDetails.playgroundContainerAccessToken
					})
					await this.ws.connect()

					await this.ws.waitForNextFutureWebSocketEvent({
						eventType: 'ContainerServerReady',
						timeout: 10000
					})
				}

				if (gitRepoUrl != null && gitRepoUrl !== '') {
					const { exitCode } = await this.runStreamingCommand({
						cmd: 'git',
						args: ['clone', gitRepoUrl],
						onStdout: data => console.log(data.trim()),
						onStderr: data => console.log(data.trim())
					})
					console.log(`Git clone completed with exit code: ${exitCode}`)
				}
				return this.playgroundSnippetId
			}

			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	async fromSnippet(playgroundSnippetId: string) {
		const api = new ApiClient(this.apiKey)
		
		const sessionData = await api.startPlaygroundSession({
			playgroundSnippetId
		})

		if (sessionData.response.status === 'attention-needed') {
			switch (sessionData.response.attentionType) {
				case 'cannot-get-new':
					throw new Error('Cannot get new session')
				case 'can-terminate-and-get-new':
					throw new Error('Can terminate and get new session')
				case 'can-create-account-and-get-new':
					throw new Error('Can create account and get new session')
				default:
					exhaustiveGuard(sessionData.response.attentionType)
			}
		}

		this.playgroundSessionId = sessionData.response.playgroundSessionId
		const interval = 500
		const max = Math.ceil(this.timeout / interval)

		for (let i = 0; i < max; i++) {
			const detailsData = await api.getRunningPlaygroundSessionDetails({
				params: {
					playgroundSessionId: this.playgroundSessionId,
					isWaitingForUpscale: false,
					playgroundType: 'PlaygroundSnippet',
					playgroundSnippetId
				}
			})

			if (detailsData.response.isWaitingForUpscale === false) {
				this.containerDetails = detailsData.response.containerDetails
				// Establish WebSocket connection
				if (this.containerDetails != null) {
					if (this.isConnected()) {
						throw new Error('WebSocket already connected')
					} // TODO: check if we need to throw here
					const wsUrl = `wss://${this.containerDetails.subdomain}-13372.run-code.com`
					this.ws = new SandboxWebSocket({
						url: wsUrl,
						token: this.containerDetails.playgroundContainerAccessToken
					})
					await this.ws.connect()

					await this.ws.waitForNextFutureWebSocketEvent({
						eventType: 'ContainerServerReady',
						timeout: 10000
					}) 
				}
				return
			}

			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	/**
	 * Disconnects from the container and cleans up resources
	 *
	 * @remarks
	 * This closes the WebSocket connection and notifies the container server.
	 * Always call this when you're done with the sandbox to free up resources.
	 *
	 * @example
	 * ```typescript
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.connect()
	 * // ... do work ...
	 * await sandbox.disconnect()
	 * ```
	 *
	 * @public
	 */
	async disconnect(): Promise<void> {
		this.ws?.disableWsAutoReconnect()

		if (this.containerDetails != null) {
			const url = new URL(
				`https://${this.containerDetails.subdomain}-13372.run-code.com/disconnect-sandbox`
			)
			url.searchParams.append(
				'playground-container-access-token',
				this.containerDetails.playgroundContainerAccessToken
			)

			await fetch(url, { method: 'GET' })
		}

		this.ws?.disconnect()
		this.ws = null
	}

	/**
	 * Retrieves a file from the container filesystem
	 *
	 * @param path - Path to the file. Use ~ for home directory (e.g., "~/file.js") or absolute paths
	 * @returns Response object - use .text(), .arrayBuffer(), .blob(), etc.
	 *
	 * @throws {Error} If file is not found (404)
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If fetch fails
	 * @throws {Error} If path is not absolute (after ~ expansion)
	 *
	 * @example
	 * ```typescript
	 * // Get as text with tilde expansion
	 * const response = await sandbox.getFile('~/output.txt')
	 * const text = await response.text()
	 * console.log(text)
	 *
	 * // Get with absolute path
	 * const response = await sandbox.getFile('/home/damner/code/data.bin')
	 * const buffer = await response.arrayBuffer()
	 * ```
	 *
	 * @public
	 */
	async getFile(path: string): Promise<Response> {
		if (this.containerDetails != null) {
			const normalizedPath = normalizePath(path)

			const url = new URL(
				`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
			)
			url.searchParams.append('full-path', normalizedPath)
			url.searchParams.append(
				'playground-container-access-token',
				this.containerDetails.playgroundContainerAccessToken
			)

			const response = await fetch(url)

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error(`File not found: ${normalizedPath}`)
				}
				throw new Error(`Failed to get file: ${response.statusText}`)
			}

			return response
		} else {
			throw new Error('No container found')
		}
	}

	/**
	 * Writes a file to the container filesystem
	 *
	 * @param options - File write options
	 * @param options.path - Path where the file should be written. Use ~ for home directory (e.g., "~/script.js") or absolute paths
	 * @param options.content - File content as string or ArrayBuffer
	 *
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If write operation fails
	 * @throws {Error} If path is not absolute (after ~ expansion)
	 *
	 * @example
	 * ```typescript
	 * // Write text file with tilde expansion
	 * await sandbox.writeFile({
	 *   path: '~/script.js',
	 *   content: 'console.log("Hello")'
	 * })
	 *
	 * // Write with absolute path
	 * await sandbox.writeFile({
	 *   path: '/home/damner/code/data.bin',
	 *   content: new Uint8Array([1, 2, 3, 4]).buffer
	 * })
	 * ```
	 *
	 * @public
	 */
	async writeFile({
		path,
		content
	}: {
		path: string
		content: string | ArrayBuffer
	}): Promise<void> {
		if (this.containerDetails != null) {
			const normalizedPath = normalizePath(path)

			const url = new URL(
				`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
			)
			url.searchParams.append('full-path', normalizedPath)
			url.searchParams.append(
				'playground-container-access-token',
				this.containerDetails.playgroundContainerAccessToken
			)

			const response = await fetch(url, {
				method: 'PUT',
				body: content
			})

			if (!response.ok) {
				throw new Error(`Failed to set file: ${response.statusText}`)
			}
		} else {
			throw new Error('No container found')
		}
	}

	/**
	 * Executes a long-running command with streaming output
	 *
	 * @remarks
	 * Use this for commands that produce continuous output (e.g., build processes, servers, watchers).
	 * Callbacks are invoked as data arrives. The promise resolves when the command completes,
	 * returning the accumulated output and exit code.
	 *
	 * @param options - Command execution options
	 * @param options.cmd - Command to execute (e.g., 'npm', 'git', 'node')
	 * @param options.args - Command arguments as array
	 * @param options.stdin - Optional standard input to send to the command
	 * @param options.onStdout - Optional callback for stdout data chunks as they arrive
	 * @param options.onStderr - Optional callback for stderr data chunks as they arrive
	 *
	 * @returns Promise that resolves when command completes with stdout, stderr, and exitCode
	 *
	 * @throws {Error} If WebSocket is not connected
	 * @throws {Error} If command execution fails to start
	 *
	 * @example
	 * ```typescript
	 * const {stdout, stderr, exitCode} = await sandbox.runStreamingCommand({
	 *   cmd: 'npm',
	 *   args: ['install', 'express'],
	 *   onStdout: (data) => console.log(data.trim()),
	 *   onStderr: (data) => console.log(data.trim())
	 * })
	 * console.log('Exit code:', exitCode)
	 * ```
	 *
	 * @public
	 */
	async runStreamingCommand(options: {
		cmd: string
		args: string[]
		stdin?: string
		onStdout?: (stdout: string) => void
		onStderr?: (stderr: string) => void
	}): Promise<{
		stdout: string
		stderr: string
		exitCode: number
	}> {
		if (this.ws != null) {
			const startResponse = await this.ws.send({
				payload: {
					eventType: 'RunLongRunningCommand',
					data: {
						command: options.cmd,
						args: options.args,
						stdin: options.stdin
					}
				}
			})

			if (startResponse.eventType === 'RunLongRunningCommand') {
				const { uniqueTaskId } = startResponse.data

				return new Promise(resolve => {
					let stdout = ''
					let stderr = ''

					this.ws?.addStreamingTaskHandler({
						uniqueTaskId,
						handler: {
							onStdout: data => {
								stdout += data
								options.onStdout?.(data)
							},
							onStderr: data => {
								stderr += data
								options.onStderr?.(data)
							},
							onClose: exitCode => {
								resolve({ stdout, stderr, exitCode })
							}
						}
					})
				})
			} else {
				throw new Error('Unexpected response event type')
			}
		} else {
			throw new Error('Not connected')
		}
	}

	/**
	 * Executes a short command and waits for completion
	 *
	 * @remarks
	 * Use this for quick commands that complete within seconds (e.g., file operations, simple scripts).
	 * This command cannot run for more than 5 seconds.
	 * The promise resolves when the command finishes with both stdout and stderr.
	 * For long-running commands, use runStreamingCommand() instead.
	 *
	 * @param options - Command execution options
	 * @param options.cmd - Command to execute
	 * @param options.args - Optional command arguments
	 *
	 * @returns Promise with stdout and stderr strings
	 *
	 * @throws {Error} If WebSocket is not connected
	 * @throws {Error} If response type is unexpected
	 *
	 * @example
	 * ```typescript
	 * const result = await sandbox.runCommand({
	 *   cmd: 'ls',
	 *   args: ['-la', '/home/user']
	 * })
	 * console.log(result.stdout)
	 * console.log(result.stderr)
	 * ```
	 *
	 * @public
	 */
	async runCommand(options: { cmd: string; args?: string[] }): Promise<{
		stdout: string
		stderr: string
	}> {
		if (this.ws != null) {
			const fullCommand = options.args
				? `${options.cmd} ${options.args.join(' ')}`
				: options.cmd

			const response = await this.ws.send({
				payload: {
					eventType: 'EvalSmallCodeSnippetInsideContainer',
					command: fullCommand
				}
			})

			if (response.eventType === 'EvalSmallCodeSnippetInsideContainer') {
				return {
					stdout: response.stdout,
					stderr: response.stderr
				}
			} else {
				throw new Error('Unexpected response event type')
			}
		} else {
			throw new Error('Not connected')
		}
	}

	/**
	 * Gets the current playground session ID
	 * @returns The session ID or null if not initialized
	 * @public
	 */
	getSessionId(): string | null {
		return this.playgroundSessionId
	}

	/**
	 * Gets the container connection details
	 * @returns Container details including subdomain and access token, or null if not initialized
	 * @public
	 */
	getContainerDetails(): ContainerDetails | null {
		return this.containerDetails
	}

	/**
	 * Checks if the WebSocket connection is active
	 * @returns true if connected, false otherwise
	 * @public
	 */
	isConnected(): boolean {
		return this.ws?.isConnected() ?? false
	}

	/**
	 * Gets the public URL for a specific port
	 *
	 * @remarks
	 * The sandbox exposes certain ports publicly for running web servers and APIs.
	 * Supported ports: 3000, 1337, 1338
	 *
	 * @param port - Port number (must be 3000, 1337, or 1338)
	 * @returns Public HTTPS URL for the specified port
	 *
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If port is not supported
	 *
	 * @example
	 * ```typescript
	 * // Start a web server on port 3000
	 * await sandbox.setFile({
	 *   path: '/home/user/server.js',
	 *   content: `
	 *     const http = require('http');
	 *     http.createServer((req, res) => {
	 *       res.end('Hello World');
	 *     }).listen(3000);
	 *   `
	 * })
	 * await sandbox.runCommand({ cmd: 'node', args: ['server.js'] })
	 *
	 * // Get the public URL
	 * const url = sandbox.getPublicUrl(3000)
	 * console.log(`Server running at: ${url}`)
	 * // Output: https://abc123-3000.run-code.com
	 * ```
	 *
	 * @public
	 */
	async exposePort(port: 3000 | 1337 | 1338): Promise<string> {
		if (this.containerDetails != null) {
			return `https://${this.containerDetails.subdomain}-${port}.run-code.com`
		} else {
			throw new Error('No container found')
		}
	}

	/**
	 * Gets all available public URLs for the container
	 *
	 * @remarks
	 * Returns an object with public URLs for all supported ports (3000, 1337, 1338).
	 * These URLs are always available, but will only respond if a server is running on that port.
	 *
	 * @returns Object mapping port numbers to their public URLs
	 *
	 * @throws {Error} If container is not initialized
	 *
	 * @example
	 * ```typescript
	 * const urls = sandbox.getPublicUrls()
	 * console.log(urls)
	 * // Output:
	 * // {
	 * //   3000: 'https://abc123-3000.run-code.com',
	 * //   1337: 'https://abc123-1337.run-code.com',
	 * //   1338: 'https://abc123-1338.run-code.com'
	 * // }
	 * ```
	 *
	 * @public
	 */
	getPublicUrls(): { 3000: string; 1337: string; 1338: string } {
		if (this.containerDetails != null) {
			return {
				3000: `https://${this.containerDetails.subdomain}-3000.run-code.com`,
				1337: `https://${this.containerDetails.subdomain}-1337.run-code.com`,
				1338: `https://${this.containerDetails.subdomain}-1338.run-code.com`
			}
		} else {
			throw new Error('No container found')
		}
	}
}
