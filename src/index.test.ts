import { describe, expect, test } from 'bun:test'

import {
	buildSchemaSubset,
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
})
