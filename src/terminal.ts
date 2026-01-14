// Terminal output utilities for CLI apps
// Combines: color detection + semantic output + ANSI-aware table

// ============ Color Detection ============

const argv = process.argv || []
const env = process.env || {}

const isColorSupported =
	!(!!env.NO_COLOR || argv.includes('--no-color')) &&
	(!!env.FORCE_COLOR ||
		argv.includes('--color') ||
		process.platform === 'win32' ||
		(process.stdout?.isTTY && env.TERM !== 'dumb') ||
		!!env.CI)

// ============ Base Colors ============

const RESET = '\x1b[0m'

const createFormatter = (code: string) =>
	isColorSupported ? (s: string) => `${code}${s}${RESET}` : (s: string) => s

const baseColors = {
	// Standard colors
	black: createFormatter('\x1b[30m'),
	red: createFormatter('\x1b[31m'),
	green: createFormatter('\x1b[32m'),
	yellow: createFormatter('\x1b[33m'),
	blue: createFormatter('\x1b[34m'),
	magenta: createFormatter('\x1b[35m'),
	cyan: createFormatter('\x1b[36m'),
	white: createFormatter('\x1b[37m'),
	gray: createFormatter('\x1b[90m'),

	// Styles
	bold: createFormatter('\x1b[1m'),
	dim: createFormatter('\x1b[2m'),
	italic: createFormatter('\x1b[3m'),
	underline: createFormatter('\x1b[4m'),
	inverse: createFormatter('\x1b[7m'),
	strikethrough: createFormatter('\x1b[9m'),
}

// ============ Semantic Output (with icons) ============

/**
 * Terminal formatting utilities.
 *
 * @example
 * ```ts
 * import { fmt } from 'argc/terminal'
 *
 * console.log(fmt.success('Done!'))     // ✓ Done!
 * console.log(fmt.error('Failed'))      // ✗ Failed
 * console.log(fmt.red('danger'))        // red text
 * ```
 */
export const fmt = {
	...baseColors,
	isColorSupported,

	// Semantic with icons (for user output)
	success: (s: string) => `${baseColors.green('✓')} ${s}`,
	error: (s: string) => `${baseColors.red('✗')} ${s}`,
	warn: (s: string) => `${baseColors.yellow('⚠')} ${s}`,
	info: (s: string) => `${baseColors.cyan('▶')} ${s}`,

	// Semantic colors (for help/usage formatting)
	command: baseColors.cyan,
	arg: baseColors.yellow,
	option: baseColors.green,
}

// ============ ANSI-aware String Utils ============

const ANSI_REGEX = /\x1b\[[0-9;]*m/g

/** Check if a character is a wide character (CJK, fullwidth, etc.) */
function isWideChar(code: number): boolean {
	return (
		// CJK Unified Ideographs
		(code >= 0x4e00 && code <= 0x9fff) ||
		// CJK Unified Ideographs Extension A
		(code >= 0x3400 && code <= 0x4dbf) ||
		// CJK Compatibility Ideographs
		(code >= 0xf900 && code <= 0xfaff) ||
		// Fullwidth Forms
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		// Hangul Syllables
		(code >= 0xac00 && code <= 0xd7af) ||
		// Hiragana & Katakana
		(code >= 0x3040 && code <= 0x30ff) ||
		// CJK Symbols and Punctuation
		(code >= 0x3000 && code <= 0x303f) ||
		// Enclosed CJK Letters and Months
		(code >= 0x3200 && code <= 0x32ff) ||
		// CJK Compatibility
		(code >= 0x3300 && code <= 0x33ff)
	)
}

/** Get visible width of string (excluding ANSI escape codes, handling wide chars) */
export function visibleWidth(str: string): number {
	const plain = str.replace(ANSI_REGEX, '')
	let width = 0
	for (const char of plain) {
		const code = char.codePointAt(0) || 0
		width += isWideChar(code) ? 2 : 1
	}
	return width
}

/** Pad string to specified visible width */
export function padEnd(str: string, width: number): string {
	const visible = visibleWidth(str)
	if (visible >= width) return str
	return str + ' '.repeat(width - visible)
}

// ============ Table Printing ============

export type TableColumn = {
	key: string
	label: string
	width?: number
}

export type TableRow = Record<string, string>

/**
 * Print a table with proper ANSI color support.
 * Unlike console.table, this correctly aligns columns with colored text.
 *
 * @example
 * ```ts
 * import { printTable, fmt } from 'argc/terminal'
 *
 * printTable(
 *   [{ key: 'name', label: 'NAME' }, { key: 'status', label: 'STATUS' }],
 *   [{ name: 'foo', status: fmt.green('ok') }]
 * )
 * ```
 */
export function printTable(columns: TableColumn[], rows: TableRow[]): void {
	// Calculate column widths
	const colWidths = columns.map((col) => {
		const headerWidth = visibleWidth(col.label)
		const maxCellWidth = rows.reduce((max, row) => {
			const cellWidth = visibleWidth(row[col.key] ?? '')
			return Math.max(max, cellWidth)
		}, 0)
		const naturalWidth = Math.max(headerWidth, maxCellWidth)
		return col.width ? Math.min(naturalWidth, col.width) : naturalWidth
	})

	// Print header
	const header = columns
		.map((col, i) => fmt.dim(padEnd(col.label, colWidths[i]!)))
		.join('  ')
	console.log(header)

	// Print separator
	const separator = colWidths.map((w) => '─'.repeat(w)).join('──')
	console.log(fmt.dim(separator))

	// Print rows
	for (const row of rows) {
		const line = columns
			.map((col, i) => padEnd(row[col.key] ?? '', colWidths[i]!))
			.join('  ')
		console.log(line)
	}
}
