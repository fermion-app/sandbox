import { Sandbox } from './index'

async function main() {
	try {
		console.log('=== Fermion Sandbox SDK - Real Project Example ===\n')

		// 1. Create and connect to sandbox with git repo
		console.log('1. Creating sandbox and cloning repository...')
		const sandbox = new Sandbox({
			apiKey: process.env.API_KEY ?? 'aml8s6s1jtl22l38nzejrbgjbpspapo633j7fglu5xn0o0bwtm4rqrsqgl0v72gk2gk1053gl8cm6wsp0pp6byjf8k6bbeabsfhfquioj3kdacdo0vzy4008vn7vfahi',
			gitRepoUrl: 'https://github.com/gautamtayal1/perpetual-trading'
		})
		await sandbox.connect()
		console.log('Connected and repository cloned!\n')

		// 2. Check what was cloned
		console.log('2. Listing project files...')
		const { stdout: lsOutput } = await sandbox.runCommand({
			cmd: 'ls',
			args: ['-la', '/home/damner/code/perpetual-trading']
		})
		console.log(`   Files:\n${lsOutput}\n`)

		// 3. Read package.json to see project details
		console.log('3. Reading package.json...')
		const pkgResponse = await sandbox.getFile('/home/damner/code/perpetual-trading/package.json')
		const pkgText = await pkgResponse.text()
		const pkg = JSON.parse(pkgText)
		console.log(`   Project: ${pkg.name}`)
		console.log(`   Description: ${pkg.description || 'N/A'}\n`)

		// 4. Install dependencies (streaming command)
		console.log('4. Installing dependencies with pnpm...')
		await new Promise<void>((resolve) => {
			void sandbox.runStreamingCommand({
				cmd: 'bash',
				args: ['-c', 'cd /home/damner/code/perpetual-trading && pnpm install'],
				onStdout: (data) => {
					if (data.trim()) console.log(`   ${data.trim()}`)
				},
				onStderr: (data) => {
					if (data.trim()) console.log(`   ${data.trim()}`)
				},
				onClose: (exitCode) => {
					console.log(`✓ Installation complete (exit code: ${exitCode})\n`)
					resolve()
				}
			})
		})

		// 5. Create a test file in the project
		console.log('5. Creating a test file...')
		await sandbox.setFile({
			path: '/home/damner/code/perpetual-trading/test-sandbox.js',
			content: 'console.log("Running in Fermion Sandbox!")\nconsole.log("Node version:", process.version)'
		})
		console.log('✓ Test file created\n')

		// 6. Run the test file
		console.log('6. Running test file...')
		await new Promise<void>((resolve) => {
			void sandbox.runStreamingCommand({
				cmd: 'node',
				args: ['/home/damner/code/perpetual-trading/test-sandbox.js'],
				onStdout: (data) => console.log(`   ${data.trim()}`),
				onStderr: (data) => console.error(`   Error: ${data}`),
				onClose: (exitCode) => {
					console.log(`✓ Test completed (exit code: ${exitCode})\n`)
					resolve()
				}
			})
		})

		// 7. Disconnect
		console.log('7. Disconnecting...')
		await sandbox.disconnect()
		console.log('✓ Disconnected!\n')

		console.log('=== All examples completed successfully! ===')
	} catch (error) {
		console.error('❌ Error:', error instanceof Error ? error.message : error)
		process.exit(1)
	}
}

// Run the example
main()
