import { z } from 'zod'

const createApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
	z.object({
		output: z.union([
			z.object({
				status: z.literal('ok'),
				data: dataSchema
			}),
			z.object({
				status: z.literal('error'),
				errorMessage: z.string()
			})
		])
	})

const createPlaygroundSnippetOutputSchema = z.object({
	playgroundSnippetId: z.string()
})

const startPlaygroundSessionOutputSchema = z.object({
	response: z.union([
		z.object({
			status: z.literal('ok'),
			playgroundSessionId: z.string()
		}),
		z.object({
			status: z.literal('attention-needed'),
			userType: z.enum(['fermion-user', 'codedamn-user', 'unknown']),
			attentionType: z.enum([
				'cannot-get-new',
				'can-terminate-and-get-new',
				'can-create-account-and-get-new'
			]),
			isVpnFound: z.boolean(),
			isLimitExceeded: z.boolean()
		})
	])
})

const containerDetailsSchema = z.object({
	playgroundContainerAccessToken: z.string(),
	subdomain: z.string()
})

const getRunningPlaygroundSessionDetailsOutputSchema = z.object({
	response: z.union([
		z.object({
			isWaitingForUpscale: z.literal(true)
		}),
		z.object({
			isWaitingForUpscale: z.literal(false),
			containerDetails: containerDetailsSchema
		})
	])
})

const createPlaygroundSnippetInputSchema = z.object({
	bootParams: z.object({
		source: z.literal('empty'),
		shouldBackupFilesystem: z.boolean()
	})
})

const startPlaygroundSessionInputSchema = z.object({
	playgroundSnippetId: z.string()
})

const getRunningPlaygroundSessionDetailsInputSchema = z.object({
	params: z.object({
		playgroundSessionId: z.string(),
		isWaitingForUpscale: z.boolean(),
		playgroundType: z.literal('PlaygroundSnippet'),
		playgroundSnippetId: z.string()
	})
})

type CreatePlaygroundSnippetInput = z.infer<typeof createPlaygroundSnippetInputSchema>
type CreatePlaygroundSnippetOutput = z.infer<typeof createPlaygroundSnippetOutputSchema>

type StartPlaygroundSessionInput = z.infer<typeof startPlaygroundSessionInputSchema>
type StartPlaygroundSessionOutput = z.infer<typeof startPlaygroundSessionOutputSchema>

type GetRunningPlaygroundSessionDetailsInput = z.infer<
	typeof getRunningPlaygroundSessionDetailsInputSchema
>

type GetRunningPlaygroundSessionDetailsOutput = z.infer<
	typeof getRunningPlaygroundSessionDetailsOutputSchema
>

export type ContainerDetails = z.infer<typeof containerDetailsSchema>

const runConfigSchema = z.object({
	customMatcherToUseForExpectedOutput: z.string().default('ExactMatch'),
	expectedOutputAsBase64UrlEncoded: z.string().default(''),
	stdinStringAsBase64UrlEncoded: z.string().default(''),
	callbackUrlOnExecutionCompletion: z.string().nullable().optional(),
	shouldEnablePerProcessAndThreadCpuTimeLimit: z.boolean().default(false),
	shouldEnablePerProcessAndThreadMemoryLimit: z.boolean().default(false),
	shouldAllowInternetAccess: z.boolean().default(false),
	compilerFlagString: z.string().default(''),
	maxFileSizeInKilobytesFilesCreatedOrModified: z.number().default(51200),
	stackSizeLimitInKilobytes: z.number().default(65536),
	cpuTimeLimitInMilliseconds: z.number().default(2000),
	wallTimeLimitInMilliseconds: z.number().default(5000),
	memoryLimitInKilobyte: z.number().default(512000),
	maxProcessesAndOrThreads: z.number().default(60)
})

const dsaCodeExecutionEntrySchema = z.object({
	language: z.enum([
		'C',
		'Cpp',
		'Java',
		'Python',
		'Nodejs',
		'Sqlite_3_48_0',
		'Mysql_8',
		'Golang_1_19',
		'Rust_1_87',
		'Dotnet_8'
	]),
	runConfig: runConfigSchema,
	sourceCodeAsBase64UrlEncoded: z.string(),
	additionalFilesAsZip: z
		.object({
			type: z.literal('base64url-encoding'),
			base64UrlEncodedZip: z.string()
		})
		.optional()
})

const requestDsaExecutionInputSchema = z.object({
	entries: z.array(dsaCodeExecutionEntrySchema)
})

const requestDsaExecutionOutputSchema = z.object({
	taskIds: z.array(z.string())
})

const getDsaExecutionResultInputSchema = z.object({
	taskUniqueIds: z.array(z.string())
})

const programRunDataSchema = z.object({
	cpuTimeUsedInMilliseconds: z.number().int().min(0),
	wallTimeUsedInMilliseconds: z.number().int().min(0),
	memoryUsedInKilobyte: z.number().int().min(0),
	exitSignal: z.number(),
	exitCode: z.number(),
	stdoutBase64UrlEncoded: z.string().or(z.null()),
	stderrBase64UrlEncoded: z.string().or(z.null())
})

const runResultSchema = z.object({
	compilerOutputAfterCompilationBase64UrlEncoded: z.string().or(z.null()),
	finishedAt: z.string(),
	runStatus: z.enum([
		'successful',
		'compilation-error',
		'time-limit-exceeded',
		'wrong-answer',
		'non-zero-exit-code',
		'died-sigsev',
		'died-sigxfsz',
		'died-sigfpe',
		'died-sigabrt',
		'internal-isolate-error',
		'unknown'
	]),
	programRunData: programRunDataSchema.or(z.null())
})

