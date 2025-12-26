// Schema generator - outputs TypeScript-like type definition for AI agents

import type { AnySchema, Router } from './types'

import { isCommand, isGroup } from './types'

type SchemaOptions = {
	name: string
	description?: string
	globals?: AnySchema
}

// Try to extract type string from various schema libraries
function extractTypeFromSchema(schema: AnySchema): string {
	const s = schema as unknown as Record<string, unknown>

	// Valibot: has 'expects' field
	if (typeof s.expects === 'string') {
		return normalizeType(s.expects)
	}

	// Zod: has '_def' with typeName
	if (s._def && typeof s._def === 'object') {
		return extractZodType(s._def as Record<string, unknown>)
	}

	// ArkType: has 'infer' or 'expression'
	if (typeof s.expression === 'string') {
		return s.expression
	}

	// Fallback: try to infer from ~standard
	return 'unknown'
}

function extractZodType(def: Record<string, unknown>): string {
	const typeName = def.typeName as string | undefined

	switch (typeName) {
		case 'ZodString':
			return 'string'
		case 'ZodNumber':
			return 'number'
		case 'ZodBoolean':
			return 'boolean'
		case 'ZodLiteral':
			return JSON.stringify(def.value)
		case 'ZodEnum':
			return (def.values as string[]).map((v) => JSON.stringify(v)).join(' | ')
		case 'ZodOptional':
			return extractZodType(def.innerType as Record<string, unknown>) + '?'
		case 'ZodDefault':
			return extractZodType(def.innerType as Record<string, unknown>)
		case 'ZodObject': {
			const shape = def.shape as
				| Record<string, { _def: Record<string, unknown> }>
				| undefined
			if (!shape) return 'object'
			const entries = Object.entries(shape)
				.map(([k, v]) => `${k}: ${extractZodType(v._def)}`)
				.join(', ')
			return `{ ${entries} }`
		}
		default:
			return 'unknown'
	}
}

