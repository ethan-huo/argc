import { JSON5 } from 'bun'

type JsonPrimitive = string | number | boolean | null
type JsonObject = { [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject

type DirectivePayload = Record<string, JsonValue>
type DirectiveEncodeInput = { type: string } & Record<
	string,
	JsonValue | undefined
>

type DirectiveObject<
	TType extends string = string,
	TPayload extends DirectivePayload = DirectivePayload,
> = { type: TType } & TPayload

type ImageDirective = DirectiveObject<
	'image',
	{
		url: string
		mime?: string
		filename?: string
		width?: number
		height?: number
		size?: number
		alt?: string
	}
>

type VideoDirective = DirectiveObject<
	'video',
	{
		url: string
		mime?: string
		filename?: string
		width?: number
		height?: number
		duration?: number
		size?: number
		poster?: string
	}
>

type AudioDirective = DirectiveObject<
	'audio',
	{
		url: string
		mime?: string
		filename?: string
		duration?: number
		size?: number
	}
>

type FileDirective = DirectiveObject<
	'file',
	{
		url: string
		mime?: string
		filename?: string
		size?: number
	}
>

type ContentDirective =
	| ImageDirective
	| VideoDirective
	| AudioDirective
	| FileDirective

type DirectiveSpan<TDirective = DirectiveObject> = {
	directive: TDirective
	raw: string
	range: { start: number; end: number }
}

type DirectiveHydratableValue =
	| JsonValue
	| { [key: string]: DirectiveHydratableValue }
	| DirectiveHydratableValue[]

type DirectiveHydratedValue<TDirective = DirectiveObject> =
	| TDirective
	| JsonPrimitive
	| DirectiveHydratedValue<TDirective>[]
	| { [key: string]: DirectiveHydratedValue<TDirective> }

type DirectiveHydrateOptions<TDirective = DirectiveObject> = {
	map?: (directive: DirectiveObject) => TDirective
}

const DIRECTIVE_NAME_RE = /^[a-zA-Z0-9_-]+$/
const ATTR_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const CONTENT_FIELD_TYPES = {
	image: {
		string: new Set(['url', 'mime', 'filename', 'alt']),
		number: new Set(['width', 'height', 'size']),
	},
	video: {
		string: new Set(['url', 'mime', 'filename', 'poster']),
		number: new Set(['width', 'height', 'duration', 'size']),
	},
	audio: {
		string: new Set(['url', 'mime', 'filename']),
		number: new Set(['duration', 'size']),
	},
	file: {
		string: new Set(['url', 'mime', 'filename']),
		number: new Set(['size']),
	},
} as const

function encodeDirective(value: DirectiveEncodeInput): string {
	const { type, ...payload } = value

	if (!DIRECTIVE_NAME_RE.test(type)) {
		throw new Error(`Invalid directive type: ${type}`)
	}

	const entries = Object.entries(payload).filter((entry) => {
		const [, attrValue] = entry
		return attrValue !== undefined
	})
	const body = entries.map(([key, attrValue]) => {
		if (key === 'type') {
			throw new Error('Directive payload cannot contain reserved key: type')
		}

		if (!isJsonValue(attrValue)) {
			throw new Error(`Invalid directive attr value for: ${key}`)
		}

		return `${formatDirectiveKey(key)}:${formatDirectiveValue(attrValue)}`
	})

	return `::${type}{${body.join(',')}}`
}

function decodeDirective(text: string): DirectiveObject | null {
	const span = readDirectiveAt(text, 0)
	if (!span || span.end !== text.length) return null
	return span.directive
}

function scanDirectives(text: string): DirectiveSpan[] {
	const spans: DirectiveSpan[] = []
	let index = 0

	while (index < text.length) {
		const start = text.indexOf('::', index)
		if (start === -1) break

		const span = readDirectiveAt(text, start)
		if (span) {
			spans.push({
				directive: span.directive,
				raw: span.raw,
				range: { start, end: span.end },
			})
			index = span.end
			continue
		}

		index = start + 2
	}

	return spans
}

function readDirectiveAt(
	text: string,
	start: number,
): {
	directive: DirectiveObject
	raw: string
	end: number
} | null {
	if (!text.startsWith('::', start)) return null

	let cursor = start + 2
	const nameStart = cursor
	while (cursor < text.length && /[a-zA-Z0-9_-]/.test(text[cursor]!)) {
		cursor++
	}

	const type = text.slice(nameStart, cursor)
	if (!type || !DIRECTIVE_NAME_RE.test(type) || text[cursor] !== '{') {
		return null
	}

	const bodyEnd = findDirectiveBodyEnd(text, cursor)
	if (bodyEnd === null) return null

	const raw = text.slice(start, bodyEnd + 1)
	const body = text.slice(cursor, bodyEnd + 1)
	const payload = parseDirectivePayload(body)
	if (!payload) return null

	return {
		directive: { type, ...payload },
		raw,
		end: bodyEnd + 1,
	}
}

function findDirectiveBodyEnd(text: string, openBrace: number): number | null {
	let depth = 0
	let quote: '"' | "'" | null = null
	let escaped = false
	let lineComment = false
	let blockComment = false

	for (let i = openBrace; i < text.length; i++) {
		const char = text[i]!
		const next = text[i + 1]

		if (lineComment) {
			if (char === '\n' || char === '\r') return null
			continue
		}

		if (blockComment) {
			if (char === '*' && next === '/') {
				blockComment = false
				i++
			}
			continue
		}

		if (quote) {
			if (escaped) {
				escaped = false
				continue
			}
			if (char === '\\') {
				escaped = true
				continue
			}
			if (char === quote) quote = null
			continue
		}

		if (char === '\n' || char === '\r') return null
		if (char === '/' && next === '/') {
			lineComment = true
			i++
			continue
		}
		if (char === '/' && next === '*') {
			blockComment = true
			i++
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '{') {
			depth++
			continue
		}
		if (char === '}') {
			depth--
			if (depth === 0) return i
			if (depth < 0) return null
		}
	}

	return null
}

function parseDirectivePayload(body: string): DirectivePayload | null {
	let parsed: unknown
	try {
		parsed = JSON5.parse(body)
	} catch {
		return null
	}

	if (!isPlainObject(parsed)) return null

	const payload: DirectivePayload = {}
	for (const [key, value] of Object.entries(parsed)) {
		if (key === 'type' || !isJsonValue(value)) return null
		payload[key] = value
	}

	return payload
}

function hydrateDirectives<TDirective = DirectiveObject>(
	value: DirectiveHydratableValue,
	options: DirectiveHydrateOptions<TDirective> = {},
): DirectiveHydratedValue<TDirective> {
	if (typeof value === 'string') {
		const parsed = decodeDirective(value)
		if (!parsed) return value
		return options.map ? options.map(parsed) : (parsed as TDirective)
	}

	if (Array.isArray(value)) {
		return value.map((item) => hydrateDirectives(item, options))
	}

	if (isPlainObject(value)) {
		const out: Record<string, DirectiveHydratedValue<TDirective>> = {}
		for (const [key, child] of Object.entries(value)) {
			out[key] = hydrateDirectives(child as DirectiveHydratableValue, options)
		}
		return out
	}

	return value
}

function isDirective(value: unknown): value is DirectiveObject {
	return (
		isPlainObject(value) &&
		typeof value.type === 'string' &&
		DIRECTIVE_NAME_RE.test(value.type) &&
		Object.entries(value).every(([key, attrValue]) => {
			if (key === 'type') return true
			return isJsonValue(attrValue)
		})
	)
}

function isContentDirective(value: unknown): value is ContentDirective {
	if (!isDirective(value)) return false

	switch (value.type) {
		case 'image':
			return hasContentShape(value, CONTENT_FIELD_TYPES.image)
		case 'video':
			return hasContentShape(value, CONTENT_FIELD_TYPES.video)
		case 'audio':
			return hasContentShape(value, CONTENT_FIELD_TYPES.audio)
		case 'file':
			return hasContentShape(value, CONTENT_FIELD_TYPES.file)
		default:
			return false
	}
}

function hasContentShape(
	value: DirectiveObject,
	fields: {
		string: Set<string>
		number: Set<string>
	},
): boolean {
	for (const [key, attrValue] of Object.entries(value)) {
		if (key === 'type') continue

		if (fields.string.has(key)) {
			if (typeof attrValue !== 'string') return false
			continue
		}

		if (fields.number.has(key)) {
			if (typeof attrValue !== 'number') return false
			continue
		}

		return false
	}

	return typeof value.url === 'string'
}

function isJsonValue(value: unknown): value is JsonValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	) {
		return true
	}

	if (typeof value === 'number') return Number.isFinite(value)
	if (Array.isArray(value)) return value.every(isJsonValue)
	if (!isPlainObject(value)) return false

	return Object.values(value).every(isJsonValue)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return false
	}
	const proto = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

function formatDirectiveKey(key: string): string {
	return ATTR_IDENTIFIER_RE.test(key) ? key : JSON.stringify(key)
}

function formatDirectiveValue(value: JsonValue): string {
	return JSON.stringify(value) ?? 'null'
}

const directive = {
	encode: encodeDirective,
	decode: decodeDirective,
	scan: scanDirectives,
	hydrate: hydrateDirectives,
	is: isDirective,
	isContent: isContentDirective,
}

export {
	directive,
	type AudioDirective,
	type ContentDirective,
	type DirectiveEncodeInput,
	type DirectiveHydratableValue,
	type DirectiveHydratedValue,
	type DirectiveHydrateOptions,
	type DirectiveObject,
	type DirectivePayload,
	type DirectiveSpan,
	type FileDirective,
	type ImageDirective,
	type JsonObject,
	type JsonPrimitive,
	type JsonValue,
	type VideoDirective,
}
