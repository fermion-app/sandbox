import { z } from 'zod'

/**
 * Creates a Zod schema for API response envelope
 * @internal
 */
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

/** Schema for playground snippet creation response */
const createPlaygroundSnippetOutputSchema = z.object({
	playgroundSnippetId: z.string()
})

/** Schema for playground session start response */
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
			isVpnFound: z.boolean(), // TODO: check if this is needed
			isLimitExceeded: z.boolean() // TODO: check if this is needed
		})
	])
})

/** Schema for container connection details */
const containerDetailsSchema = z.object({
	playgroundContainerAccessToken: z.string(),
	subdomain: z.string()
})

/** Schema for session details polling response */
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

/** Schema for playground snippet creation request */
const createPlaygroundSnippetInputSchema = z.object({
	bootParams: z.object({
		source: z.literal('empty'),
		shouldBackupFilesystem: z.boolean()
	})
})

/** Schema for playground session start request */
const startPlaygroundSessionInputSchema = z.object({
	playgroundSnippetId: z.string()
})

/** Schema for session details polling request */
const getRunningPlaygroundSessionDetailsInputSchema = z.object({
	params: z.object({
		playgroundSessionId: z.string(),
		isWaitingForUpscale: z.boolean(),
		playgroundType: z.literal('PlaygroundSnippet'),
		playgroundSnippetId: z.string()
	})
})

// Exported Types

/** Input parameters for creating a playground snippet */
type CreatePlaygroundSnippetInput = z.infer<typeof createPlaygroundSnippetInputSchema>

/** Response data from playground snippet creation */
type CreatePlaygroundSnippetOutput = z.infer<typeof createPlaygroundSnippetOutputSchema>

/** Input parameters for starting a playground session */
type StartPlaygroundSessionInput = z.infer<typeof startPlaygroundSessionInputSchema>

/** Response data from playground session start */
type StartPlaygroundSessionOutput = z.infer<typeof startPlaygroundSessionOutputSchema>

/** Input parameters for polling session details */
type GetRunningPlaygroundSessionDetailsInput = z.infer<
	typeof getRunningPlaygroundSessionDetailsInputSchema
>

/** Response data from session details polling */
type GetRunningPlaygroundSessionDetailsOutput = z.infer<
	typeof getRunningPlaygroundSessionDetailsOutputSchema
>

/** Container connection details including subdomain and access token */
export type ContainerDetails = z.infer<typeof containerDetailsSchema>

/**
 * HTTP API client for Fermion backend
 *
 * @remarks
 * Handles all HTTP communication with the Fermion API including:
 * - Request/response validation with Zod schemas
 * - Error handling and type-safe responses
 * - API key authentication
 *
 * @internal
 */
export class ApiClient {
	private readonly baseUrl = 'https://backend.codedamn.com/api'
	private apiKey: string

	/**
	 * Creates a new API client
	 * @param apiKey - API key for authentication
	 * @throws {Error} If API key is null or empty
	 */
	constructor(apiKey: string | null) {
		if (apiKey == null || apiKey.trim() === '') {
			throw new Error(
				'API key is required. Please provide a valid API key when creating the sandbox.'
			)
		}
		this.apiKey = apiKey
	}

	/**
	 * Makes a validated API call to Fermion backend
	 *
	 * @typeParam T - Expected response data type
	 * @typeParam D - Request data type
	 * @param options - Call configuration
	 * @returns Validated response data
	 * @throws {Error} If validation fails or API returns error
	 * @internal
	 */
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
			throw new Error(`API error: ${errorMessage}`)
		}

		return apiResponse.output.data
	}

	/**
	 * Creates a new playground snippet
	 * @param params - Snippet configuration
	 * @returns Created snippet details with ID
	 */
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

	/**
	 * Starts a new playground session
	 * @param params - Session start parameters with snippet ID
	 * @returns Session details or attention-needed status
	 */
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

	/**
	 * Polls for running playground session details
	 * @param params - Session polling parameters
	 * @returns Session details or waiting status
	 */
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
}
