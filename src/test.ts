import { Sandbox } from '.'

async function main() {
	try {
		// 1. Create a sandbox instance
		console.log('Creating sandbox...')
		const sandbox = await Sandbox.create({
			apiKey: 'aml8s6s1jtl22l38nzejrbgjbpspapo633j7fglu5xn0o0bwtm4rqrsqgl0v72gk2gk1053gl8cm6wsp0pp6byjf8k6bbeabsfhfquioj3kdacdo0vzy4008vn7vfahi',
      gitRepoUrl: 'https://github.com/gautamtayal1/perpetual-trading'
		})

		console.log('✓ Sandbox created')
		console.log('  Session ID:', sandbox.getSessionId())
		
    const { stdout } = await sandbox.runCommand({
      cmd: 'bash',
      args: ['-c', 'echo "Hello, World!"']
    })
    console.log(stdout)

    await sandbox.setFile({
      path: '/home/damner/code/index.js',
      content: 'console.log("Hello, World!")'
    })
    
    const fileContent = await sandbox.getFile('/home/damner/code/index.js')
    console.log(await fileContent.text())

    const { stdout: scriptOutput } = await sandbox.runCommand({
      cmd: 'node',
      args: ['/home/damner/code/index.js']
    })
    console.log(scriptOutput)

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
