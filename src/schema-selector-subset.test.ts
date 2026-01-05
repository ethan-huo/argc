import { describe, expect, test } from 'bun:test'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, group } from './command'
import {
	buildSchemaSubset,
	matchSchemaSelector,
	parseSchemaSelector,
} from './schema-selector'
import { isGroup, isCommand } from './types'

const s = toStandardJsonSchema

const schema = {
	user: group({ description: 'User' }, {
		list: c.input(s(v.object({}))),
		create: c.input(s(v.object({}))),
	}),
	deploy: group({ description: 'Deploy' }, {
		aws: group({ description: 'AWS' }, {
			lambda: c.input(s(v.object({}))),
			s3: c.input(s(v.object({}))),
		}),
		vercel: c.input(s(v.object({}))),
	}),
	plain: {
		alpha: c.input(s(v.object({}))),
		beta: c.input(s(v.object({}))),
	},
}

describe('buildSchemaSubset', () => {
	test('scopes to a group with one-level children', () => {
		const matches = matchSchemaSelector(schema, parseSchemaSelector('.deploy'))
		const subset = buildSchemaSubset(schema, matches, 1)
		const deploy = (subset as Record<string, unknown>)['deploy']
		expect(deploy).toBeDefined()
		expect(isGroup(deploy)).toBe(true)
		const children = (deploy as ReturnType<typeof group>)['~argc.group']
			expect(Object.keys(children.children)).toEqual(['aws', 'vercel'])
		const aws = children.children['aws']
		const vercel = children.children['vercel']
		expect(isGroup(aws)).toBe(true)
		expect(Object.keys((aws as ReturnType<typeof group>)['~argc.group'].children))
			.toEqual([])
		expect(isCommand(vercel)).toBe(true)
	})

	test('scopes to nested group with one-level children', () => {
		const matches = matchSchemaSelector(schema, parseSchemaSelector('.deploy.aws'))
		const subset = buildSchemaSubset(schema, matches, 1)
		const deploy = (subset as Record<string, unknown>)['deploy']
		expect(isGroup(deploy)).toBe(true)
		const deployChildren = (deploy as ReturnType<typeof group>)['~argc.group'].children
		const aws = deployChildren['aws']
		expect(isGroup(aws)).toBe(true)
		const awsChildren = (aws as ReturnType<typeof group>)['~argc.group'].children
		expect(Object.keys(awsChildren)).toEqual(['lambda', 's3'])
	})

	test('scopes to set selection', () => {
		const matches = matchSchemaSelector(schema, parseSchemaSelector('.{user,plain}'))
		const subset = buildSchemaSubset(schema, matches, 1) as Record<string, unknown>
		expect(Object.keys(subset)).toEqual(['user', 'plain'])
	})
})
