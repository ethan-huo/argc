// Schema generator - outputs TypeScript-like type definition for AI agents
// Uses Standard JSON Schema (StandardJSONSchemaV1) for schema introspection

import type { Router, Schema } from './types'
import { isCommand, isGroup } from './types'
import { getRouterChildren } from './router'

type SchemaOptions = {
	name: string
	description?: string
	globals?: Schema
}

type JSONSchema = Record<string, unknown>

// Convert JSON Schema to TypeScript-like type string
function jsonSchemaToTypeString(schema: JSONSchema): string {
	const type = schema.type as string | undefined

	// Handle const
	if ('const' in schema) {
		return JSON.stringify(schema.const)
	}

	// Handle enum
	if (schema.enum) {
		return (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ')
	}

	// Handle oneOf/anyOf (union types)
	if (schema.oneOf || schema.anyOf) {
		const variants = (schema.oneOf || schema.anyOf) as JSONSchema[]
		return variants.map((v) => jsonSchemaToTypeString(v)).join(' | ')
	}

	// Handle allOf (intersection types)
	if (schema.allOf) {
		const variants = schema.allOf as JSONSchema[]
		return variants.map((v) => jsonSchemaToTypeString(v)).join(' & ')
	}

	// Handle $ref (simplified - just show as unknown)
	if (schema.$ref) {
		return 'unknown'
	}

	switch (type) {
		case 'string':
			return 'string'
		case 'number':
		case 'integer':
			return 'number'
		case 'boolean':
			return 'boolean'
		case 'null':
			return 'null'
		case 'array': {
			const items = schema.items as JSONSchema | undefined
			if (items) {
				return `${jsonSchemaToTypeString(items)}[]`
			}
			return 'unknown[]'
		}
		case 'object': {
			const properties = schema.properties as
				| Record<string, JSONSchema>
				| undefined
			if (!properties) return 'object'

			const required = new Set((schema.required as string[]) ?? [])
			const entries = Object.entries(properties)
				.map(([k, v]) => {
					const opt = required.has(k) ? '' : '?'
					return `${k}${opt}: ${jsonSchemaToTypeString(v)}`
				})
				.join(', ')
			return `{ ${entries} }`
		}
		default:
			// No type specified, try to infer
			if (schema.properties) {
				return jsonSchemaToTypeString({ ...schema, type: 'object' })
			}
			return 'unknown'
	}
}

// Parameter info for help display and schema generation
type ParamInfo = {
	name: string
	type: string
	optional: boolean
	default?: unknown
	description?: string
}

// Extract parameters from schema using JSON Schema
function extractInputParamsDetailed(schema: Schema): ParamInfo[] {
	let jsonSchema: JSONSchema
	try {
		jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-07' })
	} catch {
		return []
	}

	const params: ParamInfo[] = []
	const properties = jsonSchema.properties as
		| Record<string, JSONSchema>
		| undefined
	if (!properties) return []

	const required = new Set((jsonSchema.required as string[]) ?? [])

	for (const [name, prop] of Object.entries(properties)) {
		const isOptional = !required.has(name)
		const typeStr = jsonSchemaToTypeString(prop)
		const description = prop.description as string | undefined
		const defaultVal = prop.default

		params.push({
			name,
			type: typeStr,
			optional: isOptional,
			default: defaultVal,
			description,
		})
	}

	return params
}

// Format params as function signature
function extractInputParams(schema: Schema): string {
	const params = extractInputParamsDetailed(schema)
	return formatParams(params)
}

// Export for cli.ts help display
function formatParams(params: ParamInfo[]): string {
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

export function getInputTypeHint(schema: Schema): string {
	const params = extractInputParamsDetailed(schema)
	if (params.length === 0) return 'object'
	const parts = params.map((p) => {
		const typeHint = formatInputHintType(p.type)
		const key = p.optional ? `${p.name}?` : p.name
		return `${key}: ${typeHint}`
	})
	return `{ ${parts.join(', ')} }`
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

		// Comments
		if (meta.description) {
			const deprecatedTag = meta.deprecated ? ' [DEPRECATED]' : ''
			lines.push(`${indent}// ${meta.description}${deprecatedTag}`)
		}
		if (meta.examples?.length) {
			for (const ex of meta.examples) {
				lines.push(`${indent}// $ ${ex}`)
			}
		}

		// Extract params from input schema
		const params = input ? extractInputParams(input) : ''
		lines.push(`${indent}${name}(${params})`)
		return lines
	}

	if (isGroup(router)) {
		const meta = router['~argc.group'].meta

		if (meta.description) {
			lines.push(`${indent}// ${meta.description}`)
		}

		lines.push(`${indent}${name}: {`)
		for (const [key, child] of Object.entries(router['~argc.group'].children)) {
			const childLines = generateCommandSchema(key, child, `${indent}  `)
			lines.push(...childLines)
		}
		lines.push(`${indent}}`)
		return lines
	}

	// Plain object router (group without meta)
	lines.push(`${indent}${name}: {`)
	for (const [key, child] of Object.entries(router)) {
		const childLines = generateCommandSchema(key, child, `${indent}  `)
		lines.push(...childLines)
	}
	lines.push(`${indent}}`)

	return lines
}

export function generateSchema(schema: Router, options: SchemaOptions): string {
	const lines: string[] = []

	// CLI syntax hint for AI agents
	lines.push('CLI Syntax:')
	lines.push('  arrays:  --tag a --tag b             → tag: ["a", "b"]')
	lines.push('  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }')
	lines.push('')

	// Description
	if (options.description) {
		lines.push(options.description)
		lines.push('')
	}

	// Type declaration
	lines.push(`type ${pascalCase(options.name)} = {`)

	// Global options
	if (options.globals) {
		const globalsParams = extractInputParams(options.globals)
		if (globalsParams) {
			lines.push(`  // Global options available to all commands`)
			lines.push(`  $globals: { ${globalsParams} }`)
			lines.push('')
		}
	}

	// Commands
	const children = isGroup(schema)
		? schema['~argc.group'].children
		: isCommand(schema)
			? {}
			: schema

	for (const [key, child] of Object.entries(children)) {
		const childLines = generateCommandSchema(key, child, '  ')
		lines.push(...childLines)
	}

	lines.push('}')

	return lines.join('\n')
}

export function generateSchemaOutline(
	schema: Router,
	depth: number = 2,
): string[] {
	const children = getRouterChildren(schema)
	const lines: string[] = []
	for (const [name, child] of Object.entries(children)) {
		lines.push(renderOutlineNode(name, child, depth))
	}
	return lines
}

export function generateSchemaHintExample(schema: Router): string | null {
	const children = getRouterChildren(schema)
	const entries = Object.entries(children)
	for (const [name, child] of entries) {
		const deep = findDeepPath(child, [name], 3)
		if (deep) return deep.join('.')
	}
	for (const [name, child] of entries) {
		const two = findDeepPath(child, [name], 2)
		if (two) return two.join('.')
	}
	if (entries.length > 0) return entries[0]![0]
	return null
}

function pascalCase(str: string): string {
	return str
		.split(/[-_\s]+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join('')
}

function renderOutlineNode(name: string, router: Router, depth: number): string {
	if (depth <= 0) return name
	if (isCommand(router)) return name
	const children = getRouterChildren(router)
	const parts = Object.entries(children).map(([childName, child]) =>
		renderOutlineNode(childName, child, depth - 1),
	)
	if (parts.length === 0) return `${name}{}`
	return `${name}{${parts.join(',')}}`
}

function findDeepPath(
	router: Router,
	path: string[],
	minDepth: number,
): string[] | null {
	if (minDepth <= 1) return path
	if (isCommand(router)) return null
	const children = getRouterChildren(router)
	for (const [name, child] of Object.entries(children)) {
		const found = findDeepPath(child, [...path, name], minDepth - 1)
		if (found) return found
	}
	return null
}

function formatInputHintType(type: string): string {
	const trimmed = type.trim()
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		return 'object'
	}
	if (isLiteralUnion(trimmed)) {
		return 'enum'
	}
	if (trimmed.endsWith('[]')) {
		const inner = trimmed.slice(0, -2).trim()
		if (inner.startsWith('{') && inner.endsWith('}')) return 'object[]'
		if (isLiteralUnion(inner)) return 'enum[]'
	}
	return type
}

function isLiteralUnion(type: string): boolean {
	const parts = type.split('|').map((part) => part.trim())
	if (parts.length < 2) return false
	return parts.every((part) => isLiteralToken(part))
}

function isLiteralToken(part: string): boolean {
	if (
		(part.startsWith('"') && part.endsWith('"')) ||
		(part.startsWith("'") && part.endsWith("'"))
	) {
		return true
	}
	if (part === 'true' || part === 'false' || part === 'null') return true
	return isNumberLiteral(part)
}

function isNumberLiteral(part: string): boolean {
	if (part === '') return false
	const num = Number(part)
	return !Number.isNaN(num) && String(num) === part
}
