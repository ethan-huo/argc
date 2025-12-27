import { describe, expect, test } from 'bun:test'

import { formatSuggestion, suggestSimilar } from './suggest'

describe('suggestSimilar', () => {
	const commands = ['list', 'create', 'delete', 'update', 'config', 'deploy']

	test('finds exact prefix match', () => {
		const result = suggestSimilar('lis', commands)
		expect(result).toContain('list')
	})

	test('finds typo correction', () => {
		const result = suggestSimilar('lst', commands)
		expect(result).toContain('list')
	})

	test('finds transposition', () => {
		const result = suggestSimilar('lsit', commands)
		expect(result).toContain('list')
	})

	test('finds similar with one char diff', () => {
		const result = suggestSimilar('creat', commands)
		expect(result).toContain('create')
	})

	test('returns empty for no match', () => {
		const result = suggestSimilar('xyz', commands)
		expect(result).toEqual([])
	})

	test('returns empty for empty candidates', () => {
		const result = suggestSimilar('test', [])
		expect(result).toEqual([])
	})

	test('case insensitive', () => {
		const result = suggestSimilar('LIST', commands)
		expect(result).toContain('list')
	})

	test('skips single char candidates', () => {
		const result = suggestSimilar('a', ['a', 'b', 'ab'])
		// 'a' and 'b' should be skipped (length <= 1)
		expect(result).not.toContain('a')
		expect(result).not.toContain('b')
	})

	test('deduplicates candidates', () => {
		const result = suggestSimilar('lst', ['list', 'list', 'list'])
		expect(result).toEqual(['list'])
	})

	test('sorts results alphabetically', () => {
		const result = suggestSimilar('delet', ['delete', 'deploy'])
		expect(result).toEqual(['delete'])
	})
})

describe('formatSuggestion', () => {
	test('single suggestion', () => {
		const lines = formatSuggestion(['list'])
		expect(lines[0]).toBe('The most similar command is')
		expect(lines[1]).toContain('list')
	})

	test('multiple suggestions', () => {
		const lines = formatSuggestion(['delete', 'deploy'])
		expect(lines[0]).toBe('The most similar commands are')
		expect(lines.length).toBe(3)
		expect(lines[1]).toContain('delete')
		expect(lines[2]).toContain('deploy')
	})

	test('empty suggestions', () => {
		const lines = formatSuggestion([])
		expect(lines).toEqual([])
	})
})
