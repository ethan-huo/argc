// Argv parser - converts string[] to structured data

export type ParsedArgs = {
	flags: Record<string, unknown>
	positionals: string[]
	raw: string[]
}

export function parseArgv(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		flags: {},
		positionals: [],
		raw: argv,
	}

	let i = 0

	while (i < argv.length) {
		const arg = argv[i]

		if (arg === '--') {
			// Everything after -- is positional
			i++
			while (i < argv.length) {
				result.positionals.push(argv[i])
				i++
			}
			break
		}

		if (arg.startsWith('--no-')) {
			// Boolean negation: --no-verbose -> verbose: false
			const key = camelCase(arg.slice(5))
			result.flags[key] = false
			i++
			continue
		}

		if (arg.startsWith('--')) {
			const eqIndex = arg.indexOf('=')
			if (eqIndex !== -1) {
				// --key=value
				const key = camelCase(arg.slice(2, eqIndex))
				const value = parseValue(arg.slice(eqIndex + 1))
				setFlag(result.flags, key, value)
			} else {
				// --key or --key value
				const key = camelCase(arg.slice(2))
				const next = argv[i + 1]
				if (next !== undefined && !next.startsWith('-')) {
					setFlag(result.flags, key, parseValue(next))
					i++
				} else {
					// Boolean flag
					result.flags[key] = true
				}
			}
			i++
			continue
		}

		if (arg.startsWith('-') && arg.length === 2) {
			// Short flag: -v or -v value
			const key = arg[1]
			const next = argv[i + 1]
			if (next !== undefined && !next.startsWith('-')) {
				setFlag(result.flags, key, parseValue(next))
				i++
			} else {
				result.flags[key] = true
			}
			i++
			continue
		}

		if (arg.startsWith('-') && arg.length > 2) {
			// Combined short flags: -abc -> a: true, b: true, c: true
			for (const char of arg.slice(1)) {
				result.flags[char] = true
			}
			i++
			continue
		}

		// Positional argument (could be command or actual positional)
		result.positionals.push(arg)
		i++
	}

	return result
}

function setFlag(
	flags: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	const existing = flags[key]
	if (existing !== undefined) {
		// Multiple values -> array
		if (Array.isArray(existing)) {
			existing.push(value)
		} else {
			flags[key] = [existing, value]
		}
	} else {
		flags[key] = value
	}
}

function parseValue(str: string): unknown {
	// Try to parse as number
	const num = Number(str)
	if (!Number.isNaN(num) && str.trim() !== '') {
		return num
	}

	// Try to parse as boolean
	if (str === 'true') return true
	if (str === 'false') return false

	// Return as string
	return str
}

function camelCase(str: string): string {
	return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
