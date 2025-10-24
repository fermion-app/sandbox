import WebSocket from 'ws'
import { nanoid } from 'nanoid'

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

export interface WebSocketRequestPayload {
	eventType: string
	[key: string]: unknown
}

export interface WebSocketResponsePayload {
	eventType: string
	status?: 'ok' | 'error'
	error?: string
	[key: string]: unknown
}

export interface WebSocketMessage {
	messageId: string
	payload: WebSocketRequestPayload
}

export interface WebSocketResponse {
	messageId: string
	payload: WebSocketResponsePayload
}

export class SandboxWebSocket {
	private ws: WebSocket | null = null
	private url: string
	private token: string
	private messageIdToWebSocketResponsePromiseMapping = new Map<
		string,
		{ deferredPromise: DeferredPromise<WebSocketResponsePayload>; timeoutId: NodeJS.Timeout }
	>()
	private waitQueueToEventTypePromiseMapping = new Map<
		string,
		DeferredPromise<WebSocketResponsePayload>
	>()
	private messagesData: string[] = []
	private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
	private shouldAutoReconnect = true
	private healthPingTimeoutId: NodeJS.Timeout | null = null

	constructor(url: string, token: string) {
		this.url = url
		this.token = token
	}

	async connect(): Promise<void> {
		if (this.connectionState === 'connected') {
			return
		}

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
			} catch (error) {
				this.connectionState = 'disconnected'
				reject(new Error('Failed to connect to WebSocket'))
			}
		})
	}

	async send<T = WebSocketResponsePayload>(
		eventType: string,
		data?: Record<string, unknown>,
		options?: { timeout?: number }
	): Promise<T> {
		const timeout = options?.timeout ?? 30000

		const payload = { eventType, ...data }
		const { messageId, rawMessage } = this.constructRawWebSocketMessage(payload)

		const deferredPromise = new DeferredPromise<WebSocketResponsePayload>()

		const timeoutId = setTimeout(() => {
			this.messageIdToWebSocketResponsePromiseMapping.delete(messageId)
			deferredPromise.reject?.(new Error(`Request timeout for ${eventType}`))
		}, timeout)

		this.messageIdToWebSocketResponsePromiseMapping.set(messageId, {
			deferredPromise,
			timeoutId
		})

		this.sendSingleMessageUnsafe({ message: rawMessage, shouldThrowOnError: false })

		return deferredPromise.promise.then((payload: WebSocketResponsePayload) => {
			if (payload.status === 'error') {
				throw new Error(payload.error || 'Request failed')
			}
			return payload as T
		})
	}

	waitForNextFutureWebSocketEvent(
		eventType: string,
		timeout = 30000
	): Promise<WebSocketResponsePayload> {
		const deferredPromise = new DeferredPromise<WebSocketResponsePayload>()

		const existing = this.waitQueueToEventTypePromiseMapping.get(eventType)
		if (existing) {
			existing.reject?.(new Error('Replaced by new wait'))
		}

		this.waitQueueToEventTypePromiseMapping.set(eventType, deferredPromise)

		setTimeout(() => {
			const waiter = this.waitQueueToEventTypePromiseMapping.get(eventType)
			if (waiter === deferredPromise) {
				this.waitQueueToEventTypePromiseMapping.delete(eventType)
				deferredPromise.reject?.(new Error(`Timeout waiting for event: ${eventType}`))
			}
		}, timeout)

		return deferredPromise.promise
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
				this.sendSingleMessageUnsafe({ message, shouldThrowOnError: false })
			}
		}

		this.startHealthPing()
	}

	/**
	 * Sends periodic health pings to keep the connection alive
	 * Matches frontend behavior - sends HealthPing every 30s
	 */
	private startHealthPing(): void {
		if (this.healthPingTimeoutId) {
			clearTimeout(this.healthPingTimeoutId)
			this.healthPingTimeoutId = null
		}

		const sendHealthPing = (): void => {
			if (this.connectionState === 'connected') {
				this.send('HealthPing', {}).catch(error => {
					console.error('[SandboxWebSocket] Health ping failed', error)
				})

				this.healthPingTimeoutId = setTimeout(sendHealthPing, 30000)
			}
		}

		// Send first health ping after 5 seconds (matches frontend behavior)
		this.healthPingTimeoutId = setTimeout(sendHealthPing, 5000)
	}

	private onMessage(rawData: string): void {
		const message = JSON.parse(rawData)

		const { messageId, payload } = message

		const pendingMessage = this.messageIdToWebSocketResponsePromiseMapping.get(messageId)
		if (pendingMessage) {
			clearTimeout(pendingMessage.timeoutId)
			pendingMessage.deferredPromise.resolve?.(payload)
			this.messageIdToWebSocketResponsePromiseMapping.delete(messageId)
			return
		}

		const eventWaiter = this.waitQueueToEventTypePromiseMapping.get(payload.eventType)
		if (eventWaiter) {
			eventWaiter.resolve?.(payload)
			this.waitQueueToEventTypePromiseMapping.delete(payload.eventType)
			return
		}
	}

	private onError(error: Error): void {
		console.error('[SandboxWebSocket] WebSocket error', error)
	}

	private async onClose(): Promise<void> {
		this.connectionState = 'disconnected'
		this.cleanDirtyWebSocketIfPresent()

		if (this.shouldAutoReconnect) {
			await new Promise(resolve => setTimeout(resolve, 2000))
			try {
				await this.connect()
			} catch (error) {
				// Reconnect failed
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

	private sendSingleMessageUnsafe({
		message,
		shouldThrowOnError
	}: {
		message: string
		shouldThrowOnError: boolean
	}): void {
		// If not connected, queue the message
		if (this.connectionState !== 'connected' || !this.ws) {
			this.messagesData.push(message)
			return
		}

		try {
			this.ws.send(message)
		} catch (error) {
			this.messagesData.push(message)
			if (shouldThrowOnError) throw error
		}
	}

	private cleanDirtyWebSocketIfPresent(): void {
		if (this.ws) {
			this.ws.removeAllListeners()
			if (this.ws.readyState === WebSocket.OPEN) {
				this.ws.close()
			}
			this.ws = null
		}

		if (this.healthPingTimeoutId) {
			clearTimeout(this.healthPingTimeoutId)
			this.healthPingTimeoutId = null
		}

		const pendingCount = this.messageIdToWebSocketResponsePromiseMapping.size
		if (pendingCount > 0) {
			// Rejecting pending messages
		}
		this.messageIdToWebSocketResponsePromiseMapping.forEach(pending => {
			clearTimeout(pending.timeoutId)
			pending.deferredPromise.reject?.(new Error('WebSocket closed'))
		})
		this.messageIdToWebSocketResponsePromiseMapping.clear()

		const waitersCount = this.waitQueueToEventTypePromiseMapping.size
		if (waitersCount > 0) {
			// Rejecting event waiters
		}
		this.waitQueueToEventTypePromiseMapping.forEach(waiter => {
			waiter.reject?.(new Error('WebSocket closed'))
		})
		this.waitQueueToEventTypePromiseMapping.clear()

		this.messagesData = []
	}
}
