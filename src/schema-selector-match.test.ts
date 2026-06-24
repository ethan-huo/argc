import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'

import { c, group } from './command'
import { matchSchemaSelector, parseSchemaSelector } from './schema-selector'

const s = toStandardJsonSchema

const schema = {
	addUser: c.input(s(v.object({}))),
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

	test('matches identifier path', () => {
		const steps = parseSchemaSelector('.addUser')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['addUser']])
	})

	test('matches quoted path', () => {
		const steps = parseSchemaSelector('."addUser"')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['addUser']])
	})

	test('matches bracket path', () => {
		const steps = parseSchemaSelector('.["addUser"]')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['addUser']])
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

	test('matches set with quoted key', () => {
		const steps = parseSchemaSelector('.{"addUser",config}')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['addUser'], ['config']])
	})

	test('matches asymmetric set branches', () => {
		const steps = parseSchemaSelector('.{user.create,config}')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([['user', 'create'], ['config']])
	})

	test('matches nested sets down to specific leaves', () => {
		const steps = parseSchemaSelector('.{user.{list,create},deploy.aws.lambda}')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['user', 'list'],
			['user', 'create'],
			['deploy', 'aws', 'lambda'],
		])
	})

	test('matches set followed by a shared trailing path', () => {
		const steps = parseSchemaSelector('.{user,config}.create')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['user', 'create'],
			['config', 'create'],
		])
	})

	test('matches wildcard and recursive descent inside branches', () => {
		const steps = parseSchemaSelector('.{user.*,deploy..lambda}')
		const matches = matchSchemaSelector(schema, steps)
		expect(matches.map((m) => m.path)).toEqual([
			['user', 'list'],
			['user', 'create'],
			['deploy', 'aws', 'lambda'],
		])
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
