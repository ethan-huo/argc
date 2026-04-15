import { randomFillSync } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import type {
	HookEndData,
	HookErrorData,
	HookEvent,
	HookTransport,
} from './types'

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const NON_SERIALIZABLE_DATA = { _hookError: 'non-serializable data' }

type HookEventInput = Omit<HookEvent, 'seq' | 'data'> & {
	data: unknown
}

export type HookDispatcher = {
	createCall: (path: string[], command: string) => HookCall
	drain: () => Promise<void>
}

export type HookCall = {
	callId: string
	emit: (data: unknown) => void
	error: (error: unknown) => void
	end: (ok: boolean) => void
}

export type HookDispatcherOptions = {
	app: string
	hook?: false | HookTransport
	hookUrl?: string
	timeoutMs: number
}

function createNonSerializableData(): { _hookError: string } {
	return { ...NON_SERIALIZABLE_DATA }
}

export function createUlid(now: number = Date.now()): string {
	let time = Math.trunc(now)
	let timestamp = ''

	for (let i = 0; i < 10; i++) {
		timestamp = ULID_ALPHABET[time % 32]! + timestamp
		time = Math.floor(time / 32)
	}

	const bytes = new Uint8Array(10)
	randomFillSync(bytes)

	let random = ''
	let value = 0
	let bits = 0
	for (const byte of bytes) {
		value = (value << 8) | byte
		bits += 8
		while (bits >= 5) {
			random += ULID_ALPHABET[(value >>> (bits - 5)) & 31]!
			bits -= 5
		}
		value &= (1 << bits) - 1
	}

	return timestamp + random
}

export function sanitizeHookData(data: unknown): unknown {
	return sanitizeValue(data, new WeakSet<object>())
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null) return null
	if (typeof value === 'string') return value
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : createNonSerializableData()
	}
	if (
		typeof value === 'undefined' ||
		typeof value === 'function' ||
		typeof value === 'symbol' ||
		typeof value === 'bigint'
	) {
		return createNonSerializableData()
	}

	if (seen.has(value)) return createNonSerializableData()
	seen.add(value)

	try {
		const maybeJson = (value as { toJSON?: unknown }).toJSON
		if (typeof maybeJson === 'function') {
			try {
				const json = maybeJson.call(value)
				if (json !== value) return sanitizeValue(json, seen)
			} catch {
				return createNonSerializableData()
			}
		}

		if (Array.isArray(value)) {
			return Array.from(value, (item) => sanitizeValue(item, seen))
		}

		const out: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			out[key] = sanitizeValue(item, seen)
		}
		return out
	} catch {
		return createNonSerializableData()
	} finally {
		seen.delete(value)
	}
}

export function formatHookError(error: unknown): HookErrorData {
	if (error instanceof Error) {
		return {
			...(error.name ? { name: error.name } : {}),
			message: error.message || String(error),
		}
	}
	return { message: String(error) }
}

export function createHookDispatcher(
	options: HookDispatcherOptions,
): HookDispatcher {
	const transport = resolveTransport(options)
	const queue = new HookQueue(transport, options.timeoutMs)

	return {
		createCall(path: string[], command: string): HookCall {
			const callId = createUlid()
			const startedAt = performance.now()
			const base = {
				callId,
				app: options.app,
				command,
				path: [...path],
			}

			queue.push({
				...base,
				kind: 'call',
				data: null,
				at: Date.now(),
			})

			return {
				callId,
				emit(data: unknown): void {
					queue.push({
						...base,
						kind: 'call.emit',
						data,
						at: Date.now(),
					})
				},
				error(error: unknown): void {
					queue.push({
						...base,
						kind: 'call.error',
						data: formatHookError(error),
						at: Date.now(),
					})
				},
				end(ok: boolean): void {
					const data: HookEndData = {
						duration: performance.now() - startedAt,
						ok,
					}
					queue.push({
						...base,
						kind: 'call.end',
						data,
						at: Date.now(),
					})
				},
			}
		},
		drain(): Promise<void> {
			return queue.drain()
		},
	}
}

function resolveTransport(
	options: HookDispatcherOptions,
): HookTransport | null {
	if (options.hook === false) return null
	if (typeof options.hook === 'function') return options.hook
	if (!options.hookUrl) return null

	return async (events: HookEvent[]) => {
		await fetch(options.hookUrl!, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(events),
		})
	}
}

class HookQueue {
	private seq = 0
	private buffer: HookEvent[] = []
	private inflight = new Set<Promise<void>>()
	private scheduled = false
	private transport: HookTransport | null
	private timeoutMs: number

	constructor(transport: HookTransport | null, timeoutMs: number) {
		this.transport = transport
		this.timeoutMs = timeoutMs
	}

	push(event: HookEventInput): void {
		if (!this.transport) return

		const safe = {
			...event,
			seq: ++this.seq,
			data: sanitizeHookData(event.data),
		} as HookEvent

		this.buffer.push(safe)
		if (!this.scheduled) {
			this.scheduled = true
			queueMicrotask(() => this.flush())
		}
	}

	private flush(): void {
		this.scheduled = false
		if (!this.transport || this.buffer.length === 0) return

		const batch = this.buffer.splice(0)
		const pending = Promise.resolve()
			.then(() => this.transport?.(batch))
			.then(
				() => {},
				() => {},
			)
		this.inflight.add(pending)
		pending.finally(() => {
			this.inflight.delete(pending)
		})
	}

	async drain(): Promise<void> {
		this.flush()
		if (this.inflight.size === 0) return

		let timeout: ReturnType<typeof setTimeout> | undefined
		try {
			await Promise.race([
				Promise.allSettled([...this.inflight]),
				new Promise<void>((resolve) => {
					timeout = setTimeout(resolve, this.timeoutMs)
				}),
			])
		} finally {
			if (timeout) clearTimeout(timeout)
		}
	}
}
