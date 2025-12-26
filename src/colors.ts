// Inline picocolors (https://github.com/alexeyraspopov/picocolors)
// Zero dependencies, ~50 lines

const argv = process.argv || []
const env = process.env || {}

const isColorSupported =
	!(!!env.NO_COLOR || argv.includes('--no-color')) &&
	(!!env.FORCE_COLOR ||
		argv.includes('--color') ||
		process.platform === 'win32' ||
		(process.stdout?.isTTY && env.TERM !== 'dumb') ||
		!!env.CI)

type Formatter = (input: string) => string

const formatter = (open: string, close: string, replace = open): Formatter => {
	return (input) => {
		const string = String(input)
		const index = string.indexOf(close, open.length)
		return ~index
			? open + replaceClose(string, close, replace, index) + close
			: open + string + close
	}
}

const replaceClose = (
	string: string,
	close: string,
	replace: string,
	index: number,
): string => {
	let result = ''
	let cursor = 0
	do {
		result += string.substring(cursor, index) + replace
		cursor = index + close.length
		index = string.indexOf(close, cursor)
	} while (~index)
	return result + string.substring(cursor)
}

const createColors = (enabled = isColorSupported) => {
	const f = enabled ? formatter : (): Formatter => String
	return {
		isColorSupported: enabled,
		reset: f('\x1b[0m', '\x1b[0m'),
		bold: f('\x1b[1m', '\x1b[22m', '\x1b[22m\x1b[1m'),
		dim: f('\x1b[2m', '\x1b[22m', '\x1b[22m\x1b[2m'),
		italic: f('\x1b[3m', '\x1b[23m'),
		underline: f('\x1b[4m', '\x1b[24m'),
		inverse: f('\x1b[7m', '\x1b[27m'),
		hidden: f('\x1b[8m', '\x1b[28m'),
		strikethrough: f('\x1b[9m', '\x1b[29m'),
		black: f('\x1b[30m', '\x1b[39m'),
		red: f('\x1b[31m', '\x1b[39m'),
		green: f('\x1b[32m', '\x1b[39m'),
		yellow: f('\x1b[33m', '\x1b[39m'),
		blue: f('\x1b[34m', '\x1b[39m'),
		magenta: f('\x1b[35m', '\x1b[39m'),
		cyan: f('\x1b[36m', '\x1b[39m'),
		white: f('\x1b[37m', '\x1b[39m'),
		gray: f('\x1b[90m', '\x1b[39m'),
	}
}

const pc = createColors()

// Semantic aliases for CLI output
export const colors = {
	...pc,
	// Semantic colors
	command: pc.cyan,
	arg: pc.yellow,
	option: pc.green,
	error: pc.red,
	warning: pc.yellow,
	success: pc.green,
}

export { createColors }
