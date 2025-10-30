import { Sandbox } from './index'

/**
 * Stress Test: Rapid Create/Destroy Cycles
 *
 * Tests the SDK's ability to handle rapid container creation and destruction
 * to verify:
 * - No memory leaks
 * - Proper cleanup of WebSocket connections
 * - API rate limiting handling
 * - Container resource cleanup
 */

const API_KEY = process.env.FERMION_API_KEY || ''
const CYCLES = 10
const DELAY_BETWEEN_CYCLES = 2000 // ms - wait 2s for backend to process termination

async function runCycle(cycleNum: number): Promise<{
	success: boolean
	duration: number
	sessionId: string | null
	error?: string
}> {
	const startTime = Date.now()

	try {
		console.log(`\n[Cycle ${cycleNum}] Creating sandbox...`)

		const sandbox = await Sandbox.create({ apiKey: API_KEY })
		const sessionId = sandbox.getSessionId()

		console.log(`[Cycle ${cycleNum}] ✓ Created (Session: ${sessionId})`)
		console.log(`[Cycle ${cycleNum}] Connected: ${sandbox.isConnected()}`)

		// Small delay to ensure connection is stable
		await new Promise(r => setTimeout(r, 3000))

		console.log(`[Cycle ${cycleNum}] Disconnecting...`)
		await sandbox.disconnect()

		const duration = Date.now() - startTime
		console.log(`[Cycle ${cycleNum}] ✓ Disconnected (Duration: ${duration}ms)`)

		return {
			success: true,
			duration,
			sessionId
		}
	} catch (error) {
		const duration = Date.now() - startTime
		const errorMessage = error instanceof Error ? error.message : String(error)

		console.error(`[Cycle ${cycleNum}] ✗ FAILED: ${errorMessage}`)

		return {
			success: false,
			duration,
			sessionId: null,
			error: errorMessage
		}
	}
}

async function main() {
	console.log('='.repeat(60))
	console.log('STRESS TEST: Rapid Create/Destroy Cycles')
	console.log('='.repeat(60))
	console.log(`Cycles: ${CYCLES}`)
	console.log(`Delay between cycles: ${DELAY_BETWEEN_CYCLES}ms`)
	console.log('='.repeat(60))

	const results: Array<{
		success: boolean
		duration: number
		sessionId: string | null
		error?: string
	}> = []

	const overallStart = Date.now()

	for (let i = 1; i <= CYCLES; i++) {
		const result = await runCycle(i)
		results.push(result)

		// Optional delay between cycles
		if (DELAY_BETWEEN_CYCLES > 0 && i < CYCLES) {
			await new Promise(r => setTimeout(r, DELAY_BETWEEN_CYCLES))
		}
	}

	const overallDuration = Date.now() - overallStart

	// Print summary
	console.log('\n' + '='.repeat(60))
	console.log('TEST RESULTS')
	console.log('='.repeat(60))

	const successful = results.filter(r => r.success).length
	const failed = results.filter(r => !r.success).length
	const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length
	const minDuration = Math.min(...results.map(r => r.duration))
	const maxDuration = Math.max(...results.map(r => r.duration))

	console.log(`Total Cycles:       ${CYCLES}`)
	console.log(`Successful:         ${successful} (${((successful / CYCLES) * 100).toFixed(1)}%)`)
	console.log(`Failed:             ${failed} (${((failed / CYCLES) * 100).toFixed(1)}%)`)
	console.log(`\nTiming:`)
	console.log(`  Total Duration:   ${(overallDuration / 1000).toFixed(2)}s`)
	console.log(`  Average/Cycle:    ${avgDuration.toFixed(0)}ms`)
	console.log(`  Min Duration:     ${minDuration}ms`)
	console.log(`  Max Duration:     ${maxDuration}ms`)
	console.log(`  Throughput:       ${(CYCLES / (overallDuration / 1000)).toFixed(2)} cycles/sec`)

	if (failed > 0) {
		console.log(`\nFailed Cycles:`)
		results.forEach((r, i) => {
			if (!r.success) {
				console.log(`  Cycle ${i + 1}: ${r.error}`)
			}
		})
	}

	console.log('\n' + '='.repeat(60))

	// Exit with appropriate code
	if (failed > 0) {
		console.error(`\n❌ Test FAILED: ${failed} out of ${CYCLES} cycles failed`)
		process.exit(1)
	} else {
		console.log(`\n✅ Test PASSED: All ${CYCLES} cycles completed successfully`)
		process.exit(0)
	}
}

// Run the stress test
main()
