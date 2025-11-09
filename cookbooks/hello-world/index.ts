import { Sandbox } from '@fermion-app/sandbox'
import dotenv from 'dotenv'

dotenv.config()

async function main() {
	const apiKey = process.env.FERMION_API_KEY
	if (!apiKey) {
		console.error('FERMION_API_KEY environment variable is required')
		process.exit(1)
	}

	const sandbox = new Sandbox({ apiKey })

  const { playgroundSnippetId } = await sandbox.create({
    shouldBackupFilesystem: false
  })
  console.log('Sandbox created, snippet ID:', playgroundSnippetId)

  await sandbox.writeFile({
    path: '/home/damner/hello-world.js',
    content: 'console.log("Hello from Fermion Sandbox!")'
  })

  const fileResponse = await sandbox.getFile('/home/damner/hello-world.js')
  const fileContent = await fileResponse.text()
  console.log('File contents:')
  console.log(fileContent)

  const { stdout } = await sandbox.runCommand({
    cmd: 'node',
    args: ['~/hello-world.js']
  })
  console.log('Output:')
  console.log(stdout)

	await sandbox.disconnect()
}

main().catch(console.error)
