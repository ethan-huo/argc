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

export const ansi = {
	black: '\x1b[30m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	white: '\x1b[37m',
	gray: '\x1b[90m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	italic: '\x1b[3m',
	underline: '\x1b[4m',
	inverse: '\x1b[7m',
	strikethrough: '\x1b[9m',
} as const

export function formatAnsi(
	code: string,
	value: string,
	enabled: boolean,
): string {
	return enabled ? `${code}${value}${RESET}` : value
}

const createFormatter = (code: string) =>
	isColorSupported ? (s: string) => `${code}${s}${RESET}` : (s: string) => s

const baseColors = {
	// Standard colors
	black: createFormatter(ansi.black),
	red: createFormatter(ansi.red),
	green: createFormatter(ansi.green),
	yellow: createFormatter(ansi.yellow),
	blue: createFormatter(ansi.blue),
	magenta: createFormatter(ansi.magenta),
	cyan: createFormatter(ansi.cyan),
	white: createFormatter(ansi.white),
	gray: createFormatter(ansi.gray),

	// Styles
	bold: createFormatter(ansi.bold),
	dim: createFormatter(ansi.dim),
	italic: createFormatter(ansi.italic),
	underline: createFormatter(ansi.underline),
	inverse: createFormatter(ansi.inverse),
	strikethrough: createFormatter(ansi.strikethrough),
}

// ============ Semantic Output (with icons) ============

/**
 * Terminal formatting utilities.
 *
 * @example
 * 	;```ts
 * 	import { fmt } from 'argc/terminal'
 *
 * 	console.log(fmt.success('Done!')) // ✓ Done!
 * 	console.log(fmt.error('Failed')) // ✗ Failed
 * 	console.log(fmt.red('danger')) // red text
 * 	```
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

/** Slice by terminal columns without breaking ANSI state or Unicode graphemes. */
export const sliceAnsi = Bun.sliceAnsi

/** Wrap by terminal columns while preserving ANSI state and Unicode graphemes. */
export const wrapAnsi = Bun.wrapAnsi

/**
 * Get the terminal column width, excluding ANSI escape codes and accounting for
 * Unicode graphemes.
 */
export function visibleWidth(str: string): number {
	return Bun.stringWidth(str)
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
 * Print a table with proper ANSI color support. Unlike console.table, this
 * correctly aligns columns with colored text.
 *
 * @example
 * 	;```ts
 * 	import { printTable, fmt } from 'argc/terminal'
 *
 * 	printTable(
 * 		[
 * 			{ key: 'name', label: 'NAME' },
 * 			{ key: 'status', label: 'STATUS' },
 * 		],
 * 		[{ name: 'foo', status: fmt.green('ok') }],
 * 	)
 * 	```
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
