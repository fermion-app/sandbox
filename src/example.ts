import { Sandbox } from './index'

/**
 * Fermion Sandbox SDK - Example Usage
 *
 * This example demonstrates the core features of the Fermion Sandbox SDK:
 * - Creating and managing sandbox instances
 * - Running commands (both simple and streaming)
 * - File operations (read/write)
 */

async function main() {
	try {
		// 1. Create a sandbox instance
		console.log('Creating sandbox...')
		const sandbox = await Sandbox.create({
			apiKey: process.env.API_KEY ?? ''
		})

		console.log('✓ Sandbox created')
		console.log('  Session ID:', sandbox.getSessionId())
		console.log()

		// 2. Run simple commands
		console.log('Running commands...')

		const { stdout: greeting } = await sandbox.runCommand({
			cmd: 'echo',
			args: ['Hello from Fermion!']
		})
		console.log('✓', greeting.trim())

		const { stdout: workDir } = await sandbox.runCommand({
			cmd: 'pwd'
		})
		console.log('✓ Working directory:', workDir.trim())
		console.log()

		// 3. File operations
		console.log('Working with files...')

		// Write a file
		await sandbox.setFile({
			path: '/home/damner/code/hello.txt',
			content: 'Hello from Fermion Sandbox SDK!'
		})
		console.log('✓ File written: hello.txt')

		// Read it back
		const content = await sandbox.getFile('/home/damner/code/hello.txt')
		const decoder = new TextDecoder()
		console.log('✓ File content:', decoder.decode(content))
		console.log()

		// 4. Create and execute a script
		console.log('Creating and running a script...')

		await sandbox.setFile({
			path: '/home/damner/code/script.js',
			content: `
const pkg = require('./package.json');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Project:', pkg.name || 'unnamed');
      `.trim()
		})

		// Initialize a package.json
		await sandbox.runCommand({
			cmd: 'sh',
			args: ['-c', 'cd /home/damner/code && npm init -y > /dev/null 2>&1']
		})

		const { stdout: scriptOutput } = await sandbox.runCommand({
			cmd: 'node',
			args: ['/home/damner/code/script.js']
		})
		console.log(scriptOutput.trim())
		console.log()

		// 5. Streaming command example
		console.log('Running streaming command...')

		await sandbox.runStreamingCommand({
			cmd: 'sh',
			args: ['-c', 'for i in 1 2 3; do echo "Step $i"; sleep 0.5; done; echo "Done!"'],
			onStdout: data => process.stdout.write(`  ${data}`),
			onClose: exitCode => {
				console.log(`✓ Command completed (exit code: ${exitCode})`)
			}
		})
		console.log()

		// 6. Clean up
		console.log('Disconnecting sandbox...')
		await sandbox.disconnect()
		console.log('✓ Done!')
	} catch (error) {
		console.error('Error:', error instanceof Error ? error.message : error)
		throw error
	}
}

// Run the example
main()