const dsaExecutionResultSchema = z.object({
	taskUniqueId: z.string(),
	sourceCodeAsBase64UrlEncoded: z.string(),
	language: z.string(),
	runConfig: runConfigSchema,
	codingTaskStatus: z.enum(['Pending', 'Processing', 'Finished']),
	runResult: runResultSchema.or(z.null())
})

const getDsaExecutionResultOutputSchema = z.object({
	tasks: z.array(dsaExecutionResultSchema)
})

// Types used in index.ts (public API)
export type RunConfig = z.infer<typeof runConfigSchema>
export type DsaCodeExecutionEntry = z.infer<typeof dsaCodeExecutionEntrySchema>
export type DsaExecutionResult = z.infer<typeof dsaExecutionResultSchema>
export type DecodedRunResult = Omit<
	NonNullable<DsaExecutionResult['runResult']>,
	'compilerOutputAfterCompilationBase64UrlEncoded' | 'programRunData'
> & {
	compilerOutputAfterCompilation: string | null
	programRunData: NonNullable<DsaExecutionResult['runResult']>['programRunData'] extends infer PD
		? PD extends null
			? null
			: Omit<NonNullable<PD>, 'stdoutBase64UrlEncoded' | 'stderrBase64UrlEncoded'> & {
					stdout: string
					stderr: string
				}
		: never
}


// Types only used internally in api-client.ts (not exported)
type RequestDsaExecutionInput = z.infer<typeof requestDsaExecutionInputSchema>
type RequestDsaExecutionOutput = z.infer<typeof requestDsaExecutionOutputSchema>
type GetDsaExecutionResultInput = z.infer<typeof getDsaExecutionResultInputSchema>
type GetDsaExecutionResultOutput = z.infer<typeof getDsaExecutionResultOutputSchema>

export class ApiClient {
	private readonly baseUrl = 'https://backend.codedamn.com/api'
	private apiKey: string

	constructor(apiKey: string | null) {
		if (apiKey == null || apiKey.trim() === '') {
			throw new Error(
				'API key is required. Please provide a valid API key when creating the sandbox.'
			)
		}
		this.apiKey = apiKey
	}

	private async call<T, D>({
		functionName,
		namespace,
		data,
		inputSchema,
		outputSchema
	}: {
		functionName: string
		namespace: 'public' | 'fermion-user'
		data: D
		inputSchema: z.ZodType<D>
		outputSchema: z.ZodType<T>
	}): Promise<T> {
		const validatedData = inputSchema.parse(data)

		const request = {
			context: { namespace, functionName },
			data: validatedData
		}

		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Fermion-Api-Key': this.apiKey
			},
			body: JSON.stringify({
				data: [request]
			})
		})

		if (!response.ok) {
			throw new Error(`API request failed: ${response.statusText}`)
		}

		const rawResponse = await response.json()

		const responseSchema = createApiResponseSchema(outputSchema)
		const arrayResponseSchema = z.array(responseSchema)
		const parsedArray = arrayResponseSchema.parse(rawResponse)
		const apiResponse = parsedArray[0]

		if (apiResponse.output.status === 'error') {
			const errorMessage = apiResponse.output.errorMessage
			if (
				errorMessage.includes(
					'Fermion School not found! Please contact support@codedamn.com immediately!'
				)
			) {
				throw new Error('Invalid API key')
			} else {
				throw new Error(errorMessage)
			}
		}
		return apiResponse.output.data
	}

	async createPlaygroundSnippet(
		params: CreatePlaygroundSnippetInput
	): Promise<CreatePlaygroundSnippetOutput> {
		return this.call({
			functionName: 'create-new-playground-snippet',
			data: params,
			namespace: 'public',
			inputSchema: createPlaygroundSnippetInputSchema,
			outputSchema: createPlaygroundSnippetOutputSchema
		})
	}

	async startPlaygroundSession(
		params: StartPlaygroundSessionInput
	): Promise<StartPlaygroundSessionOutput> {
		return this.call({
			functionName: 'start-playground-session',
			data: params,
			namespace: 'public',
			inputSchema: startPlaygroundSessionInputSchema,
			outputSchema: startPlaygroundSessionOutputSchema
		})
	}

	async getRunningPlaygroundSessionDetails(
		params: GetRunningPlaygroundSessionDetailsInput
	): Promise<GetRunningPlaygroundSessionDetailsOutput> {
		return this.call({
			functionName: 'get-running-playground-session-details',
			data: params,
			namespace: 'fermion-user',
			inputSchema: getRunningPlaygroundSessionDetailsInputSchema,
			outputSchema: getRunningPlaygroundSessionDetailsOutputSchema
		})
	}

	async requestDsaExecution(
		params: RequestDsaExecutionInput
	): Promise<RequestDsaExecutionOutput> {
		return this.call({
			functionName: 'request-dsa-code-execution-batch',
			data: params,
			namespace: 'public',
			inputSchema: requestDsaExecutionInputSchema,
			outputSchema: requestDsaExecutionOutputSchema
		})
	}

	async getDsaExecutionResult(
		params: GetDsaExecutionResultInput
	): Promise<GetDsaExecutionResultOutput> {
		return this.call({
			functionName: 'get-dsa-code-execution-result-batch',
			data: params,
			namespace: 'public',
			inputSchema: getDsaExecutionResultInputSchema,
			outputSchema: getDsaExecutionResultOutputSchema
		})
	}
}
