import { describe, expect, test } from 'bun:test'

import {
	fmt,
	padEnd,
	printTable,
	sliceAnsi,
	visibleWidth,
	wrapAnsi,
} from './terminal'

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

	test('Unicode graphemes and terminal hyperlinks', () => {
		expect(visibleWidth('中文')).toBe(4)
		expect(visibleWidth('👨‍👩‍👧')).toBe(2)
		expect(visibleWidth('🇺🇸')).toBe(2)
		expect(visibleWidth('e\u0301')).toBe(1)
		expect(visibleWidth('\x1b]8;;https://bun.sh\x07Bun\x1b]8;;\x07')).toBe(3)
	})
})

describe('ANSI-aware slicing and wrapping', () => {
	test('sliceAnsi preserves styles and grapheme boundaries', () => {
		expect(sliceAnsi('\x1b[31mhello\x1b[39m', 1, 4)).toBe('\x1b[31mell\x1b[39m')
		expect(sliceAnsi('A👨‍👩‍👧B', 1, 3)).toBe('👨‍👩‍👧')
	})

	test('wrapAnsi preserves styles across rows', () => {
		const wrapped = wrapAnsi('\x1b[31mThe quick brown fox\x1b[39m', 10)
		expect(wrapped).toContain('\x1b[31mThe quick\x1b[39m\n')
		expect(wrapped.split('\n').every((line) => visibleWidth(line) <= 10)).toBe(
			true,
		)
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
