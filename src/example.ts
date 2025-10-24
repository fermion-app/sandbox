import { Sandbox } from './index.js'

/**
 * Example: How to use the Fermion Sandbox SDK
 *
 * This example demonstrates how to create and interact with a sandbox environment
 * for running code in isolated containers.
 */

async function main() {
	try {
		console.log('Creating sandbox with custom Git repository...')

		// Create a new sandbox instance
		// Snippet will be auto-created with a random name
		const sandbox = await Sandbox.create({
			gitRepoUrl: 'https://github.com/mehulmpt/empty' // Your Git repository URL
		})

		console.log('Sandbox created successfully!')
		console.log('Session ID:', sandbox.getSessionId())
		console.log('Container Details:', sandbox.getContainerDetails())

		// Test command execution
		console.log('\nTesting command execution...')

		// Test 1: Echo command
		const echoResult = await sandbox.runCommand({
			cmd: 'echo',
			args: ['Hello from Fermion Sandbox!']
		})
		console.log('Echo result:', {
			stdout: echoResult?.stdout || '(empty)',
			exitCode: echoResult?.exitCode
		})

		// Test 2: Check current directory
		const pwdResult = await sandbox.runCommand({
			cmd: 'pwd'
		})
		console.log('Current directory:', {
			stdout: pwdResult?.stdout?.trim() || '(empty)',
			exitCode: pwdResult?.exitCode
		})

		// Test 3: List files
		const lsResult = await sandbox.runCommand({
			cmd: 'ls',
			args: ['-la', '/home/damner/code']
		})
		console.log('Files in /home/damner/code:', {
			stdout: lsResult?.stdout || '(empty)',
			exitCode: lsResult?.exitCode
		})

		// Test file operations
		console.log('\nTesting file operations...')

		// Write a file
		console.log('Writing file: /home/damner/code/hello.txt')
		await sandbox.setFile('/home/damner/code/hello.txt', 'Hello from Fermion Sandbox SDK!')

		// Read the file back
		console.log('Reading file: /home/damner/code/hello.txt')
		const fileContent = await sandbox.getFile('/home/damner/code/hello.txt')
		console.log('File content:', fileContent)

		// Create a more complex example
		console.log('\nCreating a Node.js file...')
		await sandbox.setFile(
			'/home/damner/code/test.js',
			`console.log('Hello from Node.js!')
console.log('Current time:', new Date().toISOString())`
		)

		// Run the Node.js file
		console.log('Running Node.js file...')
		const nodeResult = await sandbox.runCommand({
			cmd: 'node',
			args: ['/home/damner/code/test.js']
		})
		console.log('Node.js output:', {
			stdout: nodeResult?.stdout || '(empty)',
			exitCode: nodeResult?.exitCode
		})

		// Keep the sandbox alive for testing
		console.log('\n✅ All tests completed successfully!')
		console.log('Keeping sandbox alive for 30 seconds...')
		console.log('Press Ctrl+C to exit early')

		// Keep alive for 30 seconds then exit cleanly
		await new Promise(resolve => setTimeout(resolve, 30000))

		// Clean shutdown
		console.log('\nDisconnecting sandbox...')
		sandbox.disconnect()
		console.log('Done!')
		process.exit(0)
	} catch (error) {
		console.error('Error occurred:', error)
		process.exit(1)
	}
}

// Run the example
void main()
