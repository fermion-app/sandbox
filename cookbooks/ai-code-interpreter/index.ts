import { Sandbox } from '@fermion-app/sandbox'
import { OpenAI } from 'openai'
import { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources'
import dotenv from 'dotenv'

dotenv.config()

const MODEL_NAME = 'gpt-4o'

const SYSTEM_PROMPT = `You are a Python data scientist. You are given tasks to complete and you run Python code to solve them.

- The Python code runs in an isolated sandbox environment WITHOUT a display/GUI
- IMPORTANT: The following packages are ALREADY INSTALLED and available: matplotlib, numpy, pandas, scipy
- DO NOT try to install these packages - they are already available. Just import and use them directly.
- DO NOT use shell commands like !pip install or subprocess to install packages - they are already installed.
- Every time you call execute_python tool, the Python code is executed in the sandbox container
- IMPORTANT: For matplotlib visualizations, you MUST follow this EXACT order:
  1. FIRST: Set matplotlib backend BEFORE importing pyplot: import matplotlib; matplotlib.use('Agg')
  2. THEN: Import pyplot: import matplotlib.pyplot as plt
  3. Create your plots normally
  4. Save plots to files using plt.savefig('/home/damner/filename.png') instead of plt.show()
  5. Print a confirmation message like: print("Plot saved to /home/damner/filename.png")
- Example correct code:
  import matplotlib
  matplotlib.use('Agg')
  import matplotlib.pyplot as plt
  import numpy as np
  # ... your plotting code ...
  plt.savefig('/home/damner/plot.png')
  print("Plot saved successfully to /home/damner/plot.png")
- Always print confirmation messages when saving files so you know the operation succeeded
- You have access to the internet and can make API requests
- You can run any Python code you want, everything is running in a secure sandbox environment
- When creating visualizations, always save them to files (e.g., /home/damner/plot.png, /home/damner/chart.png) so they can be accessed later`

const tools: Array<ChatCompletionTool> = [
	{
		type: 'function',
		function: {
			name: 'execute_python',
			description:
				'Execute Python code in an isolated sandbox and returns stdout, stderr, and any results.',
			parameters: {
				type: 'object',
				properties: {
					code: {
						type: 'string',
						description: 'The Python code to execute.'
					}
				},
				required: ['code']
			}
		}
	}
]

async function executePython(sandbox: Sandbox, code: string): Promise<string> {
	console.log('\nExecuting Python code:')
	console.log('─'.repeat(60))
	console.log(code)
	console.log('─'.repeat(60))

	try {
		// Write code to a temporary file in the sandbox with unique name
		const scriptPath = `/home/damner/python_script_${Date.now()}.py`
		await sandbox.writeFile({
			path: scriptPath,
			content: code
		})

		// Execute the Python script using runCommand (runs in the sandbox container)
		const result = await sandbox.runCommand({
			cmd: 'python3',
			args: [scriptPath]
		})

		let output = ''
		if (result.stdout) {
			output += `Output:\n${result.stdout}\n`
		}
		if (result.stderr) {
			output += `Errors:\n${result.stderr}\n`
		}

		if (!output.trim()) {
			output = 'Code executed successfully (no output)'
		} else {
			output += '\nExecution completed successfully.'
		}

		return output
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error('Execution error:', errorMessage)
		return `Error executing code: ${errorMessage}`
	}
}

async function chatWithAI(
	sandbox: Sandbox,
	openai: OpenAI,
	messages: Array<ChatCompletionMessageParam>,
	userMessage: string
): Promise<string> {
	if (userMessage) {
		console.log(`\n${'='.repeat(60)}`)
		console.log(`User Message: ${userMessage}`)
		console.log('='.repeat(60))
		messages.push({ role: 'user', content: userMessage })
	}

	try {
		const response = await openai.chat.completions.create({
			model: MODEL_NAME,
			messages: messages,
			tools: tools,
			tool_choice: 'auto'
		})

		for (const choice of response.choices) {
			if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
				for (const toolCall of choice.message.tool_calls) {
					if (toolCall.function.name === 'execute_python') {
						let code: string
						if (
							typeof toolCall.function.arguments === 'object' &&
							'code' in toolCall.function.arguments
						) {
							code = (toolCall.function.arguments as { code: string }).code
						} else {
							code = JSON.parse(toolCall.function.arguments).code
						}

						const executionResult = await executePython(sandbox, code)

						messages.push({
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: toolCall.id,
									type: 'function',
									function: {
										name: toolCall.function.name,
										arguments: toolCall.function.arguments
									}
								}
							]
						})

						messages.push({
							role: 'tool',
							content: executionResult,
							tool_call_id: toolCall.id
						})

						return await chatWithAI(sandbox, openai, messages, '')
					}
				}
			} else {
				const content = choice.message.content
				if (content) {
					console.log('\nAI Response:')
					console.log(content)
					return content
				}
			}
		}
	} catch (error) {
		console.error('Error during API call:', error)
		throw error
	}

	return ''
}

async function main() {
	const fermionApiKey = process.env.FERMION_API_KEY
	const openaiApiKey = process.env.OPENAI_API_KEY

	if (!fermionApiKey) {
		console.error('FERMION_API_KEY environment variable is required')
		process.exit(1)
	}

	if (!openaiApiKey) {
		console.error('OPENAI_API_KEY environment variable is required')
		process.exit(1)
	}

	const sandbox = new Sandbox({ apiKey: fermionApiKey })
	const openai = new OpenAI({ apiKey: openaiApiKey })

	await sandbox.create({
		shouldBackupFilesystem: false
	})

	console.log('Installing Python packages...')
	await sandbox.runStreamingCommand({
		cmd: 'pip3',
		args: ['install', 'matplotlib', 'numpy', 'pandas', 'scipy'],
		onStdout: data => process.stdout.write(data),
		onStderr: data => process.stderr.write(data)
	})

	const messages: Array<ChatCompletionMessageParam> = [
		{
			role: 'system',
			content: SYSTEM_PROMPT
		}
	]

	await chatWithAI(
		sandbox,
		openai,
		messages,
		'Plot a chart visualizing the height distribution of men based on the data you know. Use matplotlib to create a histogram.'
	)

	await chatWithAI(
		sandbox,
		openai,
		messages,
		'Based on what you know about height distributions, what is the name of this distribution? Show me the distribution function and plot it.'
	)

	await sandbox.disconnect()
}

main().catch(console.error)
