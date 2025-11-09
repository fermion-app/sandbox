import { Sandbox } from '../../src'
import dotenv from 'dotenv'

dotenv.config()

async function main() {
	const apiKey = process.env.FERMION_API_KEY
	if (!apiKey) {
		console.error('FERMION_API_KEY environment variable is required')
		process.exit(1)
	}

	const sandbox = new Sandbox({ apiKey })

	try {
		await sandbox.create({ shouldBackupFilesystem: false })

		// Given an array of integers and a target, find two numbers that add up to target
		const result = await sandbox.quickRun({
			runtime: 'Python',
			sourceCode: `nums = list(map(int, input().split()))
target = int(input())

def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []

result = twoSum(nums, target)
print(' '.join(map(str, result)))`,
			stdin: '2 7 11 15\n9',
			expectedOutput: '0 1\n'
		})

		if (result?.programRunData) {
			const stdout = result.programRunData.stdoutBase64UrlEncoded ?? ''
			console.log('Input: [2, 7, 11, 15], target = 9')
			console.log('Output:', stdout.trim())
			console.log('Status:', result.runStatus)
			console.log('Correct:', result.runStatus === 'successful')
		}
	} finally {
		await sandbox.disconnect()
	}
}

main().catch(console.error)
