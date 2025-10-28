export type WebSocketRequestPayload =
  | {
      eventType: "RunLongRunningCommand";
      data: {
        command: string;
        args: string[];
        stdin?: string;
      };
    }
  | {
      eventType: "EvalSmallCodeSnippetInsideContainer";
      command: string;
    }
  | {
      eventType: "HealthPing";
    };

export type WebSocketResponsePayload =
  | {
      eventType: "RunLongRunningCommand";
      data: {
        uniqueTaskId: string;
        processId: number;
      };
    }
  | {
      eventType: "EvalSmallCodeSnippetInsideContainer";
      stdout: string;
      stderr: string;
    }
  | {
      eventType: "HealthPing";
      status: "healthy";
    }
  | {
      eventType: "StreamLongRunningTaskEvent";
      uniqueTaskId: string;
      processId: number;
      eventDetails:
        | {
            type: "io";
            stdout?: string;
            stderr?: string;
          }
        | {
            type: "close";
            code: number | null;
            error: string | null;
          };
    };
