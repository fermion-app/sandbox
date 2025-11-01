import WebSocket from 'ws'
import { nanoid } from 'nanoid'
import { type WebSocketRequestPayload, type WebSocketResponsePayload } from './constants'

/**
 * Utility class for creating a promise that can be resolved/rejected externally
 * @internal
 * @typeParam T - The type of value the promise will resolve to
 */
class DeferredPromise<T> {
	promise: Promise<T>
	reject: null | ((reason?: unknown) => void)
	resolve: null | ((value: T) => void)

	constructor() {
		this.reject = null
		this.resolve = null
		this.promise = new Promise((resolve, reject) => {
			this.reject = reject
			this.resolve = resolve
		})
	}
}

/**
 * Structure of a WebSocket message sent to the container
 * @public
 */
export interface WebSocketMessage {
	/** Unique identifier for tracking request-response pairs */
	messageId: string
	/** The actual payload containing the event type and data */
	payload: WebSocketRequestPayload
}

/**
 * WebSocket client for real-time communication with sandbox containers
 *
 * @remarks
 * This class handles:
 * - Connection management with automatic reconnection
 * - Request-response pattern with message ID tracking
 * - Event-based messaging for streaming tasks
 * - Health ping to keep connections alive
 * - Message queuing when disconnected
 *
 * @example
 * ```typescript
 * const ws = new SandboxWebSocket({
 *   url: 'wss://container.run-code.com',
 *   token: 'access-token'
 * })
 * await ws.connect()
 *
 * const response = await ws.send({
 *   payload: { eventType: 'EvalSmallCodeSnippetInsideContainer', command: 'ls' }
 * })
 * ```
 *
 * @public
 */
export class SandboxWebSocket {
	private ws: WebSocket | null = null
	private url: string
	private token: string
	private messageIdToWebSocketResponsePromiseMapping = new Map<
		string,
		{
			deferredPromise: DeferredPromise<WebSocketResponsePayload>
			timeoutId: NodeJS.Timeout
		}
	>()
	private waitQueueToEventTypePromiseMapping = new Map<
		string,
		{
			deferredPromise: DeferredPromise<WebSocketResponsePayload>
			timeoutId: NodeJS.Timeout
		}
	>()
	private messagesData: string[] = []
	private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
	private shouldAutoReconnect = true
	private healthPingTimeoutId: NodeJS.Timeout | null = null
	private streamingTaskHandlers = new Map<
		string,
		{
			onStdout?: (stdout: string) => void
			onStderr?: (stderr: string) => void
			onClose?: (exitCode: number) => void
		}
	>()

	/**
	 * Creates a new SandboxWebSocket instance
	 * @param options - Connection configuration
	 * @param options.url - WebSocket URL (e.g., wss://subdomain-13372.run-code.com)
	 * @param options.token - Authentication token for the container
	 */
	constructor({ url, token }: { url: string; token: string }) {
		this.url = url
		this.token = token
	}

	/**
	 * Establishes WebSocket connection to the container
	 *
	 * @remarks
	 * This method:
	 * - Sets up event listeners (open, message, error, close)
	 * - Enables automatic reconnection on disconnect
	 * - Starts health ping mechanism
	 * - Flushes any queued messages
	 *
	 * @returns Promise that resolves when connection is established
	 * @throws {Error} If connection fails
	 *
	 * @private
	 */
	async connect(): Promise<void> {
		if (this.connectionState !== 'connected') {
			return new Promise((resolve, reject) => {
				try {
					this.connectionState = 'connecting'
					const wsUrl = `${this.url}?token=${encodeURIComponent(this.token)}`
					this.ws = new WebSocket(wsUrl)

					this.ws.on('open', () => {
						this.onOpen()
						resolve()
					})

					this.ws.on('message', (data: Buffer) => {
						this.onMessage(data.toString())
					})

					this.ws.on('error', error => {
						this.onError(error)
						if (this.connectionState === 'connecting') {
							reject(new Error('Failed to connect to WebSocket'))
						}
					})

					this.ws.on('close', () => {
						void this.onClose()
					})
				} catch {
					this.connectionState = 'disconnected'
					reject(new Error('Failed to connect to WebSocket'))
				}
			})
		}
	}

