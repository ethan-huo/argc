import { afterEach, describe, expect, test } from 'bun:test'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { c, cli } from './index'
import { ensureTrailingNewline, formatBareSkill, pickFiles } from './skill'

class ExitError extends Error {
	code: number

	constructor(code: number) {
		super(`exit ${code}`)
		this.code = code
	}
}

async function capture(
	fn: () => Promise<void> | void,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	let stdout = ''
	let stderr = ''
	const originalStdout = process.stdout.write
	const originalStderr = process.stderr.write
	const originalExit = process.exit

	process.stdout.write = ((
		chunk: string | Uint8Array,
		callback?: (error?: Error | null) => void,
	) => {
		stdout += String(chunk)
		callback?.()
		return true
	}) as typeof process.stdout.write
	process.stderr.write = ((chunk: string | Uint8Array) => {
		stderr += String(chunk)
		return true
	}) as typeof process.stderr.write
	process.exit = ((code?: string | number | null) => {
		throw new ExitError(typeof code === 'number' ? code : 0)
	}) as typeof process.exit

	try {
		await fn()
		return { stdout, stderr, exitCode: 0 }
	} catch (error) {
		if (error instanceof ExitError) {
			return { stdout, stderr, exitCode: error.code }
		}
		throw error
	} finally {
		process.stdout.write = originalStdout
		process.stderr.write = originalStderr
		process.exit = originalExit
	}
}

const tempDirs: string[] = []

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	tempDirs.push(dir)
	return dir
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function app(skill?: Record<string, string>) {
	const options: {
		name: string
		version: string
		skill?: Record<string, string>
	} = { name: 'demo', version: '7.8.0' }
	if (skill) options.skill = skill
	return cli({ ping: c }, options)
}

const handlers = { ping: () => 'pong' }

