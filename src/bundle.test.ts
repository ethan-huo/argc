import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempDirs.push(dir)
	return dir
}

describe('downstream bundles', () => {
	test('@schema does not initialize the native @run parser', () => {
		const root = tempDir('argc-bundle-')
		const outfile = join(root, 'demo.js')
		const ttyFile = join(root, 'schema.tty')
		const built = Bun.spawnSync([
			'bun',
			'build',
			'examples/demo.ts',
			'--target=bun',
			`--outfile=${outfile}`,
		])
		expect(built.exitCode).toBe(0)

		// Bun only renders auto-install resolution progress on a TTY. `script`
		// gives us that surface without making the assertion depend on stdout
		// capture suppressing the exact regression.
		const command =
			process.platform === 'darwin'
				? ['script', '-q', ttyFile, 'bun', outfile, '@schema']
				: [
						'script',
						'-q',
						'-c',
						`bun ${JSON.stringify(outfile)} @schema`,
						ttyFile,
					]
		const run = Bun.spawnSync(command)
		expect(run.exitCode).toBe(0)
		const output = readFileSync(ttyFile, 'utf8')
		expect(output).toContain('type Demo =')
		expect(output).not.toContain('Resolving')
		expect(output).not.toContain('@oxc-parser')
	})
})
