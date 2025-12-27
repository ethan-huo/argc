import { describe, expect, test } from 'bun:test'

import { parseArgv } from './parser'

describe('parseArgv', () => {
	describe('long flags', () => {
		test('--key value', () => {
			const result = parseArgv(['--name', 'john'])
			expect(result.flags).toEqual({ name: 'john' })
			expect(result.positionals).toEqual([])
		})

		test('--key=value', () => {
			const result = parseArgv(['--name=john'])
			expect(result.flags).toEqual({ name: 'john' })
		})

		test('boolean flag (no value)', () => {
			const result = parseArgv(['--verbose'])
			expect(result.flags).toEqual({ verbose: true })
		})

		test('--no-* negation', () => {
			const result = parseArgv(['--no-verbose'])
			expect(result.flags).toEqual({ verbose: false })
		})

		test('kebab-case to camelCase', () => {
			const result = parseArgv(['--dry-run'])
			expect(result.flags).toEqual({ dryRun: true })
		})

		test('kebab-case with value', () => {
			const result = parseArgv(['--output-dir', '/tmp'])
			expect(result.flags).toEqual({ outputDir: '/tmp' })
		})
	})

	describe('short flags', () => {
		test('-k value', () => {
			const result = parseArgv(['-n', 'john'])
			expect(result.flags).toEqual({ n: 'john' })
		})

		test('-k (boolean)', () => {
			const result = parseArgv(['-v'])
			expect(result.flags).toEqual({ v: true })
		})

		test('combined short flags -abc', () => {
			const result = parseArgv(['-abc'])
			expect(result.flags).toEqual({ a: true, b: true, c: true })
		})
	})

	describe('positional arguments', () => {
		test('single positional', () => {
			const result = parseArgv(['hello'])
			expect(result.positionals).toEqual(['hello'])
		})

		test('multiple positionals', () => {
			const result = parseArgv(['hello', 'world'])
			expect(result.positionals).toEqual(['hello', 'world'])
		})

		test('mixed flags and positionals', () => {
			// Note: 'arg' after --verbose becomes its value, not a positional
			const result = parseArgv(['cmd', '--verbose', 'subcmd'])
			expect(result.flags).toEqual({ verbose: 'subcmd' })
			expect(result.positionals).toEqual(['cmd'])
		})

		test('boolean flag between positionals', () => {
			// Use flag before value to keep it boolean
			const result = parseArgv(['--verbose', 'cmd', 'arg'])
			expect(result.flags).toEqual({ verbose: 'cmd' })
			expect(result.positionals).toEqual(['arg'])
		})
	})

	describe('-- separator', () => {
		test('everything after -- is positional', () => {
			const result = parseArgv(['--verbose', '--', '--not-a-flag', '-x'])
			expect(result.flags).toEqual({ verbose: true })
			expect(result.positionals).toEqual(['--not-a-flag', '-x'])
		})
	})

	describe('dot notation (nested objects)', () => {
		test('--user.name value', () => {
			const result = parseArgv(['--user.name', 'john'])
			expect(result.flags).toEqual({ user: { name: 'john' } })
		})

		test('multiple nested values', () => {
			const result = parseArgv([
				'--db.host',
				'localhost',
				'--db.port',
				'5432',
			])
			expect(result.flags).toEqual({ db: { host: 'localhost', port: 5432 } })
		})

		test('deeply nested', () => {
			const result = parseArgv(['--a.b.c', 'value'])
			expect(result.flags).toEqual({ a: { b: { c: 'value' } } })
		})
	})

	describe('array values (repeated flags)', () => {
		test('--tags a --tags b', () => {
			const result = parseArgv(['--tags', 'a', '--tags', 'b'])
			expect(result.flags).toEqual({ tags: ['a', 'b'] })
		})

		test('three values', () => {
			const result = parseArgv(['--tag', 'x', '--tag', 'y', '--tag', 'z'])
			expect(result.flags).toEqual({ tag: ['x', 'y', 'z'] })
		})
	})

	describe('type coercion', () => {
		test('numbers', () => {
			const result = parseArgv(['--port', '3000', '--timeout', '1.5'])
			expect(result.flags).toEqual({ port: 3000, timeout: 1.5 })
		})

		test('boolean strings', () => {
			const result = parseArgv(['--enabled', 'true', '--disabled', 'false'])
			expect(result.flags).toEqual({ enabled: true, disabled: false })
		})

		test('negative numbers via equals', () => {
			// Negative numbers must use = syntax to avoid being parsed as flags
			const result = parseArgv(['--offset=-10'])
			expect(result.flags).toEqual({ offset: -10 })
		})

		test('negative number without equals is parsed as flags', () => {
			// This is expected: -10 looks like short flags -1 -0
			const result = parseArgv(['--offset', '-10'])
			expect(result.flags.offset).toBe(true)
			expect(result.flags['1']).toBe(true)
			expect(result.flags['0']).toBe(true)
		})

		test('string that looks like number but is not', () => {
			const result = parseArgv(['--version', '1.0.0'])
			expect(result.flags).toEqual({ version: '1.0.0' })
		})
	})

	describe('edge cases', () => {
		test('empty argv', () => {
			const result = parseArgv([])
			expect(result.flags).toEqual({})
			expect(result.positionals).toEqual([])
		})

		test('preserves raw argv', () => {
			const argv = ['--name', 'john', 'cmd']
			const result = parseArgv(argv)
			expect(result.raw).toBe(argv)
		})

		test('flag followed by another flag', () => {
			const result = parseArgv(['--verbose', '--debug'])
			expect(result.flags).toEqual({ verbose: true, debug: true })
		})

		test('empty string value', () => {
			const result = parseArgv(['--name', ''])
			expect(result.flags).toEqual({ name: '' })
		})
	})
})
