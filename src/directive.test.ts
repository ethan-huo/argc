import { describe, expect, test } from 'bun:test'

import { directive, type ImageDirective } from './directive'

test('exports directive helpers from argc/directive', async () => {
	const mod = await import(['argc', 'directive'].join('/'))

	expect(
		mod.directive.encode({
			type: 'file',
			url: 'file:///tmp/result.zip',
		}),
	).toBe('::file{url:"file:///tmp/result.zip"}')
})

test('keeps argc/result as a compatibility alias', async () => {
	const mod = await import(['argc', 'result'].join('/'))

	expect(
		mod.directive.encode({
			type: 'file',
			url: 'file:///tmp/result.zip',
		}),
	).toBe('::file{url:"file:///tmp/result.zip"}')
})

describe('directive', () => {
	test('encodes a typed directive object', () => {
		const image: ImageDirective = {
			type: 'image',
			url: 'blob://abc123',
			mime: 'image/png',
			width: 1024,
			alt: 'a, "quoted" image',
		}

		expect(directive.encode(image)).toBe(
			'::image{url:"blob://abc123",mime:"image/png",width:1024,alt:"a, \\"quoted\\" image"}',
		)
	})

	test('encodes generic directive payloads', () => {
		expect(
			directive.encode({
				type: 'review-finding',
				'file-path': '/tmp/a.ts',
				line: 12,
				fixed: false,
				meta: { rule: 'no-debugger' },
				tags: ['lint', 'ci'],
				note: null,
			}),
		).toBe(
			'::review-finding{"file-path":"/tmp/a.ts",line:12,fixed:false,meta:{"rule":"no-debugger"},tags:["lint","ci"],note:null}',
		)
	})

	test('rejects invalid directive values', () => {
		expect(() =>
			directive.encode({
				type: 'image',
				url: 'blob://a',
				size: Number.NaN,
			}),
		).toThrow('Invalid directive attr value for: size')
		expect(() =>
			directive.encode({
				type: 'bad name',
				url: 'blob://a',
			}),
		).toThrow('Invalid directive type: bad name')
	})

	test('decodes one directive into an object', () => {
		const raw =
			'::image{url:"blob://a",mime:"image/png",width:1024,alt:"a,b",safe:true}'
		const result = directive.decode(raw)

		expect(result).toEqual({
			type: 'image',
			url: 'blob://a',
			mime: 'image/png',
			width: 1024,
			alt: 'a,b',
			safe: true,
		})
	})

	test('scans directives in text and keeps ranges', () => {
		const text =
			'generated ::image{url:"blob://a",mime:"image/png"} and ::file{url:"file:///tmp/a,b.zip",size:12}'
		const spans = directive.scan(text)
		const firstRaw = '::image{url:"blob://a",mime:"image/png"}'

		expect(spans).toHaveLength(2)
		expect(spans[0]).toMatchObject({
			directive: { type: 'image', url: 'blob://a', mime: 'image/png' },
			raw: firstRaw,
			range: { start: 10, end: 10 + firstRaw.length },
		})
		expect(spans[1]).toMatchObject({
			directive: { type: 'file', url: 'file:///tmp/a,b.zip', size: 12 },
		})
	})

	test('ignores invalid directives without partial attrs', () => {
		expect(directive.decode('::image{url:"blob://a",width:null}')).toEqual({
			type: 'image',
			url: 'blob://a',
			width: null,
		})
		expect(directive.decode('::image{url:"blob://a",type:"file"}')).toBe(null)
		expect(directive.decode('::image{url:"blob://a"')).toBe(null)
		expect(directive.scan('x ::image{url:"blob://a",type:"file"} y')).toEqual(
			[],
		)
	})
})

describe('content types', () => {
	test('recognizes known content directive shapes', () => {
		expect(
			directive.isContent({
				type: 'image',
				url: 'blob://a',
				mime: 'image/png',
				width: 640,
				height: 480,
			}),
		).toBe(true)
		expect(
			directive.isContent({
				type: 'video',
				url: 'blob://v',
				poster: 'https://x/y.jpg',
			}),
		).toBe(true)
		expect(
			directive.isContent({
				type: 'audio',
				url: 'blob://x',
				duration: 2.5,
			}),
		).toBe(true)
		expect(
			directive.isContent({
				type: 'file',
				url: 'file:///tmp/result.zip',
				size: 12345,
			}),
		).toBe(true)
	})

	test('rejects unknown or invalid content directive shapes', () => {
		expect(
			directive.isContent({
				type: 'chart',
				url: 'blob://chart',
			}),
		).toBe(false)
		expect(
			directive.isContent({
				type: 'image',
				url: 'blob://a',
				width: 'wide',
			}),
		).toBe(false)
		expect(
			directive.isContent({
				type: 'image',
				url: 'blob://a',
				format: 'png',
			}),
		).toBe(false)
	})
})

describe('hydrate', () => {
	test('turns complete directive strings into directive objects', () => {
		expect(
			directive.hydrate({
				a: 1,
				b: 'plain text ::image{url:"blob://a"}',
				c: '::image{url:"blob://a",mime:"image/png"}',
			}),
		).toEqual({
			a: 1,
			b: 'plain text ::image{url:"blob://a"}',
			c: {
				type: 'image',
				url: 'blob://a',
				mime: 'image/png',
			},
		})
	})

	test('can hydrate directives through a semantic mapper', () => {
		const value = {
			items: ['::file{url:"file:///tmp/a.zip",size:9}'],
		}

		expect(
			directive.hydrate(value, {
				map: (item) =>
					directive.isContent(item)
						? { kind: 'content' as const, item }
						: { kind: 'unknown' as const, item },
			}),
		).toEqual({
			items: [
				{
					kind: 'content',
					item: {
						type: 'file',
						url: 'file:///tmp/a.zip',
						size: 9,
					},
				},
			],
		})
	})
})
