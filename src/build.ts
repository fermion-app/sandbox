import { build } from 'tsup'

async function run() {
	await build({
		entry: ['src/index.ts'],
		format: ['cjs', 'esm'],
		target: 'es2020',
		splitting: false,
		clean: true,
		dts: true,
		outDir: 'dist',
		noExternal: ['zod'],
		esbuildOptions(options) {
			options.platform = 'node'
		}
	})
}

void run()

export {}
