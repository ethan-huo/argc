import { expect, test } from 'bun:test'
import { join } from 'node:path'

// Exercise the same entry point and dependency graph users install.
const ENTRY = join(import.meta.dir, 'main.ts')

async function run(...args: string[]) {
	const proc = Bun.spawn(['bun', 'run', ENTRY, ...args], { stderr: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	return { stdout, stderr, exitCode }
}

test('hello', async () => {
	const { stdout, stderr, exitCode } = await run(
		'hello',
		"{ name: 'world', loud: true }",
	)
	expect(exitCode, stderr).toBe(0)
	expect(stdout).toContain('HELLO, WORLD!')
})

// `@schema` is the agent-facing UI, so a broken schema is a broken product.
test('@schema is agent-readable', async () => {
	const { stdout, stderr, exitCode } = await run('@schema')
	expect(exitCode, stderr).toBe(0)
	expect(stdout).toContain('hello(')
})
