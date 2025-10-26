import { nanoid } from 'nanoid'
import { SandboxWebSocket } from './websocket.js'

export interface SandboxConfig {
	fermionSchoolId?: string
	gitRepoUrl: string
	provisionTimeout?: number
	authToken?: string
	baseUrl?: string
}

export interface ContainerDetails {
	playgroundContainerAccessToken: string
	subdomain: string
}

export class Sandbox {
	private config: Required<Omit<SandboxConfig, 'fermionSchoolId'>> &
		Pick<SandboxConfig, 'fermionSchoolId'>

	private authToken: string
	private fermionSchoolId: string
	private baseUrl: string
	private playgroundSessionId: string | null = null
	private playgroundSnippetId: string | null = null
	private containerDetails: ContainerDetails | null = null
	private ws: SandboxWebSocket | null = null

	private constructor(config: SandboxConfig) {
		this.authToken =
			config.authToken ||
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyVHlwZSI6ImZlcm1pb24taW5zdHJ1Y3RvciIsImZlcm1pb25JbnN0cnVjdG9ySWQiOiI2OGFjMTUzODFhYThlZTAwNmY3MWNhZGMiLCJpc09uYm9hcmRpbmdDb21wbGV0ZWQiOmZhbHNlLCJub25jZSI6IjY4Zjc2OWQ2Zjc2ZDJhMDU2NDQ4ODZhYiJ9.yOyo-insntvWaGkqn8Y5azgzhJ1zkQB4o6lnH4yc6tM'
		this.fermionSchoolId = config.fermionSchoolId || '673f0aeb79da380001eafcd3'
		this.baseUrl = config.baseUrl || 'https://backend.codedamn.com/api'

		this.config = {
			provisionTimeout: config.provisionTimeout ?? 120000,
			gitRepoUrl: config.gitRepoUrl ?? 'https://github.com/mehulmpt/empty'
		}
	}

