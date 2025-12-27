import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'

import { c, CommandBuilder, group, GroupBuilder } from './command'
import { isCommand, isGroup } from './types'

describe('CommandBuilder', () => {
	test('creates empty command', () => {
		const cmd = new CommandBuilder()
		expect(cmd['~argc']).toEqual({ meta: {} })
	})

	test('c is a CommandBuilder instance', () => {
		expect(c).toBeInstanceOf(CommandBuilder)
	})

	describe('meta()', () => {
		test('sets description', () => {
			const cmd = c.meta({ description: 'Test command' })
			expect(cmd['~argc'].meta.description).toBe('Test command')
		})

		test('sets multiple meta fields', () => {
			const cmd = c.meta({
				description: 'Test',
				aliases: ['t'],
				examples: ['cmd test'],
				deprecated: true,
				hidden: true,
			})
			expect(cmd['~argc'].meta).toEqual({
				description: 'Test',
				aliases: ['t'],
				examples: ['cmd test'],
				deprecated: true,
				hidden: true,
			})
		})

		test('is chainable and immutable', () => {
			const cmd1 = c.meta({ description: 'First' })
			const cmd2 = cmd1.meta({ aliases: ['f'] })
			expect(cmd1['~argc'].meta.aliases).toBeUndefined()
			expect(cmd2['~argc'].meta.description).toBe('First')
			expect(cmd2['~argc'].meta.aliases).toEqual(['f'])
		})
	})

	describe('args()', () => {
		test('sets positional args as strings', () => {
			const cmd = c.args('file', 'dest')
			expect(cmd['~argc'].args).toEqual([{ name: 'file' }, { name: 'dest' }])
		})

		test('sets positional args as objects', () => {
			const cmd = c.args(
				{ name: 'file', description: 'Input file' },
				{ name: 'dest' },
			)
			expect(cmd['~argc'].args).toEqual([
				{ name: 'file', description: 'Input file' },
				{ name: 'dest' },
			])
		})

		test('mixed string and object args', () => {
			const cmd = c.args('file', { name: 'dest', description: 'Destination' })
			expect(cmd['~argc'].args).toEqual([
				{ name: 'file' },
				{ name: 'dest', description: 'Destination' },
			])
		})
	})

	describe('input()', () => {
		test('sets input schema', () => {
			const schema = v.object({ name: v.string() })
			const cmd = c.input(schema)
			expect(cmd['~argc'].input).toBe(schema)
		})
	})

	describe('chaining', () => {
		test('full chain', () => {
			const schema = v.object({ force: v.boolean() })
			const cmd = c
				.meta({ description: 'Delete files' })
				.args('file')
				.input(schema)

			expect(cmd['~argc'].meta.description).toBe('Delete files')
			expect(cmd['~argc'].args).toEqual([{ name: 'file' }])
			expect(cmd['~argc'].input).toBe(schema)
		})
	})

	describe('isCommand type guard', () => {
		test('returns true for CommandBuilder', () => {
			const cmd = c.meta({ description: 'Test' })
			expect(isCommand(cmd)).toBe(true)
		})

		test('returns false for plain object', () => {
			expect(isCommand({})).toBe(false)
		})
	})
})

describe('GroupBuilder', () => {
	test('creates group with meta and children', () => {
		const grp = new GroupBuilder({ description: 'User commands' }, {})
		expect(grp['~argc.group'].meta.description).toBe('User commands')
		expect(grp['~argc.group'].children).toEqual({})
	})

	describe('meta()', () => {
		test('updates meta', () => {
			const grp = new GroupBuilder({}, {}).meta({ description: 'Updated' })
			expect(grp['~argc.group'].meta.description).toBe('Updated')
		})
	})

	describe('children()', () => {
		test('sets children', () => {
			const listCmd = c.meta({ description: 'List items' })
			const grp = new GroupBuilder({ description: 'Items' }, {}).children({
				list: listCmd,
			})
			expect(grp['~argc.group'].children.list).toBe(listCmd)
		})
	})
})

describe('group() function', () => {
	test('creates GroupDef', () => {
		const grp = group({ description: 'User commands' }, {
			list: c.meta({ description: 'List users' }),
			create: c.meta({ description: 'Create user' }),
		})

		expect(isGroup(grp)).toBe(true)
		expect(grp['~argc.group'].meta.description).toBe('User commands')
		expect(Object.keys(grp['~argc.group'].children)).toEqual(['list', 'create'])
	})

	test('nested groups', () => {
		const grp = group({ description: 'Deploy' }, {
			aws: group({ description: 'AWS' }, {
				lambda: c.meta({ description: 'Lambda' }),
			}),
		})

		expect(isGroup(grp)).toBe(true)
		expect(isGroup(grp['~argc.group'].children.aws)).toBe(true)
	})
})

describe('isGroup type guard', () => {
	test('returns true for GroupBuilder', () => {
		const grp = group({ description: 'Test' }, {})
		expect(isGroup(grp)).toBe(true)
	})

	test('returns false for CommandBuilder', () => {
		expect(isGroup(c.meta({ description: 'Test' }))).toBe(false)
	})

	test('returns false for plain object', () => {
		expect(isGroup({})).toBe(false)
	})
})
