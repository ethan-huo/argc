import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'

import type { RunConfig } from './types'

import { c, cli, complete, createDefaultSchemaExplorer, group } from './index'

const s = toStandardJsonSchema

class ExitError extends Error {
	code: number

	constructor(code: number) {
		super(`exit ${code}`)
		this.code = code
	}
}

async function capture(fn: () => Promise<void> | void): Promise<{
	stdout: string
	stderr: string
	exitCode: number
}> {
	let stdout = ''
	let stderr = ''
	const originalStdout = process.stdout.write
	const originalStderr = process.stderr.write
	const originalExit = process.exit

	process.stdout.write = ((chunk: string | Uint8Array) => {
		stdout += String(chunk)
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

afterEach(() => {
	delete process.env.ARGC_CTX
})

function makeApp() {
	const schema = {
		user: group(
			{ description: 'User commands' },
			{
				create: c.meta({ description: 'Create a user' }).input(
					s(
						v.object({
							name: v.pipe(v.string(), v.minLength(3)),
							email: v.optional(v.string()),
							'content-type': v.optional(v.string()),
						}),
					),
				),
				list: c
					.meta({ description: 'List users' })
					.input(
						s(v.object({ format: v.optional(v.picklist(['json', 'table'])) })),
					),
			},
		),
		cache: {
			clear: c.input(s(v.object({ all: v.optional(v.boolean()) }))),
		},
		read: c
			.meta({ description: 'Read a file' })
			.input(
				s(
					v.object({
						file: v.string(),
						toc: v.optional(v.boolean()),
						tags: v.optional(v.array(v.string())),
						depth: v.optional(v.number()),
						cache: v.optional(v.boolean()),
						'no-cache': v.optional(v.boolean()),
					}),
				),
			)
			.positional('file'),
	}
	const context = s(v.object({ env: v.picklist(['dev', 'prod']) }))
	const app = cli(schema, {
		name: 'mcpx',
		version: '7.0.0',
		description: 'media pipeline control',
		context,
	})
	const handlers: RunConfig<typeof schema, typeof context>['handlers'] = {
		user: {
			create: ({ input, context }) => {
				console.log('debug line')
				return { id: 1, name: input.name, env: context.env }
			},
			list: ({ input }) => [{ id: 1, name: input.format ?? 'table' }],
		},
		cache: {
			clear: () => undefined,
		},
		read: ({ input, context }) => ({
			...input,
			env: context.env,
		}),
	}
	return { app, handlers, schema }
}

describe('argc 7 command surface', () => {
	test('direct calls parse one quoted object, validate context, and render YAML', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user.create',
				"{ name: 'alice' }",
				'--context',
				"{ env: 'prod' }",
			]),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('id: 1')
		expect(result.stdout).toContain('name: alice')
		expect(result.stdout).toContain('env: prod')
		expect(result.stderr).toContain('debug line')
	})

	test('omitted input is an empty object and undefined result renders empty stdout', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['cache.clear', '--context', "{ env: 'dev' }"]),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('')
	})

	test('@schema renders method signatures without return annotations and quotes input keys', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['@schema', '.user.create']),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('create(input:')
		expect(result.stdout).not.toContain('): unknown')
		expect(result.stdout).toContain('"content-type"?: string')
		expect(result.stdout).toContain('mcpx user.create "{')
		// OKF envelope: --- frontmatter --- body, no `program` label. Small slice =
		// fully shown, so guidance says so and offers no selector noise.
		expect(result.stdout.startsWith('---')).toBe(true)
		expect(result.stdout).toContain('context:')
		expect(result.stdout).toContain('fully shown')
		expect(result.stdout).toContain('call:')
		expect(result.stdout).not.toContain('program:')
		expect(result.stdout).not.toContain('selectors:')
		expect(result.stdout).not.toContain('--toc')
	})

	test('unknown object keys fail before schema validation can strip them', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user.create',
				"{ name: 'al', emial: 'a@x.com' }",
				'--context',
				"{ env: 'dev' }",
			]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('at: name')
		expect(result.stderr).toContain('at: emial')
		expect(result.stderr).toContain('message: unknown key')
		expect(result.stderr).toContain('$schema: |-')
		expect(result.stderr).toContain('create(input:')
		expect(result.stderr).not.toContain('$hint:')
	})

	test('brace-split objects are not reassembled', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['user.create', '{', "name: 'alice'", '}']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error:')
	})

	test('a second input object is a contract error', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user.create',
				"{ name: 'alice' }",
				"{ env: 'prod' }",
			]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: TWO_INPUTS')
	})

	test('space-separated path form is rejected as BAD_PATH', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['user', 'create', "{ name: 'alice' }"]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: BAD_PATH')
		expect(result.stderr).toContain('paths are dotted')
		expect(result.stderr).toContain('mcpx user.create')
		// BAD_PATH's mistake is the separator; the dotted rewrite ($hint) is the fix.
		// No $schema (a still-wrong path resurfaces downstream as UNKNOWN_COMMAND).
		expect(result.stderr).not.toContain('$schema')
	})

	test('unknown dotted command embeds nearest schema slice', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['user.creat', "{ name: 'alice' }"]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: UNKNOWN_COMMAND')
		expect(result.stderr).toContain('did_you_mean: user.create')
		expect(result.stderr).toContain('$schema: |-')
		expect(result.stderr).toContain('create(input:')
	})

	test('@run injects bare command locals and supports strict JSON output', async () => {
		const { app, handlers } = makeApp()
		process.env.ARGC_CTX = "{ env: 'prod' }"
		const result = await capture(() =>
			app.run({ handlers }, [
				'@run',
				'await user.create({ name: "alice" })',
				'--json',
			]),
		)

		expect(result.exitCode).toBe(0)
		expect(JSON.parse(result.stdout)).toEqual({
			id: 1,
			name: 'alice',
			env: 'prod',
		})
		expect(result.stderr).toContain('debug line')
	})

	test('@run can execute a module file and pass argc only', async () => {
		const { app, handlers } = makeApp()
		const file = join(tmpdir(), `argc-run-${Date.now()}.ts`)
		await Bun.write(
			file,
			`export default async function(argc: any) {
				return await argc.handlers.user.create({ name: 'alice' })
			}`,
		)
		try {
			process.env.ARGC_CTX = "{ env: 'dev' }"
			const result = await capture(() =>
				app.run({ handlers }, ['@run', `@${file}`]),
			)
			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain('name: alice')
			expect(result.stdout).toContain('env: dev')
		} finally {
			await Bun.file(file).delete()
		}
	})

	test('run false disables code execution but leaves schema available', async () => {
		const schema = { ping: c.input(s(v.object({}))) }
		const app = cli(schema, { name: 'x', version: '7.0.0', run: false })
		const handlers = { ping: () => 'pong' }

		const disabled = await capture(() =>
			app.run({ handlers }, ['@run', '1 + 1']),
		)
		expect(disabled.exitCode).toBe(1)
		expect(disabled.stderr).toContain('error: RUN_DISABLED')

		const schemaResult = await capture(() => app.run({ handlers }, ['@schema']))
		expect(schemaResult.exitCode).toBe(0)
		expect(schemaResult.stdout).toContain('ping()')
	})

	test('command keys must be identifiers and cannot start with @', () => {
		expect(() =>
			cli(
				{ 'bad-name': c.input(s(v.object({}))) },
				{ name: 'x', version: '7.0.0' },
			),
		).toThrow('Invalid command key: bad-name')
		expect(() =>
			cli(
				{ '@add': c.input(s(v.object({}))) },
				{ name: 'x', version: '7.0.0' },
			),
		).toThrow('Invalid command key: @add')
	})

	test('ambient context is ignored unless the CLI declares a context schema', async () => {
		const schema = { ping: c.input(s(v.object({}))) }
		const app = cli(schema, { name: 'x', version: '7.0.0' })
		const handlers = { ping: () => 'pong' }
		process.env.ARGC_CTX = 'not-json'

		const result = await capture(() => app.run({ handlers }, ['ping']))

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('pong')
	})

	test('explicit context is rejected when the CLI has no context schema', async () => {
		const schema = { ping: c.input(s(v.object({}))) }
		const app = cli(schema, { name: 'x', version: '7.0.0' })
		const handlers = { ping: () => 'pong' }

		const result = await capture(() =>
			app.run({ handlers }, ['ping', '--context', "{ env: 'dev' }"]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_CONTEXT')
		expect(result.stderr).toContain('this CLI declares no context')
	})

	test('completion suggests built-ins and path segments only', () => {
		const { schema } = makeApp()
		expect(complete(schema, { words: [''], current: 0 })).toContain('@schema')
		expect(complete(schema, { words: ['u'], current: 0 })).toEqual([
			'user',
			'user.create',
			'user.list',
		])
		expect(complete(schema, { words: ['user.c'], current: 0 })).toEqual([
			'user.create',
		])
		expect(
			complete(schema, { words: ['user.create', ''], current: 1 }),
		).toEqual([])
	})

	test('help renders YAML examples from the shared schema source', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() => app.run({ handlers }, ['--help']))

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('program: mcpx')
		// help is a block-scalar content section, not a one-line tag
		expect(result.stdout).toContain('help: |')
		// examples render as a |- block (verbatim quotes, no escaped seq)
		expect(result.stdout).toContain('examples: |')
		expect(result.stdout).toContain('mcpx user.create')
		// selectors live inside the help block, not as a floating top-level key
		expect(result.stdout).toContain('selectors:')
		expect(result.stdout).not.toContain('$selectors:')
		expect(result.stdout).not.toContain('CALL')
	})

	test('human path desugars positionals and flags into the same input object', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'read',
				'docs/spec-7.0-behavior.md',
				'--toc',
				'--tags',
				'docs',
				'--tags=spec',
				'--depth',
				'2',
				'--context',
				"{ env: 'prod' }",
			]),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('file: docs/spec-7.0-behavior.md')
		expect(result.stdout).toContain('toc: true')
		expect(result.stdout).toContain('depth: 2')
		expect(result.stdout).toContain('- docs')
		expect(result.stdout).toContain('- spec')
		expect(result.stdout).toContain('env: prod')
	})

	test('human booleans use attached false and keep no-prefixed keys verbatim', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'read',
				'docs/spec.md',
				'--toc=false',
				'--no-cache',
				'--context',
				"{ env: 'dev' }",
			]),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('toc: false')
		expect(result.stdout).toContain('no-cache: true')
		expect(result.stdout).not.toContain('cache: false')
	})

	test('human context can appear before the positional slot', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'read',
				'--context',
				"{ env: 'dev' }",
				'docs/spec.md',
				'--toc',
			]),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('file: docs/spec.md')
		expect(result.stdout).toContain('toc: true')
		expect(result.stdout).toContain('env: dev')
	})

	test('human path fails fast on unknown flags', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', 'docs/spec.md', '--tocc']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('at: tocc')
		expect(result.stderr).toContain('message: unknown flag')
		expect(result.stderr).toContain('$hint: mcpx read --help')
		expect(result.stderr).toContain('$schema: |-')
	})

	test('human path does not swallow a following flag as a missing value', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', 'docs/spec.md', '--depth', '--toc']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('at: depth')
		expect(result.stderr).toContain('message: missing flag value')
		expect(result.stderr).toContain('$hint: mcpx read --help')
		expect(result.stderr).toContain('$schema: |-')
		expect(result.stderr).not.toContain('received "--toc"')
	})

	test('human path unexpected positionals point to command help', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', 'docs/spec.md', 'extra']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('unexpected positional: extra')
		expect(result.stderr).toContain('$hint: mcpx read --help')
		expect(result.stderr).toContain('$schema: |-')
	})

	test('object input cannot mix with human flags', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', "{ file: 'docs/spec.md' }", '--toc']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: TWO_INPUTS')
	})

	test('per-command human help is a control path and reaches no handler', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', '--help']),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('usage:')
		expect(result.stdout).toContain('mcpx read <file>')
		expect(result.stdout).toContain('--toc')
		expect(result.stdout).toContain('--no-cache')
		expect(result.stdout).not.toContain('file: docs')
	})

	test('per-command human help short-circuits after a positional token', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['read', 'docs/spec.md', '--help']),
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('mcpx read <file>')
		expect(result.stdout).not.toContain('file: docs/spec.md')
	})
})

