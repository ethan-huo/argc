export type InputSource =
	| { kind: 'omitted' }
	| { kind: 'inline'; value: string }
	| { kind: 'file'; path: string }
	| { kind: 'stdin' }
	| { kind: 'object'; value: Record<string, unknown> }

export type ParsedArgs = {
	raw: string[]
}

export function parseArgv(argv: string[]): ParsedArgs {
	return { raw: argv }
}

export function parseInputSource(token: string | undefined): InputSource {
	if (token === undefined) return { kind: 'omitted' }
	if (token === '-') return { kind: 'stdin' }
	if (token.startsWith('@')) {
		const path = token.slice(1)
		if (!path) throw new Error('expected a file path after @')
		return { kind: 'file', path }
	}
	return { kind: 'inline', value: token }
}
