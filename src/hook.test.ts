import { afterEach, describe, expect, test } from 'bun:test'

import type { HookEvent } from './types'

import {
	createHookDispatcher,
	createUlid,
	formatHookError,
	sanitizeHookData,
} from './hook'

const ULID_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/
const NON_SERIALIZABLE_DATA = { _hookError: 'non-serializable data' }
const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('createUlid', () => {
	test('returns a Crockford base32 ULID', () => {
		const id = createUlid()

		expect(id).toHaveLength(26)
		expect(id).toMatch(ULID_PATTERN)
	})

	test('generates unique ids in a batch', () => {
		const ids = new Set<string>()
		for (let i = 0; i < 1000; i++) {
			ids.add(createUlid())
		}

		expect(ids.size).toBe(1000)
	})
})

describe('sanitizeHookData', () => {
	test('preserves json-safe empty and nested data', () => {
		expect(sanitizeHookData({})).toEqual({})
		expect(sanitizeHookData([])).toEqual([])
		expect(sanitizeHookData({ a: [{ b: { c: 1 } }] })).toEqual({
			a: [{ b: { c: 1 } }],
		})
	})

	test('uses toJSON output for objects that provide it', () => {
		const date = new Date('2026-04-15T00:00:00.000Z')

		expect(sanitizeHookData({ at: date })).toEqual({ at: date.toJSON() })
	})

	test('distinguishes shared references from circular references', () => {
		const shared = { ok: true }
		const circular: Record<string, unknown> = { name: 'loop' }
		circular.self = circular

		expect(sanitizeHookData({ first: shared, second: shared })).toEqual({
			first: { ok: true },
			second: { ok: true },
		})
		expect(sanitizeHookData(circular)).toEqual({
			name: 'loop',
			self: NON_SERIALIZABLE_DATA,
		})
	})

	test('replaces non-json-safe primitive and traversal failures', () => {
		const hostile = {}
		Object.defineProperty(hostile, 'boom', {
			enumerable: true,
			get() {
				throw new Error('getter failed')
			},
		})

		expect(
			sanitizeHookData({
				fn: () => {},
				sym: Symbol('x'),
				big: 1n,
				nan: Number.NaN,
				inf: Number.POSITIVE_INFINITY,
				hostile,
			}),
		).toEqual({
			fn: NON_SERIALIZABLE_DATA,
			sym: NON_SERIALIZABLE_DATA,
			big: NON_SERIALIZABLE_DATA,
			nan: NON_SERIALIZABLE_DATA,
			inf: NON_SERIALIZABLE_DATA,
			hostile: NON_SERIALIZABLE_DATA,
		})
	})
})

describe('formatHookError', () => {
	test('formats non-error values', () => {
		expect(formatHookError('bad')).toEqual({ message: 'bad' })
		expect(formatHookError(42)).toEqual({ message: '42' })
		expect(formatHookError(null)).toEqual({ message: 'null' })
	})

	test('formats Error subclasses with name and message', () => {
		class CustomError extends Error {
			name = 'CustomError'
		}

		expect(formatHookError(new CustomError('broken'))).toEqual({
			name: 'CustomError',
			message: 'broken',
		})
	})
})

describe('createHookDispatcher', () => {
	test('posts batches to hookUrl transport', async () => {
		const requests: {
			input: Parameters<typeof fetch>[0]
			init: Parameters<typeof fetch>[1]
		}[] = []
		globalThis.fetch = (async (input, init) => {
			requests.push({ input, init })
			return new Response(null, { status: 204 })
		}) as typeof fetch

		const dispatcher = createHookDispatcher({
			app: 'test',
			hookUrl: 'http://localhost:9090/events',
			timeoutMs: 2000,
		})
		const call = dispatcher.createCall(['user', 'create'], 'user create')
		call.emit({ id: 1 })
		call.end(true)
		await dispatcher.drain()

		expect(requests).toHaveLength(1)
		expect(String(requests[0]!.input)).toBe('http://localhost:9090/events')
		expect(requests[0]!.init?.method).toBe('POST')
		expect(requests[0]!.init?.headers).toEqual({
			'content-type': 'application/json',
		})

		const events = JSON.parse(String(requests[0]!.init?.body)) as HookEvent[]
		expect(events.map((event) => event.kind)).toEqual([
			'call',
			'call.emit',
			'call.end',
		])
		expect(events.map((event) => event.seq)).toEqual([1, 2, 3])
		expect(events[0]!.data).toBeNull()
	})

	test('hook false disables hookUrl transport', async () => {
		const requests: Parameters<typeof fetch>[] = []
		globalThis.fetch = (async (...args) => {
			requests.push(args)
			return new Response(null, { status: 204 })
		}) as typeof fetch

		const dispatcher = createHookDispatcher({
			app: 'test',
			hook: false,
			hookUrl: 'http://localhost:9090/events',
			timeoutMs: 2000,
		})
		const call = dispatcher.createCall(['user'], 'user')
		call.emit({ id: 1 })
		call.end(true)
		await dispatcher.drain()

		expect(requests).toHaveLength(0)
	})
})
