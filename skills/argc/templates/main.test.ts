import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO_DIR = dirname(dirname(dirname(import.meta.dir)))
const PROJECT_DIR = join(REPO_DIR, `.tmp-template-test-${process.pid}`)
const ENTRY = join(PROJECT_DIR, 'src', 'main.ts')

async function run(...args: string[]) {
	await ensureProject()
	const proc = Bun.spawn(['bun', 'run', ENTRY, ...args], { stderr: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	return { stdout, stderr, exitCode }
}

async function ensureProject() {
	if (existsSync(ENTRY)) return

	rmSync(PROJECT_DIR, { force: true, recursive: true })
	mkdirSync(join(PROJECT_DIR, 'src'), { recursive: true })
	mkdirSync(join(PROJECT_DIR, 'node_modules'), { recursive: true })
	symlinkSync(REPO_DIR, join(PROJECT_DIR, 'node_modules', 'argc'), 'dir')
	await Bun.write(ENTRY, Bun.file(join(import.meta.dir, 'main.ts')))
	await Bun.write(
		join(PROJECT_DIR, 'package.json'),
		Bun.file(join(import.meta.dir, 'package.json')),
	)
}

afterAll(() => {
	rmSync(PROJECT_DIR, { force: true, recursive: true })
})

test('hello', async () => {
	const { stdout, stderr, exitCode } = await run(
		'hello',
		'--name',
		'world',
		'--loud',
	)
	expect(exitCode, stderr).toBe(0)
	expect(stdout).toContain('HELLO, WORLD!')
})

test('--schema is agent-readable', async () => {
	const { stdout, stderr, exitCode } = await run('--schema')
	expect(exitCode, stderr).toBe(0)
	expect(stdout).toContain('hello(')
})