	/**
	 * Sends a message to the container and waits for response
	 *
	 * @remarks
	 * Uses a request-response pattern with message IDs to match requests with responses.
	 * If no response is received within the timeout period, the promise rejects.
	 *
	 * @param options - Send options
	 * @param options.payload - The message payload to send
	 * @param options.options - Optional configuration
	 * @param options.options.timeout - Timeout in milliseconds (default: 30000)
	 *
	 * @returns Promise resolving to the response payload
	 * @throws {Error} If request times out
	 *
	 * @example
	 * ```typescript
	 * const response = await ws.send({
	 *   payload: {
	 *     eventType: 'EvalSmallCodeSnippetInsideContainer',
	 *     command: 'pwd'
	 *   },
	 *   options: { timeout: 5000 }
	 * })
	 * ```
	 *
	 * @public
	 */
	async send({
		payload,
		options = { timeout: 30000 }
	}: {
		payload: WebSocketRequestPayload
		options?: { timeout?: number }
	}): Promise<WebSocketResponsePayload> {
		const timeout = options.timeout
		const { messageId, rawMessage } = this.constructRawWebSocketMessage(payload)
		const deferredPromise = new DeferredPromise<WebSocketResponsePayload>()

		const timeoutId = setTimeout(() => {
			this.messageIdToWebSocketResponsePromiseMapping.delete(messageId)
			deferredPromise.reject?.(new Error(`Request timeout for ${payload.eventType}`))
		}, timeout)

		this.messageIdToWebSocketResponsePromiseMapping.set(messageId, {
			deferredPromise,
			timeoutId
		})

		this.sendSingleMessage(rawMessage)

		return deferredPromise.promise
	}

	/**
	 * Waits for a specific event type to arrive
	 *
	 * @remarks
	 * This is useful for waiting for server-initiated events (e.g., ContainerServerReady).
	 * Unlike send(), this doesn't send a message - it just waits for an event to arrive.
	 * If a wait for the same event type already exists, the old one is cancelled.
	 *
	 * @param options - Wait options
	 * @param options.eventType - The event type to wait for
	 * @param options.timeout - Timeout in milliseconds (default: 30000)
	 *
	 * @returns Promise resolving when the event arrives
	 * @throws {Error} If timeout is reached
	 * @throws {Error} If replaced by another wait for the same event type
	 *
	 * @example
	 * ```typescript
	 * await ws.waitForNextFutureWebSocketEvent({
	 *   eventType: 'ContainerServerReady',
	 *   timeout: 10000
	 * })
	 * ```
	 *
	 * @public
	 */
	waitForNextFutureWebSocketEvent({
		eventType,
		timeout = 30000
	}: {
		eventType: string
		timeout?: number
	}): Promise<WebSocketResponsePayload> {
		const deferredPromise = new DeferredPromise<WebSocketResponsePayload>()

		const existing = this.waitQueueToEventTypePromiseMapping.get(eventType)
		if (existing != null) {
			existing.deferredPromise.reject?.(new Error('Replaced by new wait'))
		} // TODO: check if we need to throw here instead

		this.waitQueueToEventTypePromiseMapping.set(eventType, {
			deferredPromise,
			timeoutId: setTimeout(() => {
				this.waitQueueToEventTypePromiseMapping.delete(eventType)
				deferredPromise.reject?.(new Error(`Timeout waiting for event: ${eventType}`))
			}, timeout)
		})

		return deferredPromise.promise
	}

	/**
	 * Registers callbacks for a streaming command's output
	 *
	 * @remarks
	 * Used for long-running commands that stream their output.
	 * The callbacks are invoked as stdout/stderr data arrives and when the command exits.
	 *
	 * @param options - Handler configuration
	 * @param options.uniqueTaskId - Unique ID for the running task
	 * @param options.handler - Callback functions
	 * @param options.handler.onStdout - Called when stdout data arrives
	 * @param options.handler.onStderr - Called when stderr data arrives
	 * @param options.handler.onClose - Called when command exits with exit code
	 *
	 * @example
	 * ```typescript
	 * ws.addStreamingTaskHandler({
	 *   uniqueTaskId: 'task-123',
	 *   handler: {
	 *     onStdout: (data) => console.log(data),
	 *     onStderr: (data) => console.error(data),
	 *     onClose: (code) => console.log('Exit:', code)
	 *   }
	 * })
	 * ```
	 *
	 * @public
	 */
	addStreamingTaskHandler({
		uniqueTaskId,
		handler
	}: {
		uniqueTaskId: string
		handler: {
			onStdout?: (stdout: string) => void
			onStderr?: (stderr: string) => void
			onClose?: (exitCode: number) => void
		}
	}): void {
		this.streamingTaskHandlers.set(uniqueTaskId, handler)
	}

	/**
	 * Disconnects from the container
	 *
	 * @remarks
	 * This disables automatic reconnection and cleans up all resources,
	 * including pending promises and event listeners.
	 *
	 * @public
	 */
	disconnect(): void {
		this.cleanDirtyWebSocketIfPresent()
	}

	/**
	 * Disables automatic WebSocket reconnection
	 *
	 * @remarks
	 * Call this before disconnecting if you don't want the WebSocket to
	 * automatically attempt to reconnect after a disconnect. This is useful
	 * when intentionally shutting down the connection.
	 *
	 * @internal
	 */
	async disableWsAutoReconnect() {
		this.shouldAutoReconnect = false
	}