function normalizeType(expects: string): string {
	// Clean up valibot's expects format
	// "(\"prod\" | \"dev\")" -> "'prod' | 'dev'"
	// "((\"prod\" | \"dev\") | undefined)" -> "'prod' | 'dev' | undefined"
	return expects
		.replace(/^\(|\)$/g, '') // Remove outer parens
		.replace(/\\"/g, "'") // \"x\" -> 'x'
		.replace(/"/g, "'") // "x" -> 'x'
}

// Extract description from valibot pipe metadata
function extractDescription(field: Record<string, unknown>): string | null {
	// Check pipe array for description metadata
	const pipe = field.pipe as Array<Record<string, unknown>> | undefined
	if (pipe) {
		for (const item of pipe) {
			if (item.kind === 'metadata' && item.type === 'description') {
				return item.description as string
			}
		}
	}

	// Check wrapped schema (for optional fields)
	const wrapped = field.wrapped as Record<string, unknown> | undefined
	if (wrapped) {
		return extractDescription(wrapped)
	}

	return null
}

type ParamInfo = {
	name: string
	type: string
	optional: boolean
	default?: unknown
	description?: string
}

function extractInputParamsDetailed(schema: AnySchema): ParamInfo[] {
	const s = schema as unknown as Record<string, unknown>
	const params: ParamInfo[] = []

	// Valibot object schema
	if (s.type === 'object' && s.entries) {
		const entries = s.entries as Record<string, Record<string, unknown>>

		for (const [key, field] of Object.entries(entries)) {
			const isOptional = field.type === 'optional'
			const typeStr = extractTypeFromSchema(field as unknown as AnySchema)
			const defaultVal = field.default
			const description = extractDescription(field) ?? undefined

			params.push({
				name: key,
				type: typeStr.replace(' | undefined', '').replace('?', ''),
				optional: isOptional,
				default: defaultVal,
				description,
			})
		}

		return params
	}

	// Zod object schema
	if (s._def && (s._def as Record<string, unknown>).typeName === 'ZodObject') {
		const def = s._def as Record<string, unknown>
		const shape = def.shape as
			| Record<string, Record<string, unknown>>
			| undefined
		if (!shape) return []

		for (const [key, field] of Object.entries(shape)) {
			const fieldDef = field._def as Record<string, unknown>
			const isOptional =
				fieldDef.typeName === 'ZodOptional' ||
				fieldDef.typeName === 'ZodDefault'
			const typeStr = extractZodType(fieldDef)
			// Zod description is in fieldDef.description
			const description = fieldDef.description as string | undefined

			params.push({
				name: key,
				type: typeStr.replace('?', ''),
				optional: isOptional,
				description,
			})
		}

		return params
	}

	return params
}

function extractInputParams(schema: AnySchema): string {
	const params = extractInputParamsDetailed(schema)
	return params
		.map((p) => {
			let str = p.name
			if (p.optional) str += '?'
			str += `: ${p.type}`
			if (p.default !== undefined) {
				str += ` = ${JSON.stringify(p.default)}`
			}
			return str
		})
		.join(', ')
}

// Export for cli.ts help display
export { extractInputParamsDetailed, type ParamInfo }

function generateCommandSchema(
	name: string,
	router: Router,
	indent: string,
): string[] {
	const lines: string[] = []

	if (isCommand(router)) {
		const meta = router['~argc'].meta
		const input = router['~argc'].input
		const args = router['~argc'].args

		// JSDoc comments
		if (meta.description || meta.deprecated || meta.examples?.length) {
			lines.push(`${indent}/**`)
			if (meta.description) {
				lines.push(`${indent} * ${meta.description}`)
			}
			if (meta.deprecated) {
				lines.push(`${indent} * @deprecated`)
			}
			if (meta.examples?.length) {
				lines.push(`${indent} * @example`)
				for (const ex of meta.examples) {
					lines.push(`${indent} * ${ex}`)
				}
			}
			lines.push(`${indent} */`)
		}

		// Extract params from input schema (args are already included in input)
		const params = input ? extractInputParams(input) : ''

		lines.push(`${indent}${name}(${params})`)
		return lines
	}

	if (isGroup(router)) {
		const meta = router['~argc.group'].meta

		if (meta.description) {
			lines.push(`${indent}/** ${meta.description} */`)
		}

		lines.push(`${indent}${name}: {`)
		for (const [key, child] of Object.entries(router['~argc.group'].children)) {
			const childLines = generateCommandSchema(key, child, indent + '  ')
			lines.push(...childLines)
		}
		lines.push(`${indent}}`)
		return lines
	}

	// Plain object router (group without meta)
	lines.push(`${indent}${name}: {`)
	for (const [key, child] of Object.entries(router)) {
		const childLines = generateCommandSchema(key, child, indent + '  ')
		lines.push(...childLines)
	}
	lines.push(`${indent}}`)

	return lines
}

export function generateSchema(
	schema: Router,
	options: SchemaOptions,
): string {
	const lines: string[] = []

	// Header comment
	if (options.description) {
		lines.push(`/** ${options.description} */`)
	}

	// Type declaration
	lines.push(`type ${pascalCase(options.name)} = {`)

	// Global options
	if (options.globals) {
		const globalsParams = extractInputParams(options.globals)
		if (globalsParams) {
			lines.push(`  /** Global options available to all commands */`)
			lines.push(`  $globals: { ${globalsParams} }`)
			lines.push('')
		}
	}

	// Commands
	for (const [key, child] of Object.entries(
		isGroup(schema)
			? schema['~argc.group'].children
			: isCommand(schema)
				? {}
				: schema,
	)) {
		const childLines = generateCommandSchema(key, child, '  ')
		lines.push(...childLines)
	}

	lines.push('}')

	return lines.join('\n')
}

function pascalCase(str: string): string {
	return str
		.split(/[-_\s]+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join('')
}
