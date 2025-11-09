import { Sandbox } from './index'

async function main() {
	// Create sandbox instance
	const sandbox = new Sandbox({ apiKey: 'your-api-key-here' })

	try {
		// Connect and wait for repository to clone
		const snippetId = await sandbox.create({
			shouldBackupFilesystem: true,
			gitRepoUrl: 'https://github.com/gautamtayal1/perpetual-trading'
		})
		console.log('Connected to sandbox')
		console.log('Snippet ID:', snippetId)

		// List cloned files
		const { stdout } = await sandbox.runCommand({
			cmd: 'ls',
			args: ['-la', '/home/damner/perpetual-trading']
		})
		console.log('Repository contents:', stdout)

		// Read package.json
		const response = await sandbox.getFile('/home/damner/perpetual-trading/package.json')
		const packageJson = JSON.parse(await response.text())
		console.log('Project name:', packageJson.name)

		// Install dependencies
		const { exitCode } = await sandbox.runStreamingCommand({
			cmd: 'bash',
			args: ['-c', 'cd /home/damner/perpetual-trading && pnpm install'],
			onStdout: data => process.stdout.write(data),
			onStderr: data => process.stderr.write(data)
		})
		console.log('Installation finished with code:', exitCode)

		// Create and run a test file
		await sandbox.writeFile({
			path: '/home/damner/perpetual-trading/test.js',
			content: 'console.log("Hello from sandbox")'
		})

		await sandbox.runStreamingCommand({
			cmd: 'node',
			args: ['/home/damner/perpetual-trading/test.js'],
			onStdout: data => console.log(data.trim())
		})
	} finally {
		// Always disconnect to clean up resources
		await sandbox.disconnect()
	}
}

main().catch(console.error)