describe('@skill dispatch', () => {
	test('unconfigured → NO_SKILL', async () => {
		const result = await capture(() => app().run({ handlers }, ['@skill']))
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: NO_SKILL')
		expect(result.stderr).toContain('this tool embeds no skill')
	})

	test('bare @skill prints body + sorted files block, excluding SKILL.md', async () => {
		const result = await capture(() =>
			app({
				'types/api.d.ts': 'export type X = 1\n',
				'SKILL.md': '# Guide\n\nUse @schema.\n',
				'references/z.md': 'z\n',
				'references/a.md': 'a\n',
			}).run({ handlers }, ['@skill']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe(
			[
				'# Guide',
				'',
				'Use @schema.',
				'',
				'---',
				'',
				'files:',
				'references/a.md',
				'references/z.md',
				'types/api.d.ts',
				'',
				'read: demo @skill <path>',
				'',
			].join('\n'),
		)
	})

	test('bare @skill omits the files block when VFS is only SKILL.md', async () => {
		const result = await capture(() =>
			app({ 'SKILL.md': '# Solo\n' }).run({ handlers }, ['@skill']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('# Solo\n')
		expect(result.stdout).not.toContain('---')
		expect(result.stdout).not.toContain('files:')
	})

	test('bare @skill with a missing SKILL.md key is a configuration error', async () => {
		const result = await capture(() =>
			app({ 'references/foo.md': 'foo\n' }).run({ handlers }, ['@skill']),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: RUNTIME_ERROR')
		expect(result.stderr).toContain('missing SKILL.md')
	})

	test('@skill <path> prints a known file verbatim, ensuring a trailing newline', async () => {
		const result = await capture(() =>
			app({
				'SKILL.md': '# Guide\n',
				'references/foo.md': 'hello `${x}` and "quotes"',
			}).run({ handlers }, ['@skill', 'references/foo.md']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('hello `${x}` and "quotes"\n')
	})

	test('@skill unknown path → UNKNOWN_SKILL_FILE with files and did_you_mean', async () => {
		const result = await capture(() =>
			app({
				'SKILL.md': '# Guide\n',
				'references/foo.md': 'foo\n',
			}).run({ handlers }, ['@skill', 'references/fo.md']),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: UNKNOWN_SKILL_FILE')
		expect(result.stderr).toContain('got: references/fo.md')
		expect(result.stderr).toContain('did_you_mean: references/foo.md')
		expect(result.stderr).toContain('SKILL.md')
		expect(result.stderr).toContain('references/foo.md')
	})

	test('@skill unknown path omits did_you_mean when nothing is close', async () => {
		const result = await capture(() =>
			app({ 'SKILL.md': '# Guide\n' }).run({ handlers }, [
				'@skill',
				'zzzzzzzz.md',
			]),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: UNKNOWN_SKILL_FILE')
		expect(result.stderr).not.toContain('did_you_mean:')
	})

	test('@skill with two args is a usage error', async () => {
		const result = await capture(() =>
			app({ 'SKILL.md': '# Guide\n' }).run({ handlers }, [
				'@skill',
				'SKILL.md',
				'extra',
			]),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: RUNTIME_ERROR')
		expect(result.stderr).toContain('at most one path')
	})

	test('help mentions @skill only when a skill is embedded', async () => {
		const without = await capture(() => app().run({ handlers }, ['--help']))
		expect(without.exitCode).toBe(0)
		expect(without.stdout).not.toContain('demo @skill')

		const withSkill = await capture(() =>
			app({ 'SKILL.md': '# Guide\n' }).run({ handlers }, ['--help']),
		)
		expect(withSkill.exitCode).toBe(0)
		expect(withSkill.stdout).toContain(
			'`demo @skill` prints the agent usage guide.',
		)
	})
})

describe('formatBareSkill', () => {
	test('ensures a trailing newline on a body that lacks one', () => {
		expect(ensureTrailingNewline('hi')).toBe('hi\n')
		expect(ensureTrailingNewline('hi\n')).toBe('hi\n')
		expect(formatBareSkill('body', ['SKILL.md'], 'demo')).toBe('body\n')
	})
})

describe('pickFiles', () => {
	test('selects by glob, sorts keys, and uses posix separators', () => {
		const root = tempDir('argc-skill-pick-')
		writeFileSync(join(root, 'SKILL.md'), '# Guide\n')
		writeFileSync(join(root, 'notes.txt'), 'skip me\n')
		mkdirSync(join(root, 'references'))
		writeFileSync(join(root, 'references', 'z.md'), 'z\n')
		writeFileSync(join(root, 'references', 'a.md'), 'a\n')

		const vfs = pickFiles(root, ['SKILL.md', 'references/**/*.md'])
		expect(vfs).toEqual({
			'SKILL.md': '# Guide\n',
			'references/a.md': 'a\n',
			'references/z.md': 'z\n',
		})
		expect(Object.keys(vfs)).toEqual([
			'SKILL.md',
			'references/a.md',
			'references/z.md',
		])
	})

	test('missing root prints a legible [argc/skill] line then throws', () => {
		const errors: string[] = []
		const original = console.error
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '))
		}
		try {
			expect(() =>
				pickFiles(join(tmpdir(), 'argc-skill-missing-root'), ['SKILL.md']),
			).toThrow(/skill root/)
		} finally {
			console.error = original
		}
		expect(errors.some((line) => line.includes('[argc/skill]'))).toBe(true)
		expect(errors.some((line) => line.includes('does not exist'))).toBe(true)
	})

	test('non-UTF-8 file is rejected after a legible stderr line', () => {
		const root = tempDir('argc-skill-utf8-')
		writeFileSync(join(root, 'SKILL.md'), Buffer.from([0x48, 0x69, 0xff]))
		const errors: string[] = []
		const original = console.error
		console.error = (...args: unknown[]) => {
			errors.push(args.map(String).join(' '))
		}
		try {
			expect(() => pickFiles(root, ['SKILL.md'])).toThrow(/UTF-8/)
		} finally {
			console.error = original
		}
		expect(errors.some((line) => line.includes('[argc/skill]'))).toBe(true)
		expect(errors.some((line) => line.includes('not valid UTF-8'))).toBe(true)
	})
})

describe('macro inlining', () => {
	test('bun build inlines content and drops the picker; import.meta.dir is cwd-independent', () => {
		const root = tempDir('argc-skill-macro-')
		mkdirSync(join(root, 'references'))
		// Distinctive markdown that must appear inline in the bundle. The
		// backslash case is checked via the runtime VFS round-trip below —
		// bun escapes `\` in the generated literal, so a source-text search
		// for the raw bytes would miss.
		const marker = 'MACRO_MARK `ticks` ${interp} "quotes" \\slash'
		writeFileSync(join(root, 'SKILL.md'), `${marker}\n`)
		writeFileSync(join(root, 'references', 'foo.md'), 'foo body\n')
		writeFileSync(
			join(root, 'skill.embed.ts'),
			[
				`import { pickFiles } from ${JSON.stringify(join(import.meta.dir, 'skill.ts'))}`,
				'',
				'export function embedSkill(): Record<string, string> {',
				"	return pickFiles(import.meta.dir, ['SKILL.md', 'references/**/*.md'])",
				'}',
				'',
			].join('\n'),
		)
		writeFileSync(
			join(root, 'entry.ts'),
			[
				"import { embedSkill } from './skill.embed.ts' with { type: 'macro' }",
				'console.log(JSON.stringify(embedSkill()))',
				'',
			].join('\n'),
		)

		const outfile = join(root, 'out.js')
		const built = Bun.spawnSync({
			cmd: [
				'bun',
				'build',
				'--target=bun',
				join(root, 'entry.ts'),
				`--outfile=${outfile}`,
			],
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(built.success, new TextDecoder().decode(built.stderr)).toBe(true)
		const bundled = readFileSync(outfile, 'utf8')
		expect(bundled).toContain('MACRO_MARK `ticks` ${interp}')
		expect(bundled).toContain('foo body')
		expect(bundled).not.toContain('readdirSync')
		expect(bundled).not.toContain('scanSync')

		const ran = Bun.spawnSync({
			cmd: ['bun', join(root, 'entry.ts')],
			cwd: tmpdir(),
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(ran.success, new TextDecoder().decode(ran.stderr)).toBe(true)
		const vfs = JSON.parse(new TextDecoder().decode(ran.stdout)) as Record<
			string,
			string
		>
		expect(Object.keys(vfs).sort()).toEqual(['SKILL.md', 'references/foo.md'])
		expect(vfs['SKILL.md']).toBe(`${marker}\n`)
		expect(vfs['references/foo.md']).toBe('foo body\n')
	})
})
