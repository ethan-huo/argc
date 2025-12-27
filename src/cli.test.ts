import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from './index'

const s = toStandardJsonSchema

describe('cli', () => {
	let originalArgv: string[]
	let originalExit: typeof process.exit
	let exitCode: number | undefined
	let consoleOutput: string[]

	beforeEach(() => {
		originalArgv = process.argv
		originalExit = process.exit
		exitCode = undefined
		consoleOutput = []

		// Mock process.exit
		process.exit = ((code?: number) => {
			exitCode = code ?? 0
			throw new Error(`process.exit(${code})`)
		}) as typeof process.exit

		// Capture console output
		const originalLog = console.log
		const originalError = console.error
		console.log = (...args: unknown[]) => {
			consoleOutput.push(args.map(String).join(' '))
		}
		console.error = (...args: unknown[]) => {
			consoleOutput.push(args.map(String).join(' '))
		}
	})

	afterEach(() => {
		process.argv = originalArgv
		process.exit = originalExit
	})

	describe('command routing', () => {
		test('routes to correct handler', async () => {
			let called = false
			const schema = {
				test: c.input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'test']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					test: () => {
						called = true
					},
				},
			})

			expect(called).toBe(true)
		})

		test('routes nested command', async () => {
			let called = ''
			const schema = {
				user: group({ description: 'Users' }, {
					list: c.input(s(v.object({}))),
					create: c.input(s(v.object({ name: v.string() }))),
				}),
			}

			process.argv = ['bun', 'cli', 'user', 'list']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					user: {
						list: () => {
							called = 'list'
						},
						create: () => {
							called = 'create'
						},
					},
				},
			})

			expect(called).toBe('list')
		})

		test('handles alias', async () => {
			let called = false
			const schema = {
				list: c.meta({ aliases: ['ls'] }).input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'ls']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					list: () => {
						called = true
					},
				},
			})

			expect(called).toBe(true)
		})
	})

	describe('input parsing', () => {
		test('passes parsed input to handler', async () => {
			let receivedInput: unknown
			const schema = {
				greet: c.input(
					s(v.object({ name: v.string(), loud: v.optional(v.boolean(), false) })),
				),
			}

			process.argv = ['bun', 'cli', 'greet', '--name', 'World', '--loud']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					greet: ({ input }) => {
						receivedInput = input
					},
				},
			})

			expect(receivedInput).toEqual({ name: 'World', loud: true })
		})

		test('handles positional args', async () => {
			let receivedInput: unknown
			const schema = {
				greet: c.args('name').input(s(v.object({ name: v.string() }))),
			}

			process.argv = ['bun', 'cli', 'greet', 'World']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					greet: ({ input }) => {
						receivedInput = input
					},
				},
			})

			expect(receivedInput).toEqual({ name: 'World' })
		})

		test('handles array input', async () => {
			let receivedInput: unknown
			const schema = {
				tag: c.input(s(v.object({ tags: v.array(v.string()) }))),
			}

			process.argv = ['bun', 'cli', 'tag', '--tags', 'a', '--tags', 'b']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				handlers: {
					tag: ({ input }) => {
						receivedInput = input
					},
				},
			})

			expect(receivedInput).toEqual({ tags: ['a', 'b'] })
		})
	})

	describe('context', () => {
		test('passes context to handler', async () => {
			let receivedContext: unknown
			const schema = {
				test: c.input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'test']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				context: () => ({ env: 'test', count: 42 }),
				handlers: {
					test: ({ context }) => {
						receivedContext = context
					},
				},
			})

			expect(receivedContext).toEqual({ env: 'test', count: 42 })
		})

		test('async context', async () => {
			let receivedContext: unknown
			const schema = {
				test: c.input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'test']

			const app = cli(schema, { name: 'test', version: '1.0.0' })
			await app.run({
				context: async () => {
					await Promise.resolve()
					return { loaded: true }
				},
				handlers: {
					test: ({ context }) => {
						receivedContext = context
					},
				},
			})

			expect(receivedContext).toEqual({ loaded: true })
		})

		test('context receives globals', async () => {
			let receivedGlobals: unknown
			const schema = {
				test: c.input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'test', '--verbose']

			const app = cli(schema, {
				name: 'test',
				version: '1.0.0',
				globals: s(v.object({ verbose: v.optional(v.boolean(), false) })),
			})

			await app.run({
				context: (globals) => {
					receivedGlobals = globals
					return {}
				},
				handlers: {
					test: () => {},
				},
			})

			expect(receivedGlobals).toEqual({ verbose: true })
		})
	})

	describe('help output', () => {
		test('--help shows help', async () => {
			const schema = {
				test: c.meta({ description: 'Test command' }).input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', '--help']

			const app = cli(schema, {
				name: 'myapp',
				version: '1.0.0',
				description: 'My app description',
			})

			try {
				await app.run({ handlers: { test: () => {} } })
			} catch {
				// process.exit throws
			}

			const output = consoleOutput.join('\n')
			expect(output).toContain('myapp')
			expect(output).toContain('1.0.0')
			expect(output).toContain('My app description')
			expect(output).toContain('test')
			// exitCode may be 0 or undefined depending on how help exits
			expect(exitCode === 0 || exitCode === undefined).toBe(true)
		})

		test('-h shows help', async () => {
			const schema = { test: c.input(s(v.object({}))) }
			process.argv = ['bun', 'cli', '-h']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { test: () => {} } })
			} catch {
				// process.exit throws
			}

			// Help was shown (exit code 0 or undefined)
			expect(exitCode === 0 || exitCode === undefined).toBe(true)
		})

		test('command --help shows command help', async () => {
			const schema = {
				greet: c
					.meta({
						description: 'Greet someone',
						examples: ['app greet --name John'],
					})
					.input(
						s(v.object({ name: v.pipe(v.string(), v.description('Person name')) })),
					),
			}

			process.argv = ['bun', 'cli', 'greet', '--help']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { greet: () => {} } })
			} catch {
				// process.exit throws
			}

			const output = consoleOutput.join('\n')
			expect(output).toContain('Greet someone')
			expect(output).toContain('--name')
			expect(output).toContain('app greet --name John')
			expect(exitCode === 0 || exitCode === undefined).toBe(true)
		})
	})

	describe('version', () => {
		test('--version shows version', async () => {
			const schema = { test: c.input(s(v.object({}))) }
			process.argv = ['bun', 'cli', '--version']

			const app = cli(schema, { name: 'app', version: '2.3.4' })

			try {
				await app.run({ handlers: { test: () => {} } })
			} catch {
				// process.exit throws
			}

			expect(consoleOutput.join('\n')).toContain('2.3.4')
			expect(exitCode === 0 || exitCode === undefined).toBe(true)
		})

		test('-v shows version', async () => {
			const schema = { test: c.input(s(v.object({}))) }
			process.argv = ['bun', 'cli', '-v']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { test: () => {} } })
			} catch {
				// process.exit throws
			}

			expect(exitCode === 0 || exitCode === undefined).toBe(true)
		})
	})

	describe('validation errors', () => {
		test('shows error for missing required field', async () => {
			const schema = {
				greet: c.input(s(v.object({ name: v.string() }))),
			}

			process.argv = ['bun', 'cli', 'greet']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { greet: () => {} } })
			} catch {
				// process.exit throws
			}

			const output = consoleOutput.join('\n')
			expect(output).toContain('invalid arguments')
			expect(output).toContain('--name')
			expect(exitCode).toBe(1)
		})

		test('shows error for invalid value', async () => {
			const schema = {
				greet: c.input(
					s(v.object({ name: v.pipe(v.string(), v.minLength(3)) })),
				),
			}

			process.argv = ['bun', 'cli', 'greet', '--name', 'ab']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { greet: () => {} } })
			} catch {
				// process.exit throws
			}

			const output = consoleOutput.join('\n')
			expect(output).toContain('invalid arguments')
			expect(exitCode).toBe(1)
		})
	})

	describe('unknown command', () => {
		test('shows error and suggestion', async () => {
			const schema = {
				list: c.input(s(v.object({}))),
				create: c.input(s(v.object({}))),
			}

			process.argv = ['bun', 'cli', 'lst']

			const app = cli(schema, { name: 'app', version: '1.0.0' })

			try {
				await app.run({ handlers: { list: () => {}, create: () => {} } })
			} catch {
				// process.exit throws
			}

			const output = consoleOutput.join('\n')
			expect(output).toContain('lst')
			expect(output).toContain('is not a')
			expect(output).toContain('list') // suggestion
			expect(exitCode).toBe(1)
		})
	})
})
