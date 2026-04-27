import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { describe, expect, test } from 'bun:test'
import * as v from 'valibot'

import { c, group } from './command'
import { createDefaultSchemaExplorer } from './schema-explorer'

const s = toStandardJsonSchema

const schema = {
	call: group(
		{ description: 'Call tools' },
		{
			posthog: group(
				{ description: 'PostHog' },
				{
					'alert-create': c.input(s(v.object({ name: v.string() }))),
				},
			),
		},
	),
}

describe('createDefaultSchemaExplorer', () => {
	test('uses configurable selector depth', () => {
		const explorer = createDefaultSchemaExplorer({ selectionDepth: 2 })
		const selected = explorer.select(schema, '.call')
		const output = explorer.render(selected.schema, {
			name: 'mcpx',
		})

		expect(output).toContain('posthog: {')
		expect(output).toContain('alert-create(name: string)')
	})

	test('accepts selector-aware depth functions', () => {
		const explorer = createDefaultSchemaExplorer({
			selectionDepth: (selector) => (selector === '.call' ? 2 : 1),
		})
		const selected = explorer.select(schema, '.call')
		const output = explorer.render(selected.schema, {
			name: 'mcpx',
		})

		expect(output).toContain('alert-create(name: string)')
	})
})
