import { describe, expect, test } from 'bun:test'

import { fmt, padEnd, printTable, visibleWidth } from './terminal'

describe('fmt', () => {
	describe('base colors', () => {
		test('red wraps text', () => {
			const result = fmt.red('error')
			expect(result).toContain('error')
			// Should contain ANSI codes or be plain text depending on env
		})

		test('green wraps text', () => {
			const result = fmt.green('success')
			expect(result).toContain('success')
		})

		test('dim wraps text', () => {
			const result = fmt.dim('muted')
			expect(result).toContain('muted')
		})
	})

	describe('semantic functions (with icons)', () => {
		test('success adds checkmark', () => {
			const result = fmt.success('Done!')
			expect(result).toContain('✓')
			expect(result).toContain('Done!')
		})

		test('error adds cross', () => {
			const result = fmt.error('Failed')
			expect(result).toContain('✗')
			expect(result).toContain('Failed')
		})

		test('warn adds warning', () => {
			const result = fmt.warn('Caution')
			expect(result).toContain('⚠')
			expect(result).toContain('Caution')
		})

		test('info adds arrow', () => {
			const result = fmt.info('Starting')
			expect(result).toContain('▶')
			expect(result).toContain('Starting')
		})
	})

	describe('semantic colors (for help)', () => {
		test('command is cyan', () => {
			expect(fmt.command).toBe(fmt.cyan)
		})

		test('arg is yellow', () => {
			expect(fmt.arg).toBe(fmt.yellow)
		})

		test('option is green', () => {
			expect(fmt.option).toBe(fmt.green)
		})
	})

	test('isColorSupported is boolean', () => {
		expect(typeof fmt.isColorSupported).toBe('boolean')
	})
})

describe('visibleWidth', () => {
	test('plain text', () => {
		expect(visibleWidth('hello')).toBe(5)
	})

	test('text with ANSI codes', () => {
		const colored = '\x1b[31mred\x1b[0m'
		expect(visibleWidth(colored)).toBe(3)
	})

	test('empty string', () => {
		expect(visibleWidth('')).toBe(0)
	})

	test('multiple ANSI codes', () => {
		const text = '\x1b[1m\x1b[32mbold green\x1b[0m'
		expect(visibleWidth(text)).toBe(10)
	})
})

describe('padEnd', () => {
	test('pads plain text', () => {
		expect(padEnd('hi', 5)).toBe('hi   ')
	})

	test('pads text with ANSI codes correctly', () => {
		const colored = '\x1b[31mhi\x1b[0m'
		const padded = padEnd(colored, 5)
		// Should have 3 spaces after the ANSI reset
		expect(padded.endsWith('   ')).toBe(true)
		expect(visibleWidth(padded)).toBe(5)
	})

	test('no padding if already wide enough', () => {
		expect(padEnd('hello', 3)).toBe('hello')
	})

	test('exact width needs no padding', () => {
		expect(padEnd('hello', 5)).toBe('hello')
	})
})

describe('printTable', () => {
	test('prints table to console', () => {
		// Just verify it doesn't throw
		const columns = [
			{ key: 'name', label: 'NAME' },
			{ key: 'age', label: 'AGE' },
		]
		const rows = [
			{ name: 'Alice', age: '30' },
			{ name: 'Bob', age: '25' },
		]
		expect(() => printTable(columns, rows)).not.toThrow()
	})

	test('handles empty rows', () => {
		const columns = [{ key: 'name', label: 'NAME' }]
		expect(() => printTable(columns, [])).not.toThrow()
	})

	test('handles missing cell values', () => {
		const columns = [
			{ key: 'name', label: 'NAME' },
			{ key: 'age', label: 'AGE' },
		]
		const rows = [{ name: 'Alice' }] // missing age
		expect(() => printTable(columns, rows)).not.toThrow()
	})
})
