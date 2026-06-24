import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'

import type { RunConfig } from './types'

import { c, cli, complete, group } from './index'

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
	}
	return { app, handlers, schema }
}

describe('argc 7 command surface', () => {
	test('direct calls parse one quoted object, validate context, and render YAML', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user',
				'create',
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
			app.run({ handlers }, ['cache', 'clear', '--context', "{ env: 'dev' }"]),
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
		expect(result.stdout).toContain('mcpx user create "{')
	})

	test('unknown object keys fail before schema validation can strip them', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user',
				'create',
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
	})

	test('brace-split objects are not reassembled', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, ['user', 'create', '{', "name: 'alice'", '}']),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error:')
	})

	test('a second input object is a contract error', async () => {
		const { app, handlers } = makeApp()
		const result = await capture(() =>
			app.run({ handlers }, [
				'user',
				'create',
				"{ name: 'alice' }",
				"{ env: 'prod' }",
			]),
		)

		expect(result.exitCode).toBe(1)
		expect(result.stderr).toContain('error: TWO_INPUTS')
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
		expect(result.stderr).toContain('error: INVALID_INPUT')
		expect(result.stderr).toContain('context is not declared by this CLI')
	})

	test('completion suggests built-ins and path segments only', () => {
		const { schema } = makeApp()
		expect(complete(schema, { words: [''], current: 0 })).toContain('@schema')
		expect(complete(schema, { words: ['u'], current: 0 })).toEqual(['user'])
		expect(complete(schema, { words: ['user', 'c'], current: 1 })).toEqual([
			'create',
		])
	})
})