	static async create(config: SandboxConfig): Promise<Sandbox> {
		const sandbox = new Sandbox(config)

		const createSnippetRes = await fetch(`${sandbox.baseUrl}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				fermionSchoolId: sandbox.fermionSchoolId,
				authToken: sandbox.authToken,
				data: [
					{
						context: {
							namespace: 'fermion-user',
							functionName: 'create-new-playground-snippet'
						},
						data: {
							title: nanoid(),
							defaultGitRepoUrl: sandbox.config.gitRepoUrl,
							isCustom: true
						}
					}
				]
			})
		})

		if (!createSnippetRes.ok) {
			throw new Error(`Snippet creation failed: ${createSnippetRes.statusText}`)
		}

		const apiResponse = (await createSnippetRes.json()) as Array<{
			output:
				| {
						status: 'ok'
						data: { playgroundSnippetId: string }
				  }
				| {
						status: 'error'
						errorMessage: string
				  }
		}>

		const snippetOutput = apiResponse[0]?.output
		if (!snippetOutput || snippetOutput.status === 'error') {
			throw new Error(
				snippetOutput?.status === 'error'
					? snippetOutput.errorMessage
					: 'Failed to create snippet'
			)
		}

		sandbox.playgroundSnippetId = snippetOutput.data.playgroundSnippetId
		const sessionRes = await fetch(`${sandbox.baseUrl}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				fermionSchoolId: sandbox.fermionSchoolId,
				authToken: sandbox.authToken,
				data: [
					{
						context: {
							namespace: 'fermion-user',
							functionName: 'start-playground-session'
						},
						data: {
							params: {
								playgroundType: 'PlaygroundSnippet',
								playgroundSnippetId: sandbox.playgroundSnippetId
							}
						}
					}
				]
			})
		})

		if (!sessionRes.ok) {
			throw new Error(`Session start failed: ${sessionRes.statusText}`)
		}

		const sessionApiResponse = (await sessionRes.json()) as Array<{
			output:
				| {
						status: 'ok'
						data: {
							response:
								| {
										status: 'ok'
										playgroundSessionId: string
								  }
								| {
										status: 'attention-needed'
										attentionType: string
								  }
						}
				  }
				| {
						status: 'error'
						errorMessage: string
				  }
		}>

		const sessionOutput = sessionApiResponse[0]?.output
		if (!sessionOutput || sessionOutput.status === 'error') {
			throw new Error(
				sessionOutput?.status === 'error'
					? sessionOutput.errorMessage
					: 'Failed to start session'
			)
		}

		const sessionData = sessionOutput.data.response

		if (sessionData.status === 'attention-needed') {
			throw new Error(sessionData.attentionType)
		}

		if (!sessionData.playgroundSessionId) {
			throw new Error('No playground session id')
		}

		sandbox.playgroundSessionId = sessionData.playgroundSessionId

		const interval = 500
		const max = Math.ceil(sandbox.config.provisionTimeout / interval)
		const start = Date.now()

		for (let i = 0; i < max; i++) {
			if (Date.now() - start > sandbox.config.provisionTimeout) {
				throw new Error('Provisioning timeout')
			}

			const detailsRes = await fetch(`${sandbox.baseUrl}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					fermionSchoolId: sandbox.fermionSchoolId,
					authToken: sandbox.authToken,
					data: [
						{
							context: {
								namespace: 'fermion-user',
								functionName: 'get-running-playground-session-details'
							},
							data: {
								params: {
									playgroundSessionId: sandbox.playgroundSessionId,
									isWaitingForUpscale: false,
									playgroundType: 'PlaygroundSnippet',
									playgroundSnippetId: sandbox.playgroundSnippetId
								}
							}
						}
					]
				})
			})

			const detailsApiResponse = (await detailsRes.json()) as Array<{
				output:
					| {
							status: 'ok'
							data: {
								response: {
									isWaitingForUpscale: boolean
									containerDetails?: ContainerDetails
								}
							}
					  }
					| {
							status: 'error'
							errorMessage: string
					  }
			}>

			const detailsOutput = detailsApiResponse[0]?.output
			if (!detailsOutput || detailsOutput.status === 'error') {
				throw new Error(
					detailsOutput?.status === 'error'
						? detailsOutput.errorMessage
						: 'Failed to get session details'
				)
			}

			const detailsData = detailsOutput.data.response

			if (!detailsData.isWaitingForUpscale && detailsData.containerDetails) {
				sandbox.containerDetails = detailsData.containerDetails

				await sandbox.connect()

				return sandbox
			}
			await new Promise(r => setTimeout(r, interval))
		}

		throw new Error('Provisioning timeout')
	}

	async connect(): Promise<void> {
		if (!this.containerDetails) {
			throw new Error('No container found')
		}

		const wsUrl = `wss://${this.containerDetails.subdomain}-13372.run-code.com`

		this.ws = new SandboxWebSocket(wsUrl, this.containerDetails.playgroundContainerAccessToken)
		await this.ws.connect()

		await this.ws.waitForNextFutureWebSocketEvent('ContainerServerReady', 10000)
	}

	disconnect(): void {
		this.ws?.disconnect()
		this.ws = null
	}

	async getFile(path: string): Promise<string> {
		if (!this.containerDetails) {
			throw new Error('Not connected')
		}

		// Use HTTP GET to /static-server endpoint
		const url = new URL(
			`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
		)
		url.searchParams.append('full-path', path)
		url.searchParams.append(
			'playground-container-access-token',
			this.containerDetails.playgroundContainerAccessToken
		)

		const response = await fetch(url.toString())

		if (!response.ok) {
			if (response.status === 404) {
				throw new Error(`File not found: ${path}`)
			}
			throw new Error(`Failed to get file: ${response.statusText}`)
		}

		const content = await response.text()
		return content
	}

	async setFile(path: string, content: string): Promise<void> {
		if (!this.containerDetails) {
			throw new Error('Not connected')
		}

		// Use HTTP PUT to /static-server endpoint
		const url = new URL(
			`https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`
		)
		url.searchParams.append('full-path', path)
		url.searchParams.append(
			'playground-container-access-token',
			this.containerDetails.playgroundContainerAccessToken
		)

		const response = await fetch(url.toString(), {
			method: 'PUT',
			body: content,
			headers: {
				'Content-Type': 'text/plain'
			}
		})

		if (!response.ok && response.status !== 201) {
			throw new Error(`Failed to set file: ${response.statusText}`)
		}
	}

	async delete(path: string): Promise<void> {
		if (!this.ws) {
			throw new Error('Not connected')
		}
		await this.ws.send('RemoveFileOrFolder', { fullPath: path })
	}

	async runStreamingCommand(options: {
		cmd: string
		args?: string[]
		stdin?: string
		onStdout?: (stdout: string) => void
		onStderr?: (stderr: string) => void
		onClose?: (exitCode: number) => void
	}): Promise<void> {
		if (!this.ws) {
			throw new Error('Not connected')
		}

		const startResponse = await this.ws.send<{
			data: { uniqueTaskId: string; processId: number }
		}>('RunLongRunningCommand', {
			data: {
				command: options.cmd,
				args: options.args || [],
				...(options.stdin && { stdin: options.stdin })
			}
		})

		const { uniqueTaskId } = startResponse.data

		while (this.ws.isConnected()) {
			const payload = await this.ws.waitForNextFutureWebSocketEvent(
				'StreamLongRunningTaskEvent',
				300000
			)

			if (payload.uniqueTaskId !== uniqueTaskId) continue

			const eventDetails = payload.eventDetails as {
				type: 'io' | 'close'
				stdout?: string
				stderr?: string
				code?: number | null
				error?: string | null
			}

			if (eventDetails.type === 'io') {
				if (eventDetails.stdout) {
					options.onStdout?.(eventDetails.stdout)
				}
				if (eventDetails.stderr) {
					options.onStderr?.(eventDetails.stderr)
				}
			} else if (eventDetails.type === 'close') {
				const exitCode = eventDetails.code ?? 0

				if (eventDetails.error) {
					throw new Error(eventDetails.error)
				}

				options.onClose?.(exitCode)

				return
			}
		}
	}

	async runSmallCommand(options: {
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

		// Build the full command with args
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
