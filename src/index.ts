import { nanoid } from "nanoid";
import { SandboxWebSocket } from "./websocket";
import dotenv from "dotenv";
import { ApiClient, type ContainerDetails } from "./api-client";

dotenv.config();

export interface SandboxConfig {
  gitRepoUrl: string;
  apiKey?: string;
}

function exhaustiveGuard(_value: never): never {
  throw new Error(
    `ERROR! Reached forbidden guard function with unexpected value: ${JSON.stringify(_value)}`,
  );
}
export class Sandbox {
  private config: SandboxConfig;
  private authToken: string;
  private fermionSchoolId: string;
  private playgroundSessionId: string | null = null;
  private playgroundSnippetId: string | null = null;
  private containerDetails: ContainerDetails | null = null;
  private timeout: number;
  private ws: SandboxWebSocket | null = null;

  private constructor(config: SandboxConfig) {
    this.authToken = process.env.AUTH_TOKEN ?? "";
    this.fermionSchoolId = process.env.FERMION_SCHOOL_ID ?? "";
    this.timeout = 30000; // TODO: check timeout
    this.config = {
      gitRepoUrl: config.gitRepoUrl ?? "https://github.com/mehulmpt/empty",
    };
  }

  static async create(config: SandboxConfig): Promise<Sandbox> {
    const sandbox = new Sandbox(config);
    const api = new ApiClient({
      fermionSchoolId: sandbox.fermionSchoolId,
      authToken: sandbox.authToken,
    });

    const snippetData = await api.createPlaygroundSnippet({
      title: nanoid(),
      defaultGitRepoUrl: sandbox.config.gitRepoUrl,
      isCustom: true,
    });

    sandbox.playgroundSnippetId = snippetData.playgroundSnippetId;

    const sessionData = await api.startPlaygroundSession({
      params: {
        playgroundType: "PlaygroundSnippet",
        playgroundSnippetId: sandbox.playgroundSnippetId,
      },
    });

    if (sessionData.response.status === "attention-needed") {
      switch (sessionData.response.attentionType) {
        case "cannot-get-new":
          throw new Error("Cannot get new session");
        case "can-terminate-and-get-new":
          throw new Error("Can terminate and get new session");
        case "can-create-account-and-get-new":
          throw new Error("Can create account and get new session");
        default:
          exhaustiveGuard(sessionData.response.attentionType);
      }
    }

    sandbox.playgroundSessionId = sessionData.response.playgroundSessionId;

    const interval = 500;
    const max = Math.ceil(sandbox.timeout / interval);

    for (let i = 0; i < max; i++) {
      const detailsData = await api.getRunningPlaygroundSessionDetails({
        params: {
          playgroundSessionId: sandbox.playgroundSessionId,
          isWaitingForUpscale: false,
          playgroundType: "PlaygroundSnippet",
          playgroundSnippetId: sandbox.playgroundSnippetId,
        },
      });

      if (detailsData.response.isWaitingForUpscale === false) {
        sandbox.containerDetails = detailsData.response.containerDetails;
        await sandbox.connect();
        return sandbox;
      }

      await new Promise((r) => setTimeout(r, interval));
    }

    throw new Error("Provisioning timeout");
  }

  async connect(): Promise<void> {
    if (this.containerDetails != null) {
      const wsUrl = `wss://${this.containerDetails.subdomain}-13372.run-code.com`;

      this.ws = new SandboxWebSocket(
        wsUrl,
        this.containerDetails.playgroundContainerAccessToken,
      );
      await this.ws.connect();

      await this.ws.waitForNextFutureWebSocketEvent({
        eventType: "ContainerServerReady",
        timeout: 10000,
      }); // TODO: check timeout
    }
  }

  disconnect(): void {
    this.ws?.disconnect();
    this.ws = null;
  }

