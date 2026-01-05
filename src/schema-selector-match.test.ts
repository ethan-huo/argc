import { describe, expect, test } from 'bun:test'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, group } from './command'
import { matchSchemaSelector, parseSchemaSelector } from './schema-selector'

const s = toStandardJsonSchema

const schema = {
	user: group(
		{ description: 'User management' },
		{
			list: c.input(s(v.object({}))),
			create: c.input(s(v.object({}))),
		},
	),
	config: group(
		{ description: 'Config' },
		{
			create: c.input(s(v.object({}))),
			get: c.input(s(v.object({}))),
		},
	),
	deploy: group(
		{ description: 'Deploy' },
		{
			aws: group({ description: 'AWS' }, { lambda: c.input(s(v.object({}))) }),
			vercel: c.input(s(v.object({}))),
		},
	),
}

describe('matchSchemaSelector', () => {
	test('matches simple path', () => {
		const steps = parseSchemaSelector('.user.create')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['user', 'create']])
	})

	test('matches wildcard', () => {
		const steps = parseSchemaSelector('.user.*')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['user', 'list'],
			['user', 'create'],
		])
	})

	test('matches set', () => {
		const steps = parseSchemaSelector('.{user,config}')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['user'], ['config']])
	})

	test('matches recursive descent for name', () => {
		const steps = parseSchemaSelector('..create')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['user', 'create'],
			['config', 'create'],
		])
	})

	test('matches recursive descent as suffix', () => {
		const steps = parseSchemaSelector('.deploy..')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['deploy'],
			['deploy', 'aws'],
			['deploy', 'aws', 'lambda'],
			['deploy', 'vercel'],
		])
	})

	test('missing path yields empty', () => {
		const steps = parseSchemaSelector('.user.missing')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches).toEqual([])
	})
})
