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
 * Main Sandbox class for managing code execution containers
 *
 * @remarks
 * This class provides a high-level interface to create, manage, and interact with
 * isolated code execution environments. It handles container provisioning,
 * WebSocket connections, file operations, and command execution.
 *
 * @example
 * ```typescript
 * // Create a new sandbox
 * const sandbox = await Sandbox.create({
 *   apiKey: 'your-api-key',
 *   gitRepoUrl: 'https://github.com/user/repo.git',
 *   shouldBackupFilesystem: true
 * })
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

	/** Git repository URL to clone on container initialization */
	private gitRepoUrl: string | null = null

	/** Whether to persist filesystem changes after container shutdown */
	private shouldBackupFilesystem: boolean | null = null

	/** API key for authentication with the sandbox service */
	private apiKey: string | null = null

	/** Container provisioning timeout in milliseconds @defaultValue 30000 */
	private timeout = 30000

	/** WebSocket connection instance for real-time communication */
	private ws: SandboxWebSocket | null = null

	/**
	 * Private constructor - use Sandbox.create() instead
	 * @param options - Configuration options
	 * @internal
	 */
	private constructor({
		gitRepoUrl,
		shouldBackupFilesystem,
		apiKey
	}: {
		gitRepoUrl?: string
		shouldBackupFilesystem?: boolean
		apiKey: string
	}) {
		this.gitRepoUrl = gitRepoUrl ?? ''
		this.shouldBackupFilesystem = shouldBackupFilesystem ?? false
		this.apiKey = apiKey
	}

	/**
	 * Creates and initializes a new Sandbox instance
	 *
	 * @remarks
	 * This is the primary way to create a sandbox. It handles:
	 * - Creating a playground snippet
	 * - Starting a playground session
	 * - Waiting for container provisioning
	 * - Establishing WebSocket connection
	 * - Optionally cloning a git repository
	 *
	 * @param options - Configuration options for the sandbox
	 * @param options.apiKey - API key for authentication (required)
	 * @param options.gitRepoUrl - Optional git repository URL to clone on startup
	 * @param options.shouldBackupFilesystem - Whether to persist filesystem after shutdown
	 *
	 * @returns A fully initialized Sandbox instance
	 *
	 * @throws {Error} If container provisioning times out (default: 30 seconds)
	 * @throws {Error} If session creation fails or requires attention
	 *
	 * @example
	 * ```typescript
	 * // Create a basic sandbox
	 * const sandbox = await Sandbox.create({ apiKey: 'your-key' })
	 *
	 * // Create sandbox with git repo
	 * const sandbox = await Sandbox.create({
	 *   apiKey: 'your-key',
	 *   gitRepoUrl: 'https://github.com/user/repo.git',
	 *   shouldBackupFilesystem: true
	 * })
	 * ```
	 *
	 * @public
	 */
	static async create({
		gitRepoUrl,
		shouldBackupFilesystem,
		apiKey
	}: {
		gitRepoUrl?: string
		shouldBackupFilesystem?: boolean
		apiKey: string
	}): Promise<Sandbox> {
		const sandbox = new Sandbox({ gitRepoUrl, shouldBackupFilesystem, apiKey })
		const api = new ApiClient(sandbox.apiKey)

		const snippetData = await api.createPlaygroundSnippet({
			bootParams: {
				source: 'empty',
				shouldBackupFilesystem: sandbox.shouldBackupFilesystem ?? false
			}
		})

		sandbox.playgroundSnippetId = snippetData.playgroundSnippetId

		const sessionData = await api.startPlaygroundSession({
			playgroundSnippetId: sandbox.playgroundSnippetId
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

		sandbox.playgroundSessionId = sessionData.response.playgroundSessionId

		const interval = 500
		const max = Math.ceil(sandbox.timeout / interval)

		for (let i = 0; i < max; i++) {
			const detailsData = await api.getRunningPlaygroundSessionDetails({
				params: {
					playgroundSessionId: sandbox.playgroundSessionId,
					isWaitingForUpscale: false,
					playgroundType: 'PlaygroundSnippet',
					playgroundSnippetId: sandbox.playgroundSnippetId
				}
			})

			if (detailsData.response.isWaitingForUpscale === false) {
				sandbox.containerDetails = detailsData.response.containerDetails
				await sandbox.connect()
				if (sandbox.gitRepoUrl != null && sandbox.gitRepoUrl !== '') {
					await sandbox.runStreamingCommand({
						cmd: 'git',
						args: ['clone', sandbox.gitRepoUrl],
						onStdout: data => console.log(data.trim()),
						onStderr: data => console.log(data.trim()),
						onClose: code => console.log(`Exit code: ${code}`)
					})
				}
				return sandbox
			}

			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	/**
	 * Establishes WebSocket connection to the container
	 *
	 * @remarks
	 * This method is called automatically by create(). You only need to call this
	 * manually if you've disconnected and want to reconnect.
	 *
	 * @throws {Error} If container details are not available
	 *
	 * @public
	 */
	async connect(): Promise<void> {
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
			}) // TODO: check timeout
		}
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
	 * const sandbox = await Sandbox.create({ apiKey: 'key' })
	 * // ... do work ...
	 * await sandbox.disconnect()
	 * ```
	 *
	 * @public
	 */
	async disconnect(): Promise<void> {
		this.ws?.disconnect()
		this.ws = null

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
	}

	/**
	 * Retrieves a file from the container filesystem
	 *
	 * @param path - Absolute path to the file in the container
	 * @returns File contents as ArrayBuffer
	 *
	 * @throws {Error} If file is not found (404)
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If fetch fails
	 *
	 * @example
	 * ```typescript
	 * const fileBuffer = await sandbox.getFile('/home/user/output.txt')
	 * const text = new TextDecoder().decode(fileBuffer)
	 * console.log(text)
	 * ```
	 *
	 * @public
	 */
	async getFile(path: string): Promise<ArrayBuffer> {
		if (this.containerDetails != null) {
			const url = new URL(
				`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
			)
			url.searchParams.append('full-path', path)
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

			const content = await response.arrayBuffer()
			return content
		} else {
			throw new Error('No container found')
		}
	}

	/**
	 * Writes a file to the container filesystem
	 *
	 * @param options - File write options
	 * @param options.path - Absolute path where the file should be written
	 * @param options.content - File content as string or ArrayBuffer
	 *
	 * @throws {Error} If container is not initialized
	 * @throws {Error} If write operation fails
	 *
	 * @example
	 * ```typescript
	 * // Write text file
	 * await sandbox.setFile({
	 *   path: '/home/user/script.js',
	 *   content: 'console.log("Hello")'
	 * })
	 *
	 * // Write binary file
	 * const buffer = new Uint8Array([1, 2, 3, 4]).buffer
	 * await sandbox.setFile({
	 *   path: '/home/user/data.bin',
	 *   content: buffer
	 * })
	 * ```
	 *
	 * @public
	 */
	async setFile({
		path,
		content
	}: {
		path: string
		content: string | ArrayBuffer
	}): Promise<void> {
		if (this.containerDetails != null) {
			const url = new URL(
				`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
			)
			url.searchParams.append('full-path', path)
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
	 * Callbacks are invoked as data arrives. The promise resolves immediately after the command starts,
	 * not when it finishes.
	 *
	 * @param options - Command execution options
	 * @param options.cmd - Command to execute (e.g., 'npm', 'git', 'node')
	 * @param options.args - Command arguments as array
	 * @param options.stdin - Optional standard input to send to the command
	 * @param options.onStdout - Callback for stdout data chunks
	 * @param options.onStderr - Callback for stderr data chunks
	 * @param options.onClose - Callback when command exits with exit code
	 *
	 * @throws {Error} If WebSocket is not connected
	 * @throws {Error} If command execution fails to start
	 *
	 * @example
	 * ```typescript
	 * await sandbox.runStreamingCommand({
	 *   cmd: 'npm',
	 *   args: ['install'],
	 *   onStdout: (data) => console.log('OUT:', data),
	 *   onStderr: (data) => console.error('ERR:', data),
	 *   onClose: (code) => console.log('Exit code:', code)
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
		onClose?: (exitCode: number) => void
	}): Promise<void> {
		if (this.ws != null) {
			const data: Record<string, string | string[]> = { command: options.cmd }
			data.args = options.args
			if (options.stdin != null) {
				data.stdin = options.stdin
			}

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

				this.ws.addStreamingTaskHandler({
					uniqueTaskId,
					handler: {
						onStdout: options.onStdout,
						onStderr: options.onStderr,
						onClose: options.onClose
					}
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
}
