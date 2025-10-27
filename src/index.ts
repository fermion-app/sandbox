import { nanoid } from 'nanoid'
import { SandboxWebSocket } from './websocket.js'
import dotenv from 'dotenv'
import { ApiClient, type ContainerDetails } from './api-client.js'

dotenv.config()

export interface SandboxConfig {
	gitRepoUrl: string
	timeoutMs: number
	apiKey?: string
}

export type { ContainerDetails } from './api-client.js'
export class Sandbox {
	private config: SandboxConfig
	private authToken: string
	private fermionSchoolId: string
	private baseUrl: string
	private playgroundSessionId: string | null = null
	private playgroundSnippetId: string | null = null
	private containerDetails: ContainerDetails | null = null
	private ws: SandboxWebSocket | null = null

	private constructor(config: SandboxConfig) {
		this.authToken = process.env.AUTH_TOKEN ?? ''
		this.fermionSchoolId = process.env.FERMION_SCHOOL_ID ?? ''
		this.baseUrl = process.env.BASE_URL ?? ''
		this.config = {
			timeoutMs: config.timeoutMs ?? 120000,
			gitRepoUrl: config.gitRepoUrl ?? 'https://github.com/mehulmpt/empty'
		}
	}

	static async create(config: SandboxConfig): Promise<Sandbox> {
		const sandbox = new Sandbox(config)
		const api = new ApiClient(sandbox.baseUrl, sandbox.fermionSchoolId, sandbox.authToken)

		const snippetData = await api.createPlaygroundSnippet({
			title: nanoid(),
			defaultGitRepoUrl: sandbox.config.gitRepoUrl,
			isCustom: true
		})

		sandbox.playgroundSnippetId = snippetData.playgroundSnippetId

		const sessionData = await api.startPlaygroundSession({
			params: {
				playgroundType: 'PlaygroundSnippet',
				playgroundSnippetId: sandbox.playgroundSnippetId
			}
		})

		if (sessionData.response.status === 'attention-needed') {
			throw new Error(`Cannot start session: ${sessionData.response.attentionType}`)
		}

		sandbox.playgroundSessionId = sessionData.response.playgroundSessionId

		const interval = 500
		const max = Math.ceil(sandbox.config.timeoutMs / interval)
		const start = Date.now()

		for (let i = 0; i < max; i++) {
			if (Date.now() - start > sandbox.config.timeoutMs) {
				throw new Error('Provisioning timeout')
			}

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
				return sandbox
			}

			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	async connect(): Promise<void> {
		if (this.containerDetails != null) {
			const wsUrl = `wss://${this.containerDetails.subdomain}-13372.run-code.com`

			this.ws = new SandboxWebSocket(wsUrl, this.containerDetails.playgroundContainerAccessToken)
			await this.ws.connect()

			await this.ws.waitForNextFutureWebSocketEvent('ContainerServerReady', 10000)

		} else {
			throw new Error('No container found')
		}
	}

	disconnect(): void {
		this.ws?.disconnect()
		this.ws = null
	}

	async getFile(path: string): Promise<string> {
		if (this.containerDetails != null) {
			const url = new URL(`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`)
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
	
			const content = await response.text()
			return content
		}

		throw new Error('No container found')
	}

	async setFile(path: string, content: string): Promise<void> {
		if (this.containerDetails != null) {
			const url = new URL(`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`)
			url.searchParams.append('full-path', path)
			url.searchParams.append('playground-container-access-token', this.containerDetails.playgroundContainerAccessToken)

			const response = await fetch(url, {
				method: 'PUT',
				body: content,
				headers: {
					'Content-Type': 'text/plain'
				}
			})

			if (!response.ok && response.status !== 201) {
				throw new Error(`Failed to set file: ${response.statusText}`)
			}
		} else {
			throw new Error('No container found')
		}
	}

	async runStreamingCommand(options: {
		cmd: string
		args?: string[]
		stdin?: string
		onStdout?: (stdout: string) => void
		onStderr?: (stderr: string) => void
		onClose?: (exitCode: number) => void
	}): Promise<void> {
		if (this.ws == null) {
			throw new Error('Not connected')
		}

		const startResponse = await this.ws.send<{
			data: { uniqueTaskId: string; processId: number }
		}>('RunLongRunningCommand', {
			data: {
				command: options.cmd,
				...(options.args != null && { args: options.args }),
				...(options.stdin != null && { stdin: options.stdin })
			}
		}) 

		const { uniqueTaskId } = startResponse.data

		while (this.ws.isConnected()) {
			const payload = await this.ws.waitForNextFutureWebSocketEvent('StreamLongRunningTaskEvent',300000)

			if (payload.uniqueTaskId !== uniqueTaskId) continue

			const eventDetails = payload.eventDetails as {
				type: 'io' | 'close'
				stdout?: string
				stderr?: string
				code?: number | null
				error?: string | null
			}

			if (eventDetails.type === 'io') {
				if (eventDetails.stdout != null) {
					options.onStdout?.(eventDetails.stdout)
				}
				if (eventDetails.stderr != null) {
					options.onStderr?.(eventDetails.stderr)
				}
			} else if (eventDetails.type === 'close') {
				const exitCode = eventDetails.code ?? 0

				if (eventDetails.error != null) {
					throw new Error(eventDetails.error)
				}

				options.onClose?.(exitCode)

				return
			}
		}
	}

	async runCommand(options: {
		cmd: string
		args?: string[]
		stdin?: string
	}): Promise<{
		stdout: string
		stderr: string
		exitCode: number
	}> {
		if (!this.ws) {
			throw new Error('Not connected')
		}

		const fullCommand = options.args
			? `${options.cmd} ${options.args.join(' ')}`
			: options.cmd

		const response = await this.ws.send<{
			stdout: string
			stderr: string
			exitCode?: number
		}>('EvalSmallCodeSnippetInsideContainer', {
			command: fullCommand
		})

		return {
			stdout: response.stdout || '',
			stderr: response.stderr || '',
			exitCode: response.exitCode ?? 0
		}
	}

	getSessionId(): string | null {
		return this.playgroundSessionId
	}

	getContainerDetails(): ContainerDetails | null {
		return this.containerDetails
	}

	isConnected(): boolean {
		return this.ws?.isConnected() ?? false
	}
}
