import { JSON5 } from 'bun'

type PrimitiveDirectiveAttr = string | number | boolean

type DirectiveAttrs = Record<string, PrimitiveDirectiveAttr | null | undefined>

type DirectiveToken = {
	kind: 'directive'
	name: string
	attrs: Record<string, PrimitiveDirectiveAttr>
	raw: string
	range?: { start: number; end: number }
}

type ImageContent = {
	type: 'image'
	url: string
	mime?: string
	filename?: string
	width?: number
	height?: number
	size?: number
	alt?: string
}

type VideoContent = {
	type: 'video'
	url: string
	mime?: string
	filename?: string
	width?: number
	height?: number
	duration?: number
	size?: number
	poster?: string
}

type AudioContent = {
	type: 'audio'
	url: string
	mime?: string
	filename?: string
	duration?: number
	size?: number
}

type FileContent = {
	type: 'file'
	url: string
	mime?: string
	filename?: string
	size?: number
}

type UnknownContent = {
	type: 'unknown'
	name: string
	attrs: Record<string, PrimitiveDirectiveAttr>
	raw: string
}

type Content =
	| ImageContent
	| VideoContent
	| AudioContent
	| FileContent
	| UnknownContent

type ContentSpan = {
	content: Content
	raw: string
	range: { start: number; end: number }
}

type ContentHandlers<TResult> = {
	[K in Content['type']]: (item: Extract<Content, { type: K }>) => TResult
}

type DirectiveHydratableValue =
	| string
	| number
	| boolean
	| null
	| DirectiveHydratableValue[]
	| { [key: string]: DirectiveHydratableValue }

type DirectiveHydratedValue<TDirective = DirectiveToken> =
	| TDirective
	| string
	| number
	| boolean
	| null
	| DirectiveHydratedValue<TDirective>[]
	| { [key: string]: DirectiveHydratedValue<TDirective> }

type DirectiveHydrateOptions<TDirective = DirectiveToken> = {
	map?: (token: DirectiveToken) => TDirective
}

const DIRECTIVE_NAME_RE = /^[a-zA-Z0-9_-]+$/

const IMAGE_FIELDS = {
	string: new Set(['url', 'mime', 'filename', 'alt']),
	number: new Set(['width', 'height', 'size']),
}
const VIDEO_FIELDS = {
	string: new Set(['url', 'mime', 'filename', 'poster']),
	number: new Set(['width', 'height', 'duration', 'size']),
}
const AUDIO_FIELDS = {
	string: new Set(['url', 'mime', 'filename']),
	number: new Set(['duration', 'size']),
}
const FILE_FIELDS = {
	string: new Set(['url', 'mime', 'filename']),
	number: new Set(['size']),
}

function encodeDirective(name: string, attrs: DirectiveAttrs): string {
	if (!DIRECTIVE_NAME_RE.test(name)) {
		throw new Error(`Invalid directive name: ${name}`)
	}

	const entries = Object.entries(attrs).filter((entry) => entry[1] != null)
	const body = entries.map(([key, value]) => {
		if (!DIRECTIVE_NAME_RE.test(key)) {
			throw new Error(`Invalid directive attr key: ${key}`)
		}

		if (!isPrimitiveDirectiveAttr(value)) {
			throw new Error(`Invalid directive attr value for: ${key}`)
		}

		return `${key}:${formatJson5AttrValue(value)}`
	})

	return `::${name}{${body.join(',')}}`
}

function decodeDirective(text: string): DirectiveToken | null {
	const token = readDirectiveAt(text, 0)
	if (!token || token.end !== text.length) return null
	return {
		kind: 'directive',
		name: token.name,
		attrs: token.attrs,
		raw: token.raw,
		range: { start: 0, end: token.end },
	}
}

function scanDirectives(text: string): DirectiveToken[] {
	const tokens: DirectiveToken[] = []
	let index = 0

	while (index < text.length) {
		const start = text.indexOf('::', index)
		if (start === -1) break

		const token = readDirectiveAt(text, start)
		if (token) {
			tokens.push({
				kind: 'directive',
				name: token.name,
				attrs: token.attrs,
				raw: token.raw,
				range: { start, end: token.end },
			})
			index = token.end
			continue
		}

		index = start + 2
	}

	return tokens
}

