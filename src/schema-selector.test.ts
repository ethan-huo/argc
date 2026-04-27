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
			{ type: 'set', names: ['create', 'delete'] },
		])
	})

	test('parses set segment with at-prefixed and quoted keys', () => {
		expect(parseSchemaSelector('.{"@add",@remove}')).toEqual([
			{ type: 'set', names: ['@add', '@remove'] },
		])
	})

	test('parses root set', () => {
		expect(parseSchemaSelector('.{user,config}')).toEqual([
			{ type: 'set', names: ['user', 'config'] },
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

	test('rejects unterminated quoted key', () => {
		expect(() => parseSchemaSelector('."@add')).toThrow(
			'Unterminated quoted selector key',
		)
	})
})
