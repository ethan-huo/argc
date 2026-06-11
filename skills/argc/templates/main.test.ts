import { expect, test } from 'bun:test'

const ENTRY = `${import.meta.dir}/main.ts`

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
	const { stdout, exitCode } = await run('hello', '--name', 'world', '--loud')
	expect(exitCode).toBe(0)
	expect(stdout).toContain('HELLO, WORLD!')
})

test('--schema is agent-readable', async () => {
	const { stdout, exitCode } = await run('--schema')
	expect(exitCode).toBe(0)
	expect(stdout).toContain('hello(')
})
