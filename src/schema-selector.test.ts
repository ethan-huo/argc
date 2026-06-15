import { describe, expect, test } from 'bun:test'

import { parseSchemaSelector } from './schema-selector'

describe('parseSchemaSelector', () => {
	test('parses simple path', () => {
		expect(parseSchemaSelector('.user.create')).toEqual([
			{ type: 'key', name: 'user' },
			{ type: 'key', name: 'create' },
		])
	})

	test('parses at-prefixed key', () => {
		expect(parseSchemaSelector('.@add')).toEqual([
			{ type: 'key', name: '@add' },
		])
	})

	test('parses quoted key', () => {
		expect(parseSchemaSelector('."@add"')).toEqual([
			{ type: 'key', name: '@add' },
		])
	})

	test('parses bracket key', () => {
		expect(parseSchemaSelector('.["@add"]')).toEqual([
			{ type: 'key', name: '@add' },
		])
	})

	test('parses wildcard', () => {
		expect(parseSchemaSelector('.user.*')).toEqual([
			{ type: 'key', name: 'user' },
			{ type: 'wildcard' },
		])
	})

	test('parses set segment', () => {
		expect(parseSchemaSelector('.user.{create,delete}')).toEqual([
			{ type: 'key', name: 'user' },
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: 'create' }],
					[{ type: 'key', name: 'delete' }],
				],
			},
		])
	})

	test('parses set segment with at-prefixed and quoted keys', () => {
		expect(parseSchemaSelector('.{"@add",@remove}')).toEqual([
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: '@add' }],
					[{ type: 'key', name: '@remove' }],
				],
			},
		])
	})

	test('parses root set', () => {
		expect(parseSchemaSelector('.{user,config}')).toEqual([
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: 'user' }],
					[{ type: 'key', name: 'config' }],
				],
			},
		])
	})

	test('parses set branches with sub-paths', () => {
		expect(parseSchemaSelector('.compute.{alpha,beta.list}')).toEqual([
			{ type: 'key', name: 'compute' },
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: 'alpha' }],
					[
						{ type: 'key', name: 'beta' },
						{ type: 'key', name: 'list' },
					],
				],
			},
		])
	})

	test('parses nested sets with asymmetric depth', () => {
		expect(
			parseSchemaSelector('.{compute.alpha.{list,get},storage.{add,remove}}'),
		).toEqual([
			{
				type: 'set',
				branches: [
					[
						{ type: 'key', name: 'compute' },
						{ type: 'key', name: 'alpha' },
						{
							type: 'set',
							branches: [
								[{ type: 'key', name: 'list' }],
								[{ type: 'key', name: 'get' }],
							],
						},
					],
					[
						{ type: 'key', name: 'storage' },
						{
							type: 'set',
							branches: [
								[{ type: 'key', name: 'add' }],
								[{ type: 'key', name: 'remove' }],
							],
						},
					],
				],
			},
		])
	})

	test('parses wildcard and recursive descent inside branches', () => {
		expect(parseSchemaSelector('.{user.*,deploy..lambda}')).toEqual([
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: 'user' }, { type: 'wildcard' }],
					[
						{ type: 'key', name: 'deploy' },
						{ type: 'recursive' },
						{ type: 'key', name: 'lambda' },
					],
				],
			},
		])
	})

	test('parses set with whitespace around branches', () => {
		expect(parseSchemaSelector('.{ user , config.get }')).toEqual([
			{
				type: 'set',
				branches: [
					[{ type: 'key', name: 'user' }],
					[
						{ type: 'key', name: 'config' },
						{ type: 'key', name: 'get' },
					],
				],
			},
		])
	})

	test('parses recursive descent', () => {
		expect(parseSchemaSelector('..')).toEqual([{ type: 'recursive' }])
		expect(parseSchemaSelector('..user')).toEqual([
			{ type: 'recursive' },
			{ type: 'key', name: 'user' },
		])
		expect(parseSchemaSelector('.deploy..lambda')).toEqual([
			{ type: 'key', name: 'deploy' },
			{ type: 'recursive' },
			{ type: 'key', name: 'lambda' },
		])
	})

	test('allows root selector', () => {
		expect(parseSchemaSelector('.')).toEqual([])
	})

	test('rejects missing dot', () => {
		expect(() => parseSchemaSelector('user.create')).toThrow(
			'Selector must start with "."',
		)
	})

	test('rejects empty selector', () => {
		expect(() => parseSchemaSelector('')).toThrow('Selector is empty')
	})

	test('rejects trailing dot', () => {
		expect(() => parseSchemaSelector('.user.')).toThrow('Expected identifier')
	})

	test('rejects empty set', () => {
		expect(() => parseSchemaSelector('.{}')).toThrow(
			'Selector set cannot be empty',
		)
	})

	test('rejects dangling set branch', () => {
		expect(() => parseSchemaSelector('.{user,}')).toThrow('Expected identifier')
	})

	test('rejects unterminated quoted key', () => {
		expect(() => parseSchemaSelector('."@add')).toThrow(
			'Unterminated quoted selector key',
		)
	})
})
