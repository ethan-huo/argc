import { expect, test } from 'bun:test'

import { renderMarkdown } from './markup'

const markdown = '# Title\n\nUse `argc @schema`.\n'

test('renderMarkdown preserves captured output byte-for-byte', () => {
	expect(renderMarkdown(markdown, { isTTY: false })).toBe(markdown)
})

test('renderMarkdown styles headings and inline code on a TTY', () => {
	const noColor = process.env.NO_COLOR
	delete process.env.NO_COLOR
	try {
		const rendered = renderMarkdown(markdown, { isTTY: true })

		expect(rendered).toContain('\x1b[1m\x1b[36m# Title')
		expect(rendered).toContain('\x1b[33m`argc @schema`')
	} finally {
		if (noColor === undefined) delete process.env.NO_COLOR
		else process.env.NO_COLOR = noColor
	}
})
