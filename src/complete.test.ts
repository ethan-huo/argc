import { describe, expect, test } from 'bun:test'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, group } from './index'
import { complete, generateCompletionScript } from './complete'

const s = toStandardJsonSchema

const schema = {
	user: group({ description: 'User management' }, {
		list: c
			.meta({ aliases: ['ls'] })
			.input(
				s(
					v.object({
						format: v.optional(
							v.picklist(['json', 'table', 'csv']),
							'table',
						),
						verbose: v.optional(v.boolean(), false),
					}),
				),
			),
		create: c.input(
			s(
				v.object({
					name: v.string(),
					email: v.optional(v.string()),
				}),
			),
		),
		delete: c
			.meta({ hidden: true })
			.input(s(v.object({ id: v.string() }))),
	}),
	config: c
		.meta({ description: 'Show config' })
		.args('key')
		.input(
			s(
				v.object({
					key: v.optional(v.string()),
					global: v.optional(v.boolean(), false),
				}),
			),
		),
}

const globals = s(
	v.object({
		verbose: v.optional(v.boolean(), false),
		outputFormat: v.optional(v.string()),
	}),
)

describe('complete', () => {
	test('suggests root subcommands', () => {
		const results = complete(schema, undefined, {
			words: [''],
			current: 0,
		})
		expect(results).toContain('user')
		expect(results).toContain('config')
	})

	test('filters subcommands by prefix', () => {
		const results = complete(schema, undefined, {
			words: ['us'],
			current: 0,
		})
		expect(results).toContain('user')
		expect(results).not.toContain('config')
	})

	test('suggests nested subcommands', () => {
		const results = complete(schema, undefined, {
			words: ['user', ''],
			current: 1,
		})
		expect(results).toContain('list')
		expect(results).toContain('create')
		expect(results).toContain('ls')
	})

	test('excludes hidden commands', () => {
		const results = complete(schema, undefined, {
			words: ['user', ''],
			current: 1,
		})
		expect(results).not.toContain('delete')
	})

	test('includes aliases in suggestions', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'l'],
			current: 1,
		})
		expect(results).toContain('list')
		expect(results).toContain('ls')
	})

	test('suggests flags at command level', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'create', '--'],
			current: 2,
		})
		expect(results).toContain('--name')
		expect(results).toContain('--email')
		expect(results).toContain('--help')
	})

	test('filters flags by prefix', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'create', '--na'],
			current: 2,
		})
		expect(results).toContain('--name')
		expect(results).not.toContain('--email')
	})

	test('suggests enum values for picklist flags', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'list', '--format', ''],
			current: 3,
		})
		expect(results).toContain('json')
		expect(results).toContain('table')
		expect(results).toContain('csv')
	})

	test('filters enum values by prefix', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'list', '--format', 'j'],
			current: 3,
		})
		expect(results).toContain('json')
		expect(results).not.toContain('table')
		expect(results).not.toContain('csv')
	})

	test('returns empty for non-enum flag values', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'create', '--name', ''],
			current: 3,
		})
		expect(results).toEqual([])
	})

	test('excludes positional arg names from flag suggestions', () => {
		const results = complete(schema, undefined, {
			words: ['config', '--'],
			current: 1,
		})
		expect(results).not.toContain('--key')
		expect(results).toContain('--global')
	})

	test('includes global flags when provided', () => {
		const results = complete(schema, globals, {
			words: ['user', 'create', '--'],
			current: 2,
		})
		expect(results).toContain('--verbose')
		expect(results).toContain('--output-format')
	})

	test('resolves alias in tree walk', () => {
		const results = complete(schema, undefined, {
			words: ['user', 'ls', '--'],
			current: 2,
		})
		expect(results).toContain('--format')
		expect(results).toContain('--verbose')
	})

	test('skips flags during tree walk', () => {
		const results = complete(schema, undefined, {
			words: ['user', '--verbose', 'list', '--'],
			current: 3,
		})
		expect(results).toContain('--format')
	})

	test('skips flag values during tree walk', () => {
		// --env dev should be skipped as flag+value, then resolve "user" as subcommand
		const schema2 = {
			user: group({ description: 'Users' }, {
				list: c.input(s(v.object({}))),
			}),
		}
		const g = s(v.object({ env: v.optional(v.string()) }))

		// Simulates: mycli --env dev user <TAB>
		const results = complete(schema2, g, {
			words: ['--env', 'dev', 'user', ''],
			current: 3,
		})
		expect(results).toContain('list')
		expect(results).not.toContain('user')
	})

	test('does not skip flag value when it matches a subcommand', () => {
		// --verbose is boolean, next word "user" IS a valid subcommand
		const schema2 = {
			user: group({ description: 'Users' }, {
				list: c.input(s(v.object({}))),
			}),
		}

		// Simulates: mycli --verbose user <TAB>
		const results = complete(schema2, undefined, {
			words: ['--verbose', 'user', ''],
			current: 2,
		})
		expect(results).toContain('list')
	})

	test('handles empty words list', () => {
		const results = complete(schema, undefined, {
			words: [],
			current: 0,
		})
		expect(results).toContain('user')
		expect(results).toContain('config')
	})
})

describe('generateCompletionScript', () => {
	test('generates bash script', () => {
		const script = generateCompletionScript('bash', 'myapp')
		expect(script).not.toBeNull()
		expect(script!).toContain('_myapp_completions')
		expect(script!).toContain('COMPREPLY')
		expect(script!).toContain('--_complete')
		expect(script!).toContain('complete -o default')
	})

	test('generates zsh script', () => {
		const script = generateCompletionScript('zsh', 'myapp')
		expect(script).not.toBeNull()
		expect(script!).toContain('compdef')
		expect(script!).toContain('--_complete')
	})

	test('generates fish script', () => {
		const script = generateCompletionScript('fish', 'myapp')
		expect(script).not.toBeNull()
		expect(script!).toContain('complete -c myapp')
		expect(script!).toContain('--_complete')
	})

	test('sanitizes program name in function names', () => {
		const script = generateCompletionScript('bash', 'my-app')
		expect(script).not.toBeNull()
		expect(script!).toContain('_my_app_completions')
		expect(script!).toContain('complete -o default -F _my_app_completions my-app')
	})

	test('returns null for unknown shell', () => {
		const script = generateCompletionScript('powershell', 'myapp')
		expect(script).toBeNull()
	})
})
