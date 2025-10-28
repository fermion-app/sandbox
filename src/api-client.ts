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
      isVpnFound: z.boolean(),
      isLimitExceeded: z.boolean(),
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
  title: z.string(),
  defaultGitRepoUrl: z.string(),
  isCustom: z.boolean(),
});

const startPlaygroundSessionInputSchema = z.object({
  params: z.object({
    playgroundType: z.literal("PlaygroundSnippet"),
    playgroundSnippetId: z.string(),
  }),
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

export interface ApiClientOptions {
  fermionSchoolId: string;
  authToken: string;
}

/**
 * API Client for making requests to Fermion backend
 * Handles request validation and error handling
 */
export class ApiClient {
  private readonly namespace = "fermion-user";
  private readonly baseUrl = "https://backend.codedamn.com/api";
  private fermionSchoolId: string;
  private authToken: string;

  constructor(options: ApiClientOptions) {
    if (!options.fermionSchoolId) {
      throw new Error("Fermion School ID is required");
    }
    if (!options.authToken) {
      throw new Error("Auth token is required");
    }

    this.fermionSchoolId = options.fermionSchoolId;
    this.authToken = options.authToken;
  }

  private async call<T, D>({
    functionName,
    data,
    inputSchema,
    outputSchema,
  }: {
    functionName: string;
    data: D;
    inputSchema: z.ZodType<D>;
    outputSchema: z.ZodType<T>;
  }): Promise<T> {
    const validatedData = inputSchema.parse(data);

    const request = {
      context: { namespace: this.namespace, functionName },
      data: validatedData,
    };

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fermionSchoolId: this.fermionSchoolId,
        authToken: this.authToken,
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
      inputSchema: getRunningPlaygroundSessionDetailsInputSchema,
      outputSchema: getRunningPlaygroundSessionDetailsOutputSchema,
    });
  }
}
