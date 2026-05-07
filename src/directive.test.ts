import { describe, expect, test } from 'bun:test'

import { directive } from './directive'

test('exports directive helpers from argc/directive', async () => {
	const mod = await import(['argc', 'directive'].join('/'))

	expect(mod.directive.content.file({ url: 'file:///tmp/result.zip' })).toBe(
		'::file{url:"file:///tmp/result.zip"}',
	)
})

test('keeps argc/result as a compatibility alias', async () => {
	const mod = await import(['argc', 'result'].join('/'))

	expect(mod.directive.content.file({ url: 'file:///tmp/result.zip' })).toBe(
		'::file{url:"file:///tmp/result.zip"}',
	)
	expect(mod.content.file({ url: 'file:///tmp/result.zip' })).toBe(
		'::file{url:"file:///tmp/result.zip"}',
	)
})

describe('directive', () => {
	test('encodes attrs as JSON5 object literal syntax', () => {
		expect(
			directive.encode('image', {
				url: 'blob://abc123',
				mime: 'image/png',
				width: 1024,
				animated: false,
				alt: 'a, "quoted" image',
				filename: undefined,
			}),
		).toBe(
			'::image{url:"blob://abc123",mime:"image/png",width:1024,animated:false,alt:"a, \\"quoted\\" image"}',
		)
	})

	test('decodes one directive with strings, commas, booleans, and numbers', () => {
		const raw =
			'::image{url:"blob://a",mime:"image/png",width:1024,alt:"a,b",safe:true}'
		const token = directive.decode(raw)

		expect(token).toEqual({
			kind: 'directive',
			name: 'image',
			attrs: {
				url: 'blob://a',
				mime: 'image/png',
				width: 1024,
				alt: 'a,b',
				safe: true,
			},
			raw,
			range: {
				start: 0,
				end: raw.length,
			},
		})
	})

	test('scans directives in text and keeps ranges', () => {
		const text =
			'generated ::image{url:"blob://a",mime:"image/png"} and ::file{url:"file:///tmp/a,b.zip",size:12}'
		const tokens = directive.scan(text)
		const firstRaw = '::image{url:"blob://a",mime:"image/png"}'

		expect(tokens).toHaveLength(2)
		expect(tokens[0]).toMatchObject({
			name: 'image',
			attrs: { url: 'blob://a', mime: 'image/png' },
			range: { start: 10, end: 10 + firstRaw.length },
		})
		expect(tokens[1]).toMatchObject({
			name: 'file',
			attrs: { url: 'file:///tmp/a,b.zip', size: 12 },
		})
	})

	test('ignores invalid directives without partial attrs', () => {
		expect(directive.decode('::image{url:"blob://a",meta:{bad:true}}')).toBe(
			null,
		)
		expect(directive.decode('::image{url:"blob://a",width:null}')).toBe(null)
		expect(directive.decode('::image{url:"blob://a"')).toBe(null)
		expect(
			directive.scan('x ::image{url:"blob://a",meta:{bad:true}} y'),
		).toEqual([])
	})
})

describe('content', () => {
	test('provides media directive helpers', () => {
		expect(
			directive.content.image({
				url: 'blob://a',
				mime: 'image/png',
				width: 640,
				height: 480,
			}),
		).toBe('::image{url:"blob://a",mime:"image/png",width:640,height:480}')
		expect(
			directive.content.video({
				url: 'blob://v',
				poster: 'https://x/y.jpg',
			}),
		).toBe('::video{url:"blob://v",poster:"https://x/y.jpg"}')
		expect(directive.content.audio({ url: 'blob://x', duration: 2.5 })).toBe(
			'::audio{url:"blob://x",duration:2.5}',
		)
		expect(
			directive.content.file({
				url: 'file:///tmp/result.zip',
				size: 12345,
			}),
		).toBe('::file{url:"file:///tmp/result.zip",size:12345}')
	})

	test('turns known directives into typed content', () => {
		const token = directive.decode(
			'::image{url:"blob://a",mime:"image/png",width:1024}',
		)
		expect(token).not.toBe(null)

		const item = directive.content.from(token!)

		expect(item).toEqual({
			type: 'image',
			url: 'blob://a',
			mime: 'image/png',
			width: 1024,
		})
	})

	test('downgrades unknown or invalid semantic content explicitly', () => {
		const unknown = directive.decode('::chart{url:"blob://chart"}')
		const invalid = directive.decode('::image{url:"blob://a",width:"wide"}')
		const obsoleteFormat = directive.decode(
			'::image{url:"blob://a",format:"png"}',
		)
		expect(unknown).not.toBe(null)
		expect(invalid).not.toBe(null)
		expect(obsoleteFormat).not.toBe(null)

		expect(directive.content.from(unknown!)).toEqual({
			type: 'unknown',
			name: 'chart',
			attrs: { url: 'blob://chart' },
			raw: '::chart{url:"blob://chart"}',
		})
		expect(directive.content.from(invalid!)).toEqual({
			type: 'unknown',
			name: 'image',
			attrs: { url: 'blob://a', width: 'wide' },
			raw: '::image{url:"blob://a",width:"wide"}',
		})
		expect(directive.content.from(obsoleteFormat!)).toEqual({
			type: 'unknown',
			name: 'image',
			attrs: { url: 'blob://a', format: 'png' },
			raw: '::image{url:"blob://a",format:"png"}',
		})
	})

	test('scans content spans and supports exhaustive matching', () => {
		const raw = '::file{url:"file:///tmp/a.zip",size:9}'
		const [span] = directive.content.scan(`see ${raw}`)
		expect(span).toMatchObject({
			content: { type: 'file', url: 'file:///tmp/a.zip', size: 9 },
			raw,
			range: { start: 4, end: 4 + raw.length },
		})

		const label = directive.content.match(span!.content, {
			image: (item) => `image:${item.url}`,
			video: (item) => `video:${item.url}`,
			audio: (item) => `audio:${item.url}`,
			file: (item) => `file:${item.url}`,
			unknown: (item) => `unknown:${item.name}`,
		})

		expect(label).toBe('file:file:///tmp/a.zip')
	})
})

describe('hydrate', () => {
	test('turns complete directive strings into directive tokens', () => {
		const raw = '::image{url:"blob://a",mime:"image/png"}'

		expect(
			directive.hydrate({
				a: 1,
				b: 'plain text ::image{url:"blob://a"}',
				c: raw,
			}),
		).toEqual({
			a: 1,
			b: 'plain text ::image{url:"blob://a"}',
			c: {
				kind: 'directive',
				name: 'image',
				attrs: { url: 'blob://a', mime: 'image/png' },
				raw,
				range: { start: 0, end: raw.length },
			},
		})
	})

	test('can hydrate directives through a semantic mapper', () => {
		const value = {
			items: ['::file{url:"file:///tmp/a.zip",size:9}'],
		}

		expect(
			directive.hydrate(value, {
				map: directive.content.from,
			}),
		).toEqual({
			items: [
				{
					type: 'file',
					url: 'file:///tmp/a.zip',
					size: 9,
				},
			],
		})
	})
})
