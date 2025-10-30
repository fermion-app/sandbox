/**
 * Union type of all possible WebSocket request payloads sent to the container
 *
 * @remarks
 * These are the message types you can send via the WebSocket connection.
 * Each type has a specific eventType and associated data.
 *
 * @public
 */
export type WebSocketRequestPayload =
	| {
			/** Start a long-running command with streaming output */
			eventType: 'RunLongRunningCommand'
			data: {
				/** Command to execute (e.g., 'npm', 'git') */
				command: string
				/** Command arguments as array */
				args: string[]
				/** Optional stdin to pipe to the command */
				stdin?: string
			}
	  }
	| {
			/** Execute a quick command and get complete output */
			eventType: 'EvalSmallCodeSnippetInsideContainer'
			/** Full command string to execute */
			command: string
	  }
	| {
			/** Keep-alive ping to maintain connection */
			eventType: 'HealthPing'
	  }

/**
 * Union type of all possible WebSocket response payloads received from the container
 *
 * @remarks
 * These are the message types the container can send back.
 * Some are direct responses to requests, others are streaming events.
 *
 * @public
 */
export type WebSocketResponsePayload =
	| {
			/** Response confirming long-running command started */
			eventType: 'RunLongRunningCommand'
			data: {
				/** Unique task ID for tracking this command's output */
				uniqueTaskId: string
				/** Process ID of the spawned command */
				processId: number
			}
	  }
	| {
			/** Response with complete command output */
			eventType: 'EvalSmallCodeSnippetInsideContainer'
			/** Standard output from the command */
			stdout: string
			/** Standard error from the command */
			stderr: string
	  }
	| {
			/** Health ping acknowledgment */
			eventType: 'HealthPing'
			/** Always 'healthy' if container is running */
			status: 'healthy'
	  }
	| {
			/** Streaming event for long-running command output */
			eventType: 'StreamLongRunningTaskEvent'
			/** Task ID to match with the running command */
			uniqueTaskId: string
			/** Process ID of the command */
			processId: number
			/** Event details - either IO data or close notification */
			eventDetails:
				| {
						/** IO event type - stdout/stderr data */
						type: 'io'
						/** Standard output chunk (if any) */
						stdout?: string
						/** Standard error chunk (if any) */
						stderr?: string
				  }
				| {
						/** Close event type - command finished */
						type: 'close'
						/** Exit code (0 = success, non-zero = error) */
						code: number | null
						/** Error message if command failed */
						error: string | null
				  }
	  }