	/**
	 * Checks if the WebSocket is currently connected
	 * @returns true if connected, false otherwise
	 * @public
	 */
	isConnected(): boolean {
		return this.connectionState === 'connected'
	}

	private onOpen(): void {
		this.connectionState = 'connected'

		const queue = [...this.messagesData]
		this.messagesData = []

		if (queue.length > 0) {
			for (const message of queue) {
				this.sendSingleMessage(message)
			}
		}

		this.startHealthPing()
	}

	private startHealthPing(): void {
		if (this.healthPingTimeoutId != null) {
			clearTimeout(this.healthPingTimeoutId)
			this.healthPingTimeoutId = null
		}

		const sendHealthPing = (): void => {
			if (this.connectionState === 'connected') {
				this.send({ payload: { eventType: 'HealthPing' } }).catch(error => {
					console.error('[SandboxWebSocket] Health ping failed', error)
				})

				this.healthPingTimeoutId = setTimeout(sendHealthPing, 10000) // TODO: check timeout
			}
		}

		this.healthPingTimeoutId = setTimeout(sendHealthPing, 5000) // TODO: check timeout
	}

	private onMessage(rawData: string): void {
		const message = JSON.parse(rawData)
		const { messageId, payload } = message

		if (payload.eventType === 'StreamLongRunningTaskEvent') {
			const { uniqueTaskId, eventDetails } = payload
			const handler = this.streamingTaskHandlers.get(uniqueTaskId)

			if (handler != null) {
				if (eventDetails.type === 'io') {
					if (eventDetails.stdout != null) {
						handler.onStdout?.(eventDetails.stdout)
					}
					if (eventDetails.stderr != null) {
						handler.onStderr?.(eventDetails.stderr)
					}
				} else if (eventDetails.type === 'close') {
					handler.onClose?.(eventDetails.code)
					this.streamingTaskHandlers.delete(uniqueTaskId)
				}
			}
		} else {
			const pendingMessage = this.messageIdToWebSocketResponsePromiseMapping.get(messageId)
			if (pendingMessage != null) {
				clearTimeout(pendingMessage.timeoutId)
				pendingMessage.deferredPromise.resolve?.(payload)
				this.messageIdToWebSocketResponsePromiseMapping.delete(messageId)
				return
			}

			const eventWaiter = this.waitQueueToEventTypePromiseMapping.get(payload.eventType)
			if (eventWaiter != null) {
				clearTimeout(eventWaiter.timeoutId)
				eventWaiter.deferredPromise.resolve?.(payload)
				this.waitQueueToEventTypePromiseMapping.delete(payload.eventType)
			}
		}
	}

	private onError(error: Error): void {
		console.error('[SandboxWebSocket] WebSocket error', error)
	}

	private async onClose(): Promise<void> {
		this.connectionState = 'disconnected'
		this.cleanDirtyWebSocketIfPresent()

		if (this.shouldAutoReconnect) {
			await new Promise(resolve => setTimeout(resolve, 2000)) // TODO: is this required?
			try {
				await this.connect()
			} catch (error) {
				console.error('[SandboxWebSocket] Reconnect failed', error)
			}
		}
	}

	private constructRawWebSocketMessage(payload: WebSocketRequestPayload): {
		messageId: string
		rawMessage: string
	} {
		const messageId = nanoid()
		const message: WebSocketMessage = { messageId, payload }
		return {
			messageId,
			rawMessage: JSON.stringify(message)
		}
	}

	private sendSingleMessage(message: string): void {
		if (this.connectionState !== 'connected' || this.ws == null) {
			this.messagesData.push(message)
			return
		}

		try {
			this.ws.send(message)
		} catch (error) {
			this.messagesData.push(message)
			console.error('[SandboxWebSocket] Error sending message', error)
			// TODO: throw maybe?
		}
	}

	private cleanDirtyWebSocketIfPresent(): void {
		if (this.ws != null) {
			this.ws.removeAllListeners()
			if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.close()
			}
			this.ws = null
		}

		if (this.healthPingTimeoutId != null) {
			clearTimeout(this.healthPingTimeoutId)
			this.healthPingTimeoutId = null
		}

		this.messageIdToWebSocketResponsePromiseMapping.forEach(pending => {
			clearTimeout(pending.timeoutId)
			pending.deferredPromise.reject?.(new Error('WebSocket closed'))
		})
		this.messageIdToWebSocketResponsePromiseMapping.clear()

		this.waitQueueToEventTypePromiseMapping.forEach(waiter => {
			clearTimeout(waiter.timeoutId)
			waiter.deferredPromise.reject?.(new Error('WebSocket closed'))
		})
		this.waitQueueToEventTypePromiseMapping.clear()

		this.messagesData = []
	}
}