function readDirectiveAt(
	text: string,
	start: number,
): {
	name: string
	attrs: Record<string, PrimitiveDirectiveAttr>
	raw: string
	end: number
} | null {
	if (!text.startsWith('::', start)) return null

	let cursor = start + 2
	const nameStart = cursor
	while (cursor < text.length && /[a-zA-Z0-9_-]/.test(text[cursor]!)) {
		cursor++
	}

	const name = text.slice(nameStart, cursor)
	if (!name || !DIRECTIVE_NAME_RE.test(name) || text[cursor] !== '{') {
		return null
	}

	const bodyEnd = findDirectiveBodyEnd(text, cursor)
	if (bodyEnd === null) return null

	const raw = text.slice(start, bodyEnd + 1)
	const body = text.slice(cursor, bodyEnd + 1)
	const attrs = parseDirectiveAttrs(body)
	if (!attrs) return null

	return { name, attrs, raw, end: bodyEnd + 1 }
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

function parseDirectiveAttrs(
	body: string,
): Record<string, PrimitiveDirectiveAttr> | null {
	let parsed: unknown
	try {
		parsed = JSON5.parse(body)
	} catch {
		return null
	}

	if (!isPlainObject(parsed)) return null

	const attrs: Record<string, PrimitiveDirectiveAttr> = {}
	for (const [key, value] of Object.entries(parsed)) {
		if (!DIRECTIVE_NAME_RE.test(key) || !isPrimitiveDirectiveAttr(value)) {
			return null
		}
		attrs[key] = value
	}

	return attrs
}

function isPrimitiveDirectiveAttr(
	value: unknown,
): value is PrimitiveDirectiveAttr {
	return (
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return false
	}
	const proto = Object.getPrototypeOf(value)
	return proto === Object.prototype || proto === null
}

function formatJson5AttrValue(value: PrimitiveDirectiveAttr): string {
	if (typeof value === 'string') return JSON.stringify(value)
	return String(value)
}

function image(attrs: Omit<ImageContent, 'type'>): string {
	return encodeDirective('image', attrs)
}

function video(attrs: Omit<VideoContent, 'type'>): string {
	return encodeDirective('video', attrs)
}

function audio(attrs: Omit<AudioContent, 'type'>): string {
	return encodeDirective('audio', attrs)
}

function file(attrs: Omit<FileContent, 'type'>): string {
	return encodeDirective('file', attrs)
}

function fromDirective(token: DirectiveToken): Content {
	switch (token.name) {
		case 'image': {
			const attrs = narrowContentAttrs(token, IMAGE_FIELDS)
			return attrs ? { type: 'image', ...attrs } : unknownContent(token)
		}
		case 'video': {
			const attrs = narrowContentAttrs(token, VIDEO_FIELDS)
			return attrs ? { type: 'video', ...attrs } : unknownContent(token)
		}
		case 'audio': {
			const attrs = narrowContentAttrs(token, AUDIO_FIELDS)
			return attrs ? { type: 'audio', ...attrs } : unknownContent(token)
		}
		case 'file': {
			const attrs = narrowContentAttrs(token, FILE_FIELDS)
			return attrs ? { type: 'file', ...attrs } : unknownContent(token)
		}
		default:
			return unknownContent(token)
	}
}

function narrowContentAttrs(
	token: DirectiveToken,
	fields: {
		string: Set<string>
		number: Set<string>
	},
): (Record<string, string | number> & { url: string }) | null {
	const out: Record<string, string | number> = {}

	for (const [key, value] of Object.entries(token.attrs)) {
		if (fields.string.has(key)) {
			if (typeof value !== 'string') return null
			out[key] = value
			continue
		}

		if (fields.number.has(key)) {
			if (typeof value !== 'number') return null
			out[key] = value
			continue
		}

		return null
	}

	if (typeof out.url !== 'string') return null
	return out as Record<string, string | number> & { url: string }
}

function unknownContent(token: DirectiveToken): UnknownContent {
	return {
		type: 'unknown',
		name: token.name,
		attrs: token.attrs,
		raw: token.raw,
	}
}

function scanContent(text: string): ContentSpan[] {
	return scanDirectives(text).flatMap((token) => {
		if (!token.range) return []
		return [
			{
				content: fromDirective(token),
				raw: token.raw,
				range: token.range,
			},
		]
	})
}

function matchContent<TResult>(
	item: Content,
	handlers: ContentHandlers<TResult>,
): TResult {
	switch (item.type) {
		case 'image':
			return handlers.image(item)
		case 'video':
			return handlers.video(item)
		case 'audio':
			return handlers.audio(item)
		case 'file':
			return handlers.file(item)
		case 'unknown':
			return handlers.unknown(item)
	}
}

function hydrateDirectives<TDirective = DirectiveToken>(
	value: DirectiveHydratableValue,
	options: DirectiveHydrateOptions<TDirective> = {},
): DirectiveHydratedValue<TDirective> {
	if (typeof value === 'string') {
		const token = decodeDirective(value)
		if (!token) return value
		return options.map ? options.map(token) : (token as TDirective)
	}

	if (Array.isArray(value)) {
		return value.map((item) => hydrateDirectives(item, options))
	}

	if (isPlainObject(value)) {
		const out: Record<string, DirectiveHydratedValue<TDirective>> = {}
		for (const [key, child] of Object.entries(value)) {
			out[key] = hydrateDirectives(child, options)
		}
		return out
	}

	return value
}

const contentDirective = {
	image,
	video,
	audio,
	file,
	from: fromDirective,
	scan: scanContent,
	match: matchContent,
}

const directive = {
	encode: encodeDirective,
	decode: decodeDirective,
	scan: scanDirectives,
	hydrate: hydrateDirectives,
	content: contentDirective,
}

export {
	directive,
	type AudioContent,
	type Content,
	type ContentHandlers,
	type ContentSpan,
	type DirectiveAttrs,
	type DirectiveHydratableValue,
	type DirectiveHydratedValue,
	type DirectiveHydrateOptions,
	type DirectiveToken,
	type FileContent,
	type ImageContent,
	type PrimitiveDirectiveAttr,
	type UnknownContent,
	type VideoContent,
}
