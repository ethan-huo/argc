import { describe, expect, test } from 'bun:test'

import {
	buildSchemaSubset,
	domainError,
	matchSchemaSelector,
	parseSchemaSelector,
	selectSchema,
} from './index'

describe('public exports', () => {
	test('exports schema discovery helpers from the main entry', () => {
		expect(typeof parseSchemaSelector).toBe('function')
		expect(typeof matchSchemaSelector).toBe('function')
		expect(typeof buildSchemaSubset).toBe('function')
		expect(typeof selectSchema).toBe('function')
	})

	test('exports the domain error constructor from the main entry', () => {
		expect(typeof domainError).toBe('function')
		expect(() => domainError('', 'refused')).toThrow(
			'domainError code must be a non-empty string',
		)
		expect(() => domainError(undefined as never, 'refused')).toThrow(
			'domainError code must be a non-empty string',
		)
		expect(() => domainError('locked', 'refused', { code: 'other' })).toThrow(
			'domainError fields must not include "code"',
		)
	})
})
