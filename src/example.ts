import { Sandbox } from './index'

/**
 * Example: Working with a real repository
 *
 * This example demonstrates:
 * - Creating a sandbox and cloning a repository
 * - Reading and writing files
 * - Running commands (both quick and streaming)
 * - Installing dependencies
 */
async function main() {
	const apiKey = ''

	// Create sandbox instance
	const sandbox = new Sandbox({
		apiKey,
		gitRepoUrl: 'https://github.com/gautamtayal1/perpetual-trading'
	})

	try {
		// Connect and wait for repository to clone
		await sandbox.connect()
		console.log('Connected to sandbox')

		// List cloned files
		const { stdout } = await sandbox.runCommand({
			cmd: 'ls',
			args: ['-la', '/home/damner/code/perpetual-trading']
		})
		console.log('Repository contents:', stdout)

		// Read package.json
		const response = await sandbox.getFile('/home/damner/code/perpetual-trading/package.json')
		const packageJson = JSON.parse(await response.text())
		console.log('Project name:', packageJson.name)

		// Install dependencies
		await new Promise<void>((resolve) => {
			sandbox.runStreamingCommand({
				cmd: 'bash',
				args: ['-c', 'cd /home/damner/code/perpetual-trading && pnpm install'],
				onStdout: (data) => process.stdout.write(data),
				onStderr: (data) => process.stderr.write(data),
				onClose: (code) => {
					console.log('Installation finished with code:', code)
					resolve()
				}
			})
		})

		// Create and run a test file
		await sandbox.setFile({
			path: '/home/damner/code/perpetual-trading/test.js',
			content: 'console.log("Hello from sandbox")'
		})

		await new Promise<void>((resolve) => {
			sandbox.runStreamingCommand({
				cmd: 'node',
				args: ['/home/damner/code/perpetual-trading/test.js'],
				onStdout: (data) => console.log(data.trim()),
				onClose: () => resolve()
			})
		})

	} finally {
		// Always disconnect to clean up resources
		await sandbox.disconnect()
	}
}

main().catch(console.error)
