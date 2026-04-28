import type { Router } from './types'

import {
	generateSchema,
	generateSchemaHintExample,
	generateSchemaOutline,
	type SchemaOptions,
} from './schema'
import { selectSchema, type SchemaSelectionResult } from './schema-selector'

export type SchemaExplorerOptions = {
	selectionDepth?: number | ((selector: string) => number)
	outlineDepth?: number
	maxLines?: number
}

export type SchemaExplorer = {
	select: (router: Router, selector: string) => SchemaSelectionResult
	render: (router: Router, options: SchemaOptions) => string
	outline: (router: Router) => string[]
	hint: (router: Router) => string | null
	maxLines: number
}

export function createDefaultSchemaExplorer(
	options: SchemaExplorerOptions = {},
): SchemaExplorer {
	const outlineDepth = options.outlineDepth ?? 2
	const maxLines = options.maxLines ?? 1000

	return {
		select: (router, selector) =>
			selectSchema(router, selector, {
				depth: resolveSelectionDepth(options.selectionDepth, selector),
			}),
		render: (router, renderOptions) => generateSchema(router, renderOptions),
		outline: (router) => generateSchemaOutline(router, outlineDepth),
		hint: (router) => generateSchemaHintExample(router),
		maxLines,
	}
}

function resolveSelectionDepth(
	selectionDepth: SchemaExplorerOptions['selectionDepth'],
	selector: string,
): number {
	if (typeof selectionDepth === 'function') {
		return selectionDepth(selector)
	}
	return selectionDepth ?? 1
}
