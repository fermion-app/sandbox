import { z } from "zod";

const createApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    output: z.union([
      z.object({
        status: z.literal("ok"),
        data: dataSchema,
      }),
      z.object({
        status: z.literal("error"),
        errorMessage: z.string(),
      }),
    ]),
  });

const createPlaygroundSnippetOutputSchema = z.object({
  playgroundSnippetId: z.string(),
});

const startPlaygroundSessionOutputSchema = z.object({
  response: z.union([
    z.object({
      status: z.literal("ok"),
      playgroundSessionId: z.string(),
    }),
    z.object({
      status: z.literal("attention-needed"),
      userType: z.enum(["fermion-user", "codedamn-user", "unknown"]),
      attentionType: z.enum([
        "cannot-get-new",
        "can-terminate-and-get-new",
        "can-create-account-and-get-new",
      ]),
      isVpnFound: z.boolean(), // TODO: check if this is needed
      isLimitExceeded: z.boolean(), // TODO: check if this is needed
    }),
  ]),
});

const containerDetailsSchema = z.object({
  playgroundContainerAccessToken: z.string(),
  subdomain: z.string(),
});

const getRunningPlaygroundSessionDetailsOutputSchema = z.object({
  response: z.union([
    z.object({
      isWaitingForUpscale: z.literal(true),
      shouldSendBackWaitingForUpscaleValueAs: z.boolean(),
    }),
    z.object({
      isWaitingForUpscale: z.literal(false),
      containerDetails: containerDetailsSchema,
    }),
  ]),
});

const createPlaygroundSnippetInputSchema = z.object({
  bootParams: z.object({
    source: z.literal("empty"),
    shouldBackupFilesystem: z.boolean(),
  })
});

const startPlaygroundSessionInputSchema = z.object({
  playgroundSnippetId: z.string(),
});

const getRunningPlaygroundSessionDetailsInputSchema = z.object({
  params: z.object({
    playgroundSessionId: z.string(),
    isWaitingForUpscale: z.boolean(),
    playgroundType: z.literal("PlaygroundSnippet"),
    playgroundSnippetId: z.string(),
  }),
});

// Export types
export type CreatePlaygroundSnippetInput = z.infer<
  typeof createPlaygroundSnippetInputSchema
>;
export type CreatePlaygroundSnippetOutput = z.infer<
  typeof createPlaygroundSnippetOutputSchema
>;

export type StartPlaygroundSessionInput = z.infer<
  typeof startPlaygroundSessionInputSchema
>;
export type StartPlaygroundSessionOutput = z.infer<
  typeof startPlaygroundSessionOutputSchema
>;

export type GetRunningPlaygroundSessionDetailsInput = z.infer<
  typeof getRunningPlaygroundSessionDetailsInputSchema
>;
export type GetRunningPlaygroundSessionDetailsOutput = z.infer<
  typeof getRunningPlaygroundSessionDetailsOutputSchema
>;

export type ContainerDetails = z.infer<typeof containerDetailsSchema>;

/**
 * API Client for making requests to Fermion backend
 * Handles request validation and error handling
 */
export class ApiClient {
  private readonly baseUrl = "https://backend.codedamn.com/api";
  private apiKey: string;

  constructor(apiKey: string | null) {
    if (apiKey == null || apiKey.trim() === "") {
      throw new Error(
        "API key is required. Please provide a valid API key when creating the sandbox."
      );
    }
    this.apiKey = apiKey;
  }

  private async call<T, D>({
    functionName,
    namespace,
    data,
    inputSchema,
    outputSchema,
  }: {
    functionName: string;
    namespace: "public" | "fermion-user";
    data: D;
    inputSchema: z.ZodType<D>;
    outputSchema: z.ZodType<T>;
  }): Promise<T> {
    const validatedData = inputSchema.parse(data);

    const request = {
      context: { namespace, functionName },
      data: validatedData,
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Fermion-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        data: [request],
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const rawResponse = await response.json();

    const responseSchema = createApiResponseSchema(outputSchema);
    const arrayResponseSchema = z.array(responseSchema);
    const parsedArray = arrayResponseSchema.parse(rawResponse);
    const apiResponse = parsedArray[0];

    if (apiResponse.output.status === "error") {
      const errorMessage = apiResponse.output.errorMessage;
      throw new Error(`API error: ${errorMessage}`);
    }

    return apiResponse.output.data;
  }

  async createPlaygroundSnippet(
    params: CreatePlaygroundSnippetInput,
  ): Promise<CreatePlaygroundSnippetOutput> {
    return this.call({
      functionName: "create-new-playground-snippet",
      data: params,
      namespace: "public",
      inputSchema: createPlaygroundSnippetInputSchema,
      outputSchema: createPlaygroundSnippetOutputSchema,
    });
  }

  async startPlaygroundSession(
    params: StartPlaygroundSessionInput,
  ): Promise<StartPlaygroundSessionOutput> {
    return this.call({
      functionName: "start-playground-session",
      data: params,
      namespace: "public",
      inputSchema: startPlaygroundSessionInputSchema,
      outputSchema: startPlaygroundSessionOutputSchema,
    });
  }

  async getRunningPlaygroundSessionDetails(
    params: GetRunningPlaygroundSessionDetailsInput,
  ): Promise<GetRunningPlaygroundSessionDetailsOutput> {
    return this.call({
      functionName: "get-running-playground-session-details",
      data: params,
      namespace: "fermion-user",
      inputSchema: getRunningPlaygroundSessionDetailsInputSchema,
      outputSchema: getRunningPlaygroundSessionDetailsOutputSchema,
    });
  }
}