  async getFile(path: string): Promise<ArrayBuffer> {
    if (this.containerDetails != null) {
      const url = new URL(
        `https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`,
      );
      url.searchParams.append("full-path", path);
      url.searchParams.append(
        "playground-container-access-token",
        this.containerDetails.playgroundContainerAccessToken,
      );

      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`File not found: ${path}`);
        }
        throw new Error(`Failed to get file: ${response.statusText}`);
      }

      const content = await response.arrayBuffer();
      return content;
    } else {
      throw new Error("No container found");
    }
  }

  async setFile({
    path,
    content,
  }: {
    path: string;
    content: string | ArrayBuffer;
  }): Promise<void> {
    if (this.containerDetails != null) {
      const url = new URL(
        `https://${this.containerDetails.subdomain}-13372.run-code.com/static-server`,
      );
      url.searchParams.append("full-path", path);
      url.searchParams.append(
        "playground-container-access-token",
        this.containerDetails.playgroundContainerAccessToken,
      );

      const response = await fetch(url, {
        method: "PUT",
        body: content,
      });

      if (!response.ok) {
        throw new Error(`Failed to set file: ${response.statusText}`);
      }
    } else {
      throw new Error("No container found");
    }
  }

  async runStreamingCommand(options: {
    cmd: string;
    args: string[];
    stdin?: string;
    onStdout?: (stdout: string) => void;
    onStderr?: (stderr: string) => void;
    onClose?: (exitCode: number) => void;
  }): Promise<void> {
    if (this.ws != null) {
      const data: Record<string, string | string[]> = { command: options.cmd };
      data.args = options.args;
      if (options.stdin != null) {
        data.stdin = options.stdin;
      }

      const startResponse = await this.ws.send({
        payload: {
          eventType: "RunLongRunningCommand",
          data: {
            command: options.cmd,
            args: options.args,
            stdin: options.stdin,
          },
        },
      });

      if (startResponse.eventType === "RunLongRunningCommand") {
        const { uniqueTaskId } = startResponse.data;

        while (this.ws.isConnected()) {
          const payload = await this.ws.waitForNextFutureWebSocketEvent({
            eventType: "StreamLongRunningTaskEvent",
            timeout: 3000,
          }); // TODO: check timeout

          if (payload.eventType === "StreamLongRunningTaskEvent") {
            if (payload.uniqueTaskId !== uniqueTaskId) continue;

            const eventDetails = payload.eventDetails;

            if (eventDetails.type === "io") {
              if (eventDetails.stdout != null) {
                options.onStdout?.(eventDetails.stdout);
              }
              if (eventDetails.stderr != null) {
                options.onStderr?.(eventDetails.stderr);
              }
            } else if (eventDetails.type === "close") {
              const exitCode = eventDetails.code ?? 0; // TODO: check exit code - backend is sending null as fallback

              if (eventDetails.error != null) {
                throw new Error(eventDetails.error);
              }
              options.onClose?.(exitCode);

              return;
            }
          }
        }
      } else {
        throw new Error("Unexpected response event type");
      }
    } else {
      throw new Error("Not connected");
    }
  }

  async runCommand(options: { cmd: string; args?: string[] }): Promise<{
    stdout: string;
    stderr: string;
  }> {
    if (this.ws != null) {
      const fullCommand = options.args
        ? `${options.cmd} ${options.args.join(" ")}`
        : options.cmd;

      const response = await this.ws.send({
        payload: {
          eventType: "EvalSmallCodeSnippetInsideContainer",
          command: fullCommand,
        },
      });

      if (response.eventType === "EvalSmallCodeSnippetInsideContainer") {
        return {
          stdout: response.stdout,
          stderr: response.stderr,
        };
      } else {
        throw new Error("Unexpected response event type");
      }
    } else {
      throw new Error("Not connected");
    }
  }

  getSessionId(): string | null {
    return this.playgroundSessionId;
  }

  getContainerDetails(): ContainerDetails | null {
    return this.containerDetails;
  }

  isConnected(): boolean {
    return this.ws?.isConnected() ?? false;
  }
}
