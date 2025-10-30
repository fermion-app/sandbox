import WebSocket from 'ws'
import { nanoid } from 'nanoid'
import { WebSocketRequestPayload, WebSocketResponsePayload } from './constants'

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

export interface WebSocketMessage {
	messageId: string
	payload: WebSocketRequestPayload
}

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

	constructor({
		url,
		token,
	}: {
		url: string
		token: string
	}) {
		this.url = url
		this.token = token
	}

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

	async send({
		payload,
		options = { timeout: 30000 } // TODO: check timeout
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

	waitForNextFutureWebSocketEvent(
		{
			eventType,
			timeout = 30000
		}: {
			eventType: string
			timeout?: number
		} // TODO: check timeout
	): Promise<WebSocketResponsePayload> {
		const deferredPromise = new DeferredPromise<WebSocketResponsePayload>()

		const existing = this.waitQueueToEventTypePromiseMapping.get(eventType)
		if (existing != null) {
			existing.deferredPromise.reject?.(new Error('Replaced by new wait'))
		}

		this.waitQueueToEventTypePromiseMapping.set(eventType, {
			deferredPromise,
			timeoutId: setTimeout(() => {
				this.waitQueueToEventTypePromiseMapping.delete(eventType)
				deferredPromise.reject?.(new Error(`Timeout waiting for event: ${eventType}`))
			}, timeout)
		})

		return deferredPromise.promise
	}

	async addStreamingTaskHandler({ uniqueTaskId, handler }: {
	uniqueTaskId: string
	handler: {
		onStdout?: (stdout: string) => void
		onStderr?: (stderr: string) => void
		onClose?: (exitCode: number) => void }
}): Promise<void> {
		this.streamingTaskHandlers.set(uniqueTaskId, handler)
	}

	disconnect(): void {
		this.shouldAutoReconnect = false
		this.cleanDirtyWebSocketIfPresent()
	}

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

	/**
	 * Sends periodic health pings to keep the connection alive
	 * Matches frontend behavior - sends HealthPing every 30s
	 */
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

				this.healthPingTimeoutId = setTimeout(sendHealthPing, 30000) // TODO: check timeout
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
			await new Promise(resolve => setTimeout(resolve, 2000)) // TODO: check timeout
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
