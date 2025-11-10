import { SandboxWebSocket } from './websocket'
import {
	ApiClient,
	type ContainerDetails,
	type RunConfig,
	type DecodedRunResult,
	type DsaCodeExecutionEntry
} from './api-client'

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
 * Encodes a string to Base64URL format (URL-safe Base64)
 * Base64URL encoding replaces + with -, / with _, and removes padding =
 * @param str - String to encode
 * @returns Base64URL encoded string
 * @public
 */
export function encodeBase64Url(str: string): string {
	// Node.js Buffer for base64 encoding
	const base64 = Buffer.from(str, 'utf-8').toString('base64')
	// Convert to URL-safe Base64URL format
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Decodes a Base64URL string to a regular string
 * @param base64Url - Base64URL encoded string
 * @returns Decoded string
 * @internal
 */
function decodeBase64Url(base64Url: string): string {
	// Convert from URL-safe Base64URL to standard Base64
	let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
	// Add padding if needed
	while (base64.length % 4 !== 0) {
		base64 += '='
	}
	// Decode from base64
	return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * Normalizes a file path by expanding ~ to /home/damner
 *
 * @remarks
 * Paths must start with either ~ or /home/damner. The ~ character is expanded
 * to /home/damner to create an absolute path.
 *
 * @param path - File path starting with ~ or /home/damner
 * @returns Normalized absolute path
 * @throws {Error} If path doesn't start with ~ or /home/damner
 * @internal
 */
function normalizePath(path: string): string {
	let normalizedPath

	if (path.startsWith('~')) {
		normalizedPath = path.replace('~', '/home/damner')
	} else if (path.startsWith('/home/damner')) {
		normalizedPath = path
	} else {
		throw new Error(`Invalid path: ${path}. Path must start with ~ or /home/damner`)
	}

	return normalizedPath
}

/**
 * Main Sandbox class for managing isolated code execution containers
 *
 * @remarks
 * The Sandbox class provides a complete interface for creating, managing, and interacting with
 * secure, isolated code execution environments. Each sandbox runs in a containerized environment
 * with its own filesystem, process space, and network isolation. Sandboxes support real-time
 * command execution, file operations, and web server hosting.
 *
 * Key features:
 * - Isolated Linux containers for secure code execution
 * - Real-time WebSocket communication for streaming output
 * - File system operations (read/write)
 * - Git repository cloning during initialization
 * - Public URL exposure for web servers (ports 3000, 1337, 1338)
 * - Persistent filesystem snapshots (optional)
 *
 * @example
 * ```typescript
 * // Basic usage - create and connect to a new sandbox
 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
 * await sandbox.create({ shouldBackupFilesystem: false })
 *
 * // Run a simple command
 * const result = await sandbox.runCommand({
 *   cmd: 'node',
 *   args: ['--version']
 * })
 * console.log('Node version:', result.stdout)
 *
 * // Write and execute a file
 * await sandbox.writeFile({
 *   path: '~/hello.js',
 *   content: 'console.log("Hello from sandbox!")'
 * })
 * // Note: Use absolute path for node command since it doesn't expand ~
 * const output = await sandbox.runCommand({
 *   cmd: 'node',
 *   args: ['/home/damner/hello.js']
 * })
 *
 * // Clean up when done
 * await sandbox.disconnect()
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage with git repository
 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
 * await sandbox.create({
 *   gitRepoUrl: 'https://github.com/user/repo.git',
 *   shouldBackupFilesystem: true
 * })
 *
 * // Install dependencies with streaming output
 * await sandbox.runStreamingCommand({
 *   cmd: 'npm',
 *   args: ['install'],
 *   onStdout: (data) => process.stdout.write(data),
 *   onStderr: (data) => process.stderr.write(data)
 * })
 *
 * // Start a web server and get public URL
 * await sandbox.runStreamingCommand({
 *   cmd: 'npm',
 *   args: ['start']
 * })
 * const url = await sandbox.exposePort(3000)
 * console.log('Server available at:', url)
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
	 * This constructor initializes the sandbox client with your API key.
	 * After construction, call either create() to provision a new container
	 * or fromSnippet() to connect to an existing playground snippet.
	 *
	 * @param options - Configuration options
	 * @param options.apiKey - API key for authentication with the Fermion sandbox service (required)
	 *
	 * @example
	 * ```typescript
	 * // Initialize sandbox client
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 *
	 * // Then create a new container
	 * await sandbox.create({ shouldBackupFilesystem: false })
	 *
	 * // Or connect to existing snippet
	 * await sandbox.fromSnippet('snippet-id-here')
	 * ```
	 *
	 * @public
	 */
	constructor({ apiKey }: { apiKey: string }) {
		this.apiKey = apiKey
	}

	/**
	 * Creates a new sandbox container and establishes connection
	 *
	 * @remarks
	 * This method provisions a new container from scratch and establishes a WebSocket connection.
	 * The process includes:
	 * 1. Creating a new playground snippet with the specified settings
	 * 2. Starting a playground session for that snippet
	 * 3. Waiting for container provisioning (polls until ready or timeout)
	 * 4. Establishing WebSocket connection to the container
	 * 5. Waiting for container server to be ready
	 * 6. Cloning the git repository if provided
	 *
	 * Use this method to create a fresh sandbox environment. For connecting to an
	 * existing playground snippet, use fromSnippet() instead.
	 *
	 * @param options - Container creation options
	 * @param options.shouldBackupFilesystem - Whether to persist filesystem changes after shutdown (default: false)
	 * @param options.gitRepoUrl - Optional git repository URL to clone after container is ready
	 *
	 * @returns Promise that resolves with the playground snippet ID when the sandbox is ready
	 *
	 * @throws {Error} If WebSocket is already connected
	 * @throws {Error} If container provisioning times out (default: 30 seconds)
	 * @throws {Error} If session creation fails or requires attention
	 * @throws {Error} If WebSocket connection fails
	 * @throws {Error} If git clone fails (when gitRepoUrl is provided)
	 *
	 * @example
	 * ```typescript
	 * // Create basic sandbox
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * const { playgroundSnippetId } = await sandbox.create({ shouldBackupFilesystem: false })
	 * console.log('Created sandbox with snippet ID:', playgroundSnippetId)
	 *
	 * // Create sandbox with git repository
	 * const { playgroundSnippetId } = await sandbox.create({
	 *   shouldBackupFilesystem: true,
	 *   gitRepoUrl: 'https://github.com/user/repo.git'
	 * })
	 * ```
	 *
	 * @public
	 */
	async create({
		shouldBackupFilesystem,
		gitRepoUrl
	}: {
		shouldBackupFilesystem: boolean
		gitRepoUrl?: string
	}): Promise<{ playgroundSnippetId: string }> {
		if (this.isConnected()) {
			throw new Error('WebSocket already connected')
		}
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
				return { playgroundSnippetId: this.playgroundSnippetId }
			}

			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	/**
	 * Connects to an existing sandbox using a playground snippet ID
	 *
	 * @remarks
	 * This method connects to an existing playground snippet that was previously created.
	 * Use this to reconnect to a sandbox that has persistent filesystem enabled, or to
	 * share sandbox environments between different sessions or users.
	 *
	 * The connection process includes:
	 * 1. Starting a new session for the existing snippet
	 * 2. Waiting for container provisioning
	 * 3. Establishing WebSocket connection
	 * 4. Waiting for container server to be ready
	 *
	 * @param options - Connection options
	 * @param options.playgroundSnippetId - The ID of an existing playground snippet
	 *
	 * @returns Promise that resolves when connected to the sandbox
	 *
	 * @throws {Error} If container provisioning times out (default: 30 seconds)
	 * @throws {Error} If session creation fails or requires attention
	 * @throws {Error} If the snippet ID is invalid or not found
	 * @throws {Error} If WebSocket connection fails
	 * @throws {Error} If WebSocket is already connected
	 *
	 * @example
	 * ```typescript
	 * // Connect to existing sandbox
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.fromSnippet({ playgroundSnippetId: 'existing-snippet-id' })
	 *
	 * // Now you can use the sandbox
	 * const result = await sandbox.runCommand({ cmd: 'ls', args: ['-la'] })
	 * console.log(result.stdout)
	 * ```
	 *
	 * @public
	 */
	async fromSnippet({ playgroundSnippetId }: { playgroundSnippetId: string }) {
		if (this.isConnected()) {
			throw new Error('WebSocket already connected')
		}
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
	 * @returns Promise that resolves when disconnection is complete
	 *
	 * @throws {Error} If not connected to sandbox
	 *
	 * @example
	 * ```typescript
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.create({ shouldBackupFilesystem: false })
	 * // ... do work ...
	 * await sandbox.disconnect()
	 * ```
	 *
	 * @public
	 */
	async disconnect(): Promise<void> {
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
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
	 * @remarks
	 * The path is normalized automatically: ~ is expanded to /home/damner.
	 * Paths must start with either ~ or /home/damner.
	 *
	 * @param path - Path to the file (must start with ~ or /home/damner)
	 * @returns Response object - use .text(), .arrayBuffer(), .blob(), etc.
	 *
	 * @throws {Error} If file is not found (404)
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If path is invalid (doesn't start with ~ or /home/damner)
	 * @throws {Error} If not connected to sandbox
	 * @throws {Error} If fetch fails
	 *
	 * @example
	 * ```typescript
	 * // Get as text using ~ path (automatically normalized)
	 * const response = await sandbox.getFile('~/output.txt')
	 * const text = await response.text()
	 * console.log(text)
	 *
	 * // Get with absolute path
	 * const response = await sandbox.getFile('/home/damner/data.bin')
	 * const buffer = await response.arrayBuffer()
	 * ```
	 *
	 * @public
	 */
	async getFile(path: string): Promise<Response> {
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
		const normalizedPath = normalizePath(path)
		if (this.containerDetails != null) {
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
					throw new Error(`File not found: ${path}`)
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
	 * @remarks
	 * The path is normalized automatically: ~ is expanded to /home/damner.
	 * Paths must start with either ~ or /home/damner.
	 *
	 * @param options - File write options
	 * @param options.path - Path where the file should be written (must start with ~ or /home/damner)
	 * @param options.content - File content as string or ArrayBuffer
	 *
	 * @returns Promise that resolves when the file is written
	 *
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If path is invalid (doesn't start with ~ or /home/damner)
	 * @throws {Error} If not connected to sandbox
	 * @throws {Error} If write operation fails
	 *
	 * @example
	 * ```typescript
	 * // Write text file using ~ path (automatically normalized)
	 * await sandbox.writeFile({
	 *   path: '~/script.js',
	 *   content: 'console.log("Hello")'
	 * })
	 *
	 * // Write with absolute path
	 * await sandbox.writeFile({
	 *   path: '/home/damner/data.bin',
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
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}

		const normalizedPath = normalizePath(path)

		if (this.containerDetails != null) {
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
				const errorText = await response.text().catch(() => response.statusText)
				throw new Error(`Failed to set file: ${response.statusText} - ${errorText}`)
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
	 * Note: Paths in command arguments are NOT automatically normalized. If you need to use paths
	 * with ~, use absolute paths (/home/damner/...) or wrap the command in a shell that expands ~.
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
	 * @throws {Error} If not connected to sandbox
	 * @throws {Error} If command execution fails to start
	 * @throws {Error} If unexpected response event type is received
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
	 *
	 * // Use absolute paths for file arguments
	 * await sandbox.runStreamingCommand({
	 *   cmd: 'node',
	 *   args: ['/home/damner/script.js'],
	 *   onStdout: (data) => console.log(data)
	 * })
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
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
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
	 * Note: Paths in command arguments are NOT automatically normalized. If you need to use paths
	 * with ~, use absolute paths (/home/damner/...) or wrap the command in a shell that expands ~.
	 *
	 * @param options - Command execution options
	 * @param options.cmd - Command to execute
	 * @param options.args - Optional command arguments
	 *
	 * @returns Promise with stdout and stderr strings
	 *
	 * @throws {Error} If WebSocket is not connected
	 * @throws {Error} If not connected to sandbox
	 * @throws {Error} If response type is unexpected
	 *
	 * @example
	 * ```typescript
	 * const result = await sandbox.runCommand({
	 *   cmd: 'ls',
	 *   args: ['-la', '/home/damner']
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
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
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
	 * The sandbox automatically exposes certain ports publicly for running web servers and APIs.
	 * Any service running on these ports inside the container will be accessible via HTTPS.
	 * Supported ports: 3000, 1337, 1338
	 *
	 * @param port - Port number (must be 3000, 1337, or 1338)
	 * @returns Promise that resolves with the public HTTPS URL for the specified port
	 *
	 * @throws {Error} If not connected to sandbox
	 * @throws {Error} If container is not initialized
	 *
	 * @example
	 * ```typescript
	 * // Start a web server on port 3000
	 * await sandbox.writeFile({
	 *   path: '~/server.js',
	 *   content: `
	 *     const http = require('http');
	 *     http.createServer((req, res) => {
	 *       res.writeHead(200, {'Content-Type': 'text/plain'});
	 *       res.end('Hello World');
	 *     }).listen(3000);
	 *     console.log('Server running on port 3000');
	 *   `
	 * })
	 *
	 * // Start the server in the background
	 * // Note: Use absolute path since node doesn't expand ~
	 * sandbox.runStreamingCommand({
	 *   cmd: 'node',
	 *   args: ['/home/damner/server.js'],
	 *   onStdout: (data) => console.log(data)
	 * })
	 *
	 * // Get the public URL
	 * const url = await sandbox.exposePort(3000)
	 * console.log(`Server accessible at: ${url}`)
	 * // Output: https://abc123-3000.run-code.com
	 * ```
	 *
	 * @public
	 */
	async exposePort(port: 3000 | 1337 | 1338): Promise<string> {
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
		if (this.containerDetails != null) {
			return `https://${this.containerDetails.subdomain}-${port}.run-code.com`
		} else {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
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
	 * @throws {Error} If container is not initialized (no container details available)
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

	/**
	 * Executes code using the DSA execution API and returns the results
	 *
	 * @remarks
	 * This method provides a simple way to execute code in various languages without
	 * needing to set up a full sandbox container. It uses Fermion's DSA execution API
	 * which handles code compilation and execution in isolated environments.
	 *
	 * The method:
	 * 1. Submits the code for execution (source code, stdin, and expected output are automatically Base64URL encoded)
	 * 2. Polls for results until execution completes (500ms intervals, max 60 attempts = 30 seconds)
	 * 3. Returns the execution results with stdout/stderr automatically decoded from Base64URL
	 *
	 * Note: This method requires a sandbox connection (call create() or fromSnippet() first),
	 * but it doesn't actually use the container - it uses the DSA execution API directly.
	 *
	 * @param options - Code execution options
	 * @param options.runtime - Programming language runtime (C, C++, Java, Python, Node.js, SQLite, MySQL, Go, Rust, .NET)
	 * @param options.sourceCode - Source code to execute (will be Base64URL encoded automatically)
	 * @param options.stdin - Optional standard input for the program (will be Base64URL encoded automatically)
	 * @param options.expectedOutput - Optional expected output for validation (will be Base64URL encoded automatically)
	 * @param options.additionalFilesAsZip - Optional Base64URL-encoded zip file containing additional files needed for execution
	 *
	 * @returns Promise that resolves with the execution result containing:
	 *   - runStatus: Execution status (e.g., "successful", "wrong-answer", "time-limit-exceeded")
	 *   - programRunData: Object with decoded stdout/stderr (as strings, not Base64URL), exit code, resource usage
	 *   - compilerOutputAfterCompilation: Decoded compiler output (as string, not Base64URL) or null
	 *   - finishedAt: Timestamp when execution finished
	 *
	 * @throws {Error} If not connected to sandbox (requires create() or fromSnippet() to be called first)
	 * @throws {Error} If code submission fails
	 * @throws {Error} If polling timeout is reached (30 seconds / 60 attempts)
	 * @throws {Error} If no task ID is returned from execution request
	 * @throws {Error} If no result is returned from result request
	 * @throws {Error} If execution finished but no result was returned
	 *
	 * @example
	 * ```typescript
	 * // Simple Python execution
	 * const sandbox = new Sandbox({ apiKey: 'your-api-key' })
	 * await sandbox.create({ shouldBackupFilesystem: false })
	 * const result = await sandbox.quickRun({
	 *   runtime: 'Python',
	 *   sourceCode: 'print("Hello, World!")'
	 * })
	 * // stdout/stderr are already decoded - no need to decode manually
	 * console.log(result.programRunData?.stdout) // "Hello, World!\n"
	 * console.log(result.runStatus) // "successful"
	 *
	 * // C++ with input and expected output
	 * const result = await sandbox.quickRun({
	 *   runtime: 'C++',
	 *   sourceCode: `
	 *     #include <iostream>
	 *     using namespace std;
	 *     int main() {
	 *       int a, b;
	 *       cin >> a >> b;
	 *       cout << a + b << endl;
	 *       return 0;
	 *     }
	 *   `,
	 *   stdin: '5 3',
	 *   expectedOutput: '8'
	 * })
	 * console.log(result.runStatus) // "successful" or "wrong-answer"
	 * console.log(result.programRunData?.stdout) // "8\n" (already decoded)
	 *
	 * // Go with additional files
	 * const result = await sandbox.quickRun({
	 *   runtime: 'Go',
	 *   sourceCode: 'package main\nimport "fmt"\nfunc main() { fmt.Println("Hello") }',
	 *   additionalFilesAsZip: 'base64url-encoded-zip-content'
	 * })
	 * ```
	 *
	 * @public
	 */
	async quickRun(options: {
		runtime:
			| 'C'
			| 'C++'
			| 'Java'
			| 'Python'
			| 'Node.js'
			| 'SQLite'
			| 'MySQL'
			| 'Go'
			| 'Rust'
			| '.NET'
		sourceCode: string
		stdin?: string
		expectedOutput?: string
		additionalFilesAsZip?: string
	}): Promise<DecodedRunResult> {
		if (!this.isConnected()) {
			throw new Error(
				'Not connected to sandbox. Please call create() or fromSnippet() first.'
			)
		}
		const api = new ApiClient(this.apiKey)

		const runtimeMap: Record<string, DsaCodeExecutionEntry['language']> = {
			C: 'C',
			'C++': 'Cpp',
			Java: 'Java',
			Python: 'Python',
			'Node.js': 'Nodejs',
			SQLite: 'Sqlite_3_48_0',
			Go: 'Golang_1_19',
			Rust: 'Rust_1_87',
			'.NET': 'Dotnet_8',
			MySQL: 'Mysql_8'
		}

		const runtime: DsaCodeExecutionEntry['language'] = runtimeMap[options.runtime]
		const sourceCodeEncoded = encodeBase64Url(options.sourceCode)
		const stdinEncoded = options.stdin != null ? encodeBase64Url(options.stdin) : ''
		const expectedOutputEncoded =
			options.expectedOutput != null ? encodeBase64Url(options.expectedOutput) : ''

		const runConfig: RunConfig = {
			customMatcherToUseForExpectedOutput: 'ExactMatch',
			expectedOutputAsBase64UrlEncoded: expectedOutputEncoded,
			stdinStringAsBase64UrlEncoded: stdinEncoded,
			shouldEnablePerProcessAndThreadCpuTimeLimit: false,
			shouldEnablePerProcessAndThreadMemoryLimit: false,
			shouldAllowInternetAccess: false,
			compilerFlagString: '',
			maxFileSizeInKilobytesFilesCreatedOrModified: 51200,
			stackSizeLimitInKilobytes: 65536,
			cpuTimeLimitInMilliseconds: 2000,
			wallTimeLimitInMilliseconds: 5000,
			memoryLimitInKilobyte: 512000,
			maxProcessesAndOrThreads: 60
		}

		const executionResponse = await api.requestDsaExecution({
			entries: [
				{
					language: runtime,
					runConfig,
					sourceCodeAsBase64UrlEncoded: sourceCodeEncoded,
					additionalFilesAsZip: options.additionalFilesAsZip
						? {
								type: 'base64url-encoding',
								base64UrlEncodedZip: options.additionalFilesAsZip
							}
						: undefined
				}
			]
		})

		const taskId = executionResponse.taskIds[0]
		if (!taskId) {
			throw new Error('No task ID returned from execution request')
		}

		const pollInterval = 500
		const maxAttempts = 60

		for (let i = 0; i < maxAttempts; i++) {
			const resultResponse = await api.getDsaExecutionResult({
				taskUniqueIds: [taskId]
			})

			const result = resultResponse.tasks[0]
			if (!result) {
				throw new Error('No result returned from result request')
			}

			if (result.codingTaskStatus === 'Finished') {
				if (!result.runResult) {
					throw new Error('Execution finished but no result was returned')
				}
				const runResult: DecodedRunResult = {
					runStatus: result.runResult.runStatus,
					compilerOutputAfterCompilation:
						result.runResult.compilerOutputAfterCompilationBase64UrlEncoded != null
							? decodeBase64Url(
									result.runResult.compilerOutputAfterCompilationBase64UrlEncoded
								)
							: null,
					finishedAt: result.runResult.finishedAt,
					programRunData: result.runResult.programRunData
						? {
								stdout: decodeBase64Url(
									result.runResult.programRunData.stdoutBase64UrlEncoded ?? ''
								),
								stderr: decodeBase64Url(
									result.runResult.programRunData.stderrBase64UrlEncoded ?? ''
								),
								exitCode: result.runResult.programRunData.exitCode,
								cpuTimeUsedInMilliseconds:
									result.runResult.programRunData.cpuTimeUsedInMilliseconds,
								wallTimeUsedInMilliseconds:
									result.runResult.programRunData.wallTimeUsedInMilliseconds,
								memoryUsedInKilobyte:
									result.runResult.programRunData.memoryUsedInKilobyte,
								exitSignal: result.runResult.programRunData.exitSignal
							}
						: null
				}
				return runResult
			}

			await new Promise(resolve => setTimeout(resolve, pollInterval))
		}

		throw new Error(`Polling timeout: Execution did not complete after ${maxAttempts} attempts`)
	}
}
