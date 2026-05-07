import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'

import type { Schema } from './types'

import { c, group } from './command'
import {
	generateSchema,
	generateSchemaHintExample,
	generateSchemaOutline,
	getInputTypeHint,
} from './schema'

const s = toStandardJsonSchema

function jsonSchema(schema: Record<string, unknown>): Schema {
	return {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value) => ({ value }),
			jsonSchema: {
				input: () => schema,
				output: () => schema,
			},
		},
	} as Schema
}

describe('generateSchema', () => {
	test('simple command', () => {
		const schema = {
			greet: c
				.meta({ description: 'Say hello' })
				.input(s(v.object({ name: v.string() }))),
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
			run: c.input(s(v.object({ port: v.optional(v.number(), 3000) }))),
		}

		const output = generateSchema(schema, { name: 'server' })
		expect(output).toContain('port?: number = 3000')
	})

	test('command signature uses transformed output types', () => {
		const numberFromStringWithDefault = (defaultValue: number) =>
			v.pipe(
				v.optional(v.string(), String(defaultValue)),
				v.transform(Number),
				v.number(),
			)
		const schema = {
			sessions: c.input(
				s(
					v.object({
						count: numberFromStringWithDefault(2),
					}),
				),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('sessions(count?: number = 2)')
		expect(output).not.toContain('sessions(count?: string = "2")')
	})

	test('command signature prefers derived output defaults over raw output schema defaults', () => {
		const numeric = v.pipe(
			v.string(),
			v.regex(/\S/),
			v.transform(Number),
			v.number(),
			v.integer(),
			v.minValue(1),
		)
		const schema = {
			run: c.input(
				s(
					v.object({
						timeout: v.optional(numeric, '300'),
					}),
				),
			),
		}

		const output = generateSchema(schema, { name: 'demo' })
		expect(output).toContain('run(timeout?: number = 300)')
		expect(output).not.toContain('run(timeout?: number = "300")')
	})

	test('command signature canonicalizes duplicate rendered types', () => {
		const schema = {
			cmd: c.input(
				jsonSchema({
					type: 'object',
					properties: {
						json: {
							anyOf: [{ type: 'boolean' }, { type: 'boolean' }],
							default: false,
						},
						env: { enum: ['dev', 'dev', 'prod'] },
						status: {
							oneOf: [{ const: 'ready' }, { enum: ['ready', 'blocked'] }],
						},
						nested: {
							anyOf: [
								{
									anyOf: [{ type: 'string' }, { type: 'number' }],
								},
								{ type: 'string' },
							],
						},
						config: {
							anyOf: [
								{
									type: 'object',
									properties: {
										mode: { enum: ['auto', 'manual'] },
									},
								},
								{
									type: 'object',
									properties: {
										level: { type: 'number' },
									},
								},
							],
						},
						same: {
							allOf: [
								{
									type: 'object',
									properties: { id: { type: 'string' } },
									required: ['id'],
								},
								{
									type: 'object',
									properties: { id: { type: 'string' } },
									required: ['id'],
								},
							],
						},
					},
				}),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('json?: boolean = false')
		expect(output).toContain('env?: "dev" | "prod"')
		expect(output).toContain('status?: "ready" | "blocked"')
		expect(output).toContain('nested?: string | number')
		expect(output).toContain(
			'config?: { mode?: "auto" | "manual" } | { level?: number }',
		)
		expect(output).toContain('same?: { id: string }')
		expect(output).not.toContain('boolean | boolean')
		expect(output).not.toContain('"dev" | "dev"')
	})

	test('grouped commands', () => {
		const schema = {
			user: group(
				{ description: 'User management' },
				{
					list: c.meta({ description: 'List users' }).input(s(v.object({}))),
					create: c
						.meta({ description: 'Create user' })
						.input(s(v.object({ name: v.string() }))),
				},
			),
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
			deploy: group(
				{ description: 'Deployment' },
				{
					aws: group(
						{ description: 'AWS' },
						{
							lambda: c.input(s(v.object({}))),
						},
					),
				},
			),
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
		expect(output).toContain(
			'flags:   --skip-build matches skip-build, or falls back to skipBuild',
		)
		expect(output).toContain('arrays:')
		expect(output).toContain('objects:')
	})

	test('schema output keeps schema field names for input objects', () => {
		const schema = {
			release: c.input(
				s(v.object({ skipBuild: v.optional(v.boolean(), false) })),
			),
		}

		const output = generateSchema(schema, { name: 'app' })
		expect(output).toContain('release(skipBuild?: boolean = false)')
		expect(output).not.toContain('release(skip-build')
	})

	test('deprecated command', () => {
		const schema = {
			old: c
				.meta({ description: 'Old command', deprecated: true })
				.input(s(v.object({}))),
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
			cmd: c.input(s(v.object({ env: v.picklist(['dev', 'prod']) }))),
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

	test('compact outline', () => {
		const schema = {
			deploy: group(
				{ description: 'Deploy' },
				{
					aws: group(
						{ description: 'AWS' },
						{
							lambda: c.input(s(v.object({}))),
							s3: c.input(s(v.object({}))),
						},
					),
					vercel: c.input(s(v.object({}))),
				},
			),
		}

		const lines = generateSchemaOutline(schema, 2)
		expect(lines).toEqual(['deploy{aws{lambda,s3},vercel}'])
	})

	test('outline hints', () => {
		const schema = {
			user: group(
				{ description: 'User' },
				{
					list: c.input(s(v.object({}))),
					create: c.input(s(v.object({}))),
				},
			),
			config: group(
				{ description: 'Config' },
				{
					get: c.input(s(v.object({}))),
				},
			),
		}

		const hint = generateSchemaHintExample(schema)
		expect(hint).toBe('user.list')
	})

	test('input type hint uses top-level summary', () => {
		const schema = {
			cmd: c.input(
				s(
					v.object({
						db: v.object({ host: v.string(), port: v.number() }),
						env: v.picklist(['dev', 'prod']),
					}),
				),
			),
		}

		const hint = getInputTypeHint(schema.cmd['~argc'].input!)
		expect(hint).toBe('{ db: object, env: enum }')
	})

	test('input type hint covers common top-level cases', () => {
		const schema = {
			cmd: c.input(
				s(
					v.object({
						name: v.string(),
						age: v.number(),
						active: v.boolean(),
						tags: v.array(v.string()),
						meta: v.object({ id: v.string(), score: v.number() }),
						items: v.array(v.object({ id: v.string() })),
						role: v.picklist(['admin', 'member', 'guest']),
						status: v.union([v.literal('ok'), v.literal(1)]),
						modes: v.array(v.picklist(['a', 'b'])),
					}),
				),
			),
		}

		const hint = getInputTypeHint(schema.cmd['~argc'].input!)
		expect(hint).toBe(
			'{ name: string, age: number, active: boolean, tags: string[], meta: object, items: object[], role: enum, status: enum, modes: enum[] }',
		)
	})

	test('input type hint shows optional keys', () => {
		const schema = {
			cmd: c.input(
				s(
					v.object({
						name: v.string(),
						email: v.optional(v.string()),
						tags: v.optional(v.array(v.string())),
						role: v.optional(v.picklist(['admin', 'member'])),
					}),
				),
			),
		}

		const hint = getInputTypeHint(schema.cmd['~argc'].input!)
		expect(hint).toBe(
			'{ name: string, email?: string, tags?: string[], role?: enum }',
		)
	})
})
