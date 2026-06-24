import { stringify } from 'yaml'

export type ErrorIssue = {
	at?: string
	message: string
}

export type ErrorEnvelope = {
	error:
		| 'INVALID_INPUT'
		| 'UNKNOWN_COMMAND'
		| 'NOT_A_COMMAND'
		| 'BAD_INPUT_JSON'
		| 'TWO_INPUTS'
		| 'RUN_DISABLED'
		| 'RUNTIME_ERROR'
	[key: string]: unknown
}

export class ArgcError extends Error {
	envelope: ErrorEnvelope

	constructor(envelope: ErrorEnvelope) {
		super(String(envelope.error))
		this.name = 'ArgcError'
		this.envelope = envelope
	}
}

export function normalizeValue(value: unknown): unknown {
	return normalize(value, new WeakSet())
}

function normalize(value: unknown, seen: WeakSet<object>): unknown {
	if (value === undefined || typeof value === 'function') return undefined
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (value instanceof Map) {
		const out: Record<string, unknown> = {}
		for (const [key, entryValue] of value.entries()) {
			const normalized = normalize(entryValue, seen)
			if (normalized !== undefined) out[String(key)] = normalized
		}
		return out
	}
	if (value instanceof Set) {
		const out: unknown[] = []
		for (const item of value.values()) {
			const normalized = normalize(item, seen)
			if (normalized !== undefined) out.push(normalized)
		}
		return out
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => normalize(item, seen))
			.filter((item) => item !== undefined)
	}
	if (value !== null && typeof value === 'object') {
		if (seen.has(value)) return '[Circular]'
		seen.add(value)
		const out: Record<string, unknown> = {}
		for (const [key, entryValue] of Object.entries(value)) {
			const normalized = normalize(entryValue, seen)
			if (normalized !== undefined) out[key] = normalized
		}
		seen.delete(value)
		return out
	}
	return value
}

export function renderResult(
	value: unknown,
	mode: 'yaml' | 'json' = 'yaml',
): string {
	if (value === undefined) return ''
	if (typeof value === 'string' && mode === 'yaml') return value
	const normalized = normalizeValue(value)
	if (mode === 'json') return `${JSON.stringify(normalized, null, 2)}\n`
	return stringify(normalized, { lineWidth: 0 })
}

export function renderError(envelope: ErrorEnvelope): string {
	return stringify(normalizeValue(envelope), { lineWidth: 0 })
}

export async function withStdoutRerouted<T>(fn: () => Promise<T>): Promise<T> {
	const originalWrite = process.stdout.write
	const originalConsoleLog = console.log
	const redirected = function writeToStderr(
		this: NodeJS.WriteStream,
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
		callback?: (error?: Error | null) => void,
	): boolean {
		return process.stderr.write(
			chunk,
			encodingOrCallback as BufferEncoding,
			callback,
		)
	}

	process.stdout.write = redirected as typeof process.stdout.write
	console.log = (...args: unknown[]) => {
		process.stderr.write(`${args.map(String).join(' ')}\n`)
	}
	try {
		return await fn()
	} finally {
		console.log = originalConsoleLog
		process.stdout.write = originalWrite
	}
}

export function formatRuntimeError(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message || String(error)
		const prefix =
			error.name && error.name !== 'Error' && !msg.startsWith(`${error.name}:`)
				? `${error.name}: `
				: ''
		return `${prefix}${msg}`
	}
	return String(error)
}