describe('argc 7 selector & context errors (spec)', () => {
	test('@schema selector matching nothing → BAD_SELECTOR + embedded schema', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['@schema', '.nope']),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: BAD_SELECTOR')
		expect(result.stderr).toContain('reason: matched nothing')
		expect(result.stderr).toContain('$schema:')
		expect(result.stderr).not.toContain('UNKNOWN_COMMAND')
	})

	test('malformed @schema selector → BAD_SELECTOR with a reason (not RUNTIME_ERROR)', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['@schema', '.user.{']),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: BAD_SELECTOR')
		expect(result.stderr).toContain('reason:')
		expect(result.stderr).not.toContain('RUNTIME_ERROR')
	})

	test('composed selector unions all branches at any depth', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['@schema', '.{user.create,cache.clear}']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('create(input:')
		expect(result.stdout).toContain('clear(input:')
	})

	test('context validation failure → INVALID_CONTEXT + Context schema', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user.list',
				'{}',
				'--context',
				"{ env: 'staging' }",
			]),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_CONTEXT')
		expect(result.stderr).toContain('at: env')
		expect(result.stderr).toContain('type Context')
	})

	test('malformed context JSON5 → BAD_INPUT_JSON source: context + Context schema', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['user.list', '{}', '--context', '{ env:']),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: BAD_INPUT_JSON')
		expect(result.stderr).toContain('source: context')
		expect(result.stderr).toContain('type Context')
	})

	test('@run --json (trailing) renders strict JSON', async () => {
		const { app, handlers } = makeApp()
		process.env.ARGC_CTX = "{ env: 'dev' }"
		const result = await capture(() =>
			app.run({ handlers }, ['@run', 'await user.list({})', '--json']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('"name"') // JSON quotes keys
	})

	test('@run handler validation error keeps the direct-call envelope ($schema, no $hint)', async () => {
		const { app, handlers } = makeApp()
		process.env.ARGC_CTX = "{ env: 'dev' }"
		const result = await capture(() =>
			app.run({ handlers }, [
				'@run',
				"await user.create({ name: 'al', emial: 'x' })",
			]),
		)
		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('command: user.create')
		expect(result.stderr).toContain('$schema:')
		expect(result.stderr).not.toContain('$hint')
	})

	test('large @schema folds: compact outline + dynamic selector guidance', async () => {
		const cmd = c.input(s(v.object({ id: v.optional(v.string()) })))
		const schema = {
			alpha: group({ description: 'a' }, { one: cmd, two: cmd }),
			beta: group({ description: 'b' }, { one: cmd, two: cmd }),
		}
		const app = cli(schema, {
			name: 'big',
			version: '7.0.0',
			schemaExplorer: createDefaultSchemaExplorer({ maxLines: 3 }),
		})
		const result = await capture(() =>
			app.run({ handlers: {} as never }, ['@schema']),
		)
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('status: compact outline')
		expect(result.stdout).toContain('next: big @schema')
		expect(result.stdout).toContain('selectors:')
		expect(result.stdout).toContain('.{a.{x,y},b.z}') // nested-selector legend
		expect(result.stdout).toContain('alpha{one,two}') // name{children}, not a tree
		expect(result.stdout).not.toContain('fully shown')
	})

	test('small @schema is fully shown with no selector noise', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() => app.run({ handlers }, ['@schema']))
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain('fully shown')
		expect(result.stdout).not.toContain('selectors:')
		expect(result.stdout).not.toContain('next:')
	})
})
