import { describe, expect, test } from 'bun:test'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, group } from './command'
import { generateSchema } from './schema'

const s = toStandardJsonSchema

describe('generateSchema', () => {
	test('simple command', () => {
		const schema = {
			greet: c.meta({ description: 'Say hello' }).input(
				s(v.object({ name: v.string() })),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('type App = {')
		expect(output).toContain('// Say hello')
		expect(output).toContain('greet(name: string)')
	})

	test('command with optional params', () => {
		const schema = {
			test: c.input(
				s(
					v.object({
						required: v.string(),
						optional: v.optional(v.string()),
					}),
				),
			),
		}

		const output = generateSchema(schema, { name: 'cli' })
		expect(output).toContain('required: string')
		expect(output).toContain('optional?: string')
	})

	test('command with defaults', () => {
		const schema = {
			run: c.input(
				s(v.object({ port: v.optional(v.number(), 3000) })),
			),
		}

		const output = generateSchema(schema, { name: 'server' })
		expect(output).toContain('port?: number = 3000')
	})

	test('grouped commands', () => {
		const schema = {
			user: group({ description: 'User management' }, {
				list: c.meta({ description: 'List users' }).input(s(v.object({}))),
				create: c.meta({ description: 'Create user' }).input(
					s(v.object({ name: v.string() })),
				),
			}),
		}

		const output = generateSchema(schema, { name: 'admin' })
		expect(output).toContain('// User management')
		expect(output).toContain('user: {')
		expect(output).toContain('// List users')
		expect(output).toContain('list()')
		expect(output).toContain('// Create user')
		expect(output).toContain('create(name: string)')
	})

	test('nested groups', () => {
		const schema = {
			deploy: group({ description: 'Deployment' }, {
				aws: group({ description: 'AWS' }, {
					lambda: c.input(s(v.object({}))),
				}),
			}),
		}

		const output = generateSchema(schema, { name: 'cli' })
		expect(output).toContain('// Deployment')
		expect(output).toContain('deploy: {')
		expect(output).toContain('// AWS')
		expect(output).toContain('aws: {')
		expect(output).toContain('lambda()')
	})

	test('global options', () => {
		const schema = {
			run: c.input(s(v.object({}))),
		}

		const output = generateSchema(schema, {
			name: 'app',
			globals: s(v.object({ verbose: v.optional(v.boolean(), false) })),
		})

		expect(output).toContain('// Global options')
		expect(output).toContain('$globals: { verbose?: boolean = false }')
	})

	test('description in output', () => {
		const schema = { cmd: c.input(s(v.object({}))) }

		const output = generateSchema(schema, {
			name: 'myapp',
			description: 'My awesome app',
		})

		expect(output).toContain('My awesome app')
	})

	test('CLI syntax hint', () => {
		const schema = { cmd: c.input(s(v.object({}))) }
		const output = generateSchema(schema, { name: 'app' })

		expect(output).toContain('CLI Syntax:')
		expect(output).toContain('arrays:')
		expect(output).toContain('objects:')
	})

	test('deprecated command', () => {
		const schema = {
			old: c.meta({ description: 'Old command', deprecated: true }).input(
				s(v.object({})),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('[DEPRECATED]')
	})

	test('examples in comments', () => {
		const schema = {
			run: c
				.meta({
					description: 'Run command',
					examples: ['app run --port 3000', 'app run -v'],
				})
				.input(s(v.object({}))),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('// $ app run --port 3000')
		expect(output).toContain('// $ app run -v')
	})

	test('array type', () => {
		const schema = {
			cmd: c.input(s(v.object({ tags: v.array(v.string()) }))),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('tags: string[]')
	})

	test('enum/picklist type', () => {
		const schema = {
			cmd: c.input(
				s(v.object({ env: v.picklist(['dev', 'prod']) })),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('"dev" | "prod"')
	})

	test('nested object type', () => {
		const schema = {
			cmd: c.input(
				s(
					v.object({
						db: v.object({ host: v.string(), port: v.number() }),
					}),
				),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('db: { host: string, port: number }')
	})
})
