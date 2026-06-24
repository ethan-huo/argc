import type { Router, Schema } from './types'

import { getRouterChildren } from './router'
import { isCommand, isGroup } from './types'

export type SchemaOptions = {
	name: string
	description?: string
	context?: Schema
}

type JSONSchema = Record<string, unknown>

export type ParamInfo = {
	name: string
	type: string
	optional: boolean
	default?: unknown
	description?: string
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function isValidIdentifier(name: string): boolean {
	return IDENTIFIER_RE.test(name)
}

function formatPropertyKey(name: string): string {
	return isValidIdentifier(name) ? name : JSON.stringify(name)
}

function splitTopLevelTypes(type: string, operator: '|' | '&'): string[] {
	const parts: string[] = []
	let start = 0
	let depth = 0
	let quote: '"' | "'" | null = null
	let escaped = false

	for (let index = 0; index < type.length; index++) {
		const char = type[index]
		if (quote) {
			if (escaped) {
				escaped = false
			} else if (char === '\\') {
				escaped = true
			} else if (char === quote) {
				quote = null
			}
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '{' || char === '[' || char === '(') {
			depth++
			continue
		}
		if (char === '}' || char === ']' || char === ')') {
			depth--
			continue
		}
		if (depth === 0 && char === operator) {
			parts.push(type.slice(start, index).trim())
			start = index + 1
		}
	}

	parts.push(type.slice(start).trim())
	return parts
}

function joinUniqueTypes(types: string[], operator: '|' | '&'): string {
	const seen = new Set<string>()
	const unique: string[] = []
	for (const type of types) {
		for (const part of splitTopLevelTypes(type, operator)) {
			if (seen.has(part)) continue
			seen.add(part)
			unique.push(part)
		}
	}
	return unique.join(` ${operator} `)
}

function jsonSchemaToTypeString(schema: JSONSchema): string {
	const type = schema.type as string | undefined

	if ('const' in schema) return JSON.stringify(schema.const)
	if (schema.enum) {
		return joinUniqueTypes(
			(schema.enum as unknown[]).map((v) => JSON.stringify(v)),
			'|',
		)
	}
	if (schema.oneOf || schema.anyOf) {
		const variants = (schema.oneOf || schema.anyOf) as JSONSchema[]
		return joinUniqueTypes(
			variants.map((v) => jsonSchemaToTypeString(v)),
			'|',
		)
	}
	if (schema.allOf) {
		const variants = schema.allOf as JSONSchema[]
		return joinUniqueTypes(
			variants.map((v) => jsonSchemaToTypeString(v)),
			'&',
		)
	}
	if (schema.$ref) return 'unknown'

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
			return items ? `${jsonSchemaToTypeString(items)}[]` : 'unknown[]'
		}
		case 'object': {
			const properties = schema.properties as
				| Record<string, JSONSchema>
				| undefined
			if (!properties) return 'object'
			const required = new Set((schema.required as string[]) ?? [])
			const entries = Object.entries(properties)
				.map(([key, value]) => {
					const opt = required.has(key) ? '' : '?'
					return `${formatPropertyKey(key)}${opt}: ${jsonSchemaToTypeString(value)}`
				})
				.join('; ')
			return `{ ${entries} }`
		}
		default:
			if (schema.properties)
				return jsonSchemaToTypeString({ ...schema, type: 'object' })
			return 'unknown'
	}
}

function readJsonSchema(
	schema: Schema,
	side: 'input' | 'output',
): JSONSchema | null {
	try {
		return schema['~standard'].jsonSchema[side]({ target: 'draft-07' })
	} catch {
		return null
	}
}

function extractParamsFromJsonSchema(jsonSchema: JSONSchema): ParamInfo[] {
	const properties = jsonSchema.properties as
		| Record<string, JSONSchema>
		| undefined
	if (!properties) return []

	const required = new Set((jsonSchema.required as string[]) ?? [])
	return Object.entries(properties).map(([name, prop]) => {
		const param: ParamInfo = {
			name,
			type: jsonSchemaToTypeString(prop),
			optional: !required.has(name),
		}
		if (prop.default !== undefined) param.default = prop.default
		if (prop.description !== undefined)
			param.description = prop.description as string
		return param
	})
}

export function extractCliInputParamsDetailed(schema: Schema): ParamInfo[] {
	const jsonSchema = readJsonSchema(schema, 'input')
	if (!jsonSchema) return []
	return extractParamsFromJsonSchema(jsonSchema)
}

export function extractOutputParamsDetailed(schema: Schema): ParamInfo[] {
	const jsonSchema = readJsonSchema(schema, 'output')
	if (!jsonSchema) return []
	return extractParamsFromJsonSchema(jsonSchema)
}

function formatParams(params: ParamInfo[]): string {
	return params
		.map((param) => {
			const opt = param.optional ? '?' : ''
			return `${formatPropertyKey(param.name)}${opt}: ${param.type}`
		})
		.join('; ')
}

export function getInputTypeHint(schema: Schema): string {
	return `{ ${formatParams(extractOutputParamsDetailed(schema))} }`
}

function pascalCase(name: string): string {
	return name
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
		.join('')
}

function sampleValue(type: string): string {
	if (type.includes('|')) return sampleValue(type.split('|')[0]!.trim())
	if (type === 'number') return '1'
	if (type === 'boolean') return 'true'
	if (type.endsWith('[]')) return '[]'
	if (type.startsWith('{')) return '{}'
	return "'value'"
}

function exampleInput(params: ParamInfo[]): string {
	if (params.length === 0) return '{}'
	return `{ ${params
		.map(
			(param) => `${formatPropertyKey(param.name)}: ${sampleValue(param.type)}`,
		)
		.join(', ')} }`
}

function pushDoc(lines: string[], indent: string, text: string): void {
	const normalized = text.replaceAll('*/', '* /')
	lines.push(`${indent}/** ${normalized} */`)
}

function generateCommandSchema(
	appName: string,
	path: string[],
	name: string,
	router: Router,
	indent: string,
): string[] {
	const lines: string[] = []

	if (isCommand(router)) {
		const meta = router['~argc'].meta
		const input = router['~argc'].input
		const params = input ? extractOutputParamsDetailed(input) : []
		if (meta.description) pushDoc(lines, indent, meta.description)
		if (params.length > 0) {
			lines.push(
				`${indent}// ${appName} ${path.join(' ')} "${exampleInput(params)}"`,
			)
			lines.push(`${indent}${name}(input: { ${formatParams(params)} })`)
		} else {
			lines.push(`${indent}${name}()`)
		}
		return lines
	}

	if (isGroup(router)) {
		const meta = router['~argc.group'].meta
		if (meta.description) pushDoc(lines, indent, meta.description)
		lines.push(`${indent}${name}: {`)
		for (const [key, child] of Object.entries(router['~argc.group'].children)) {
			lines.push(
				...generateCommandSchema(
					appName,
					[...path, key],
					key,
					child,
					`${indent}  `,
				),
			)
		}
		lines.push(`${indent}}`)
		return lines
	}

	lines.push(`${indent}${name}: {`)
	for (const [key, child] of Object.entries(router)) {
		lines.push(
			...generateCommandSchema(
				appName,
				[...path, key],
				key,
				child,
				`${indent}  `,
			),
		)
	}
	lines.push(`${indent}}`)
	return lines
}

export function generateSchema(schema: Router, options: SchemaOptions): string {
	const lines: string[] = []
	if (options.description) lines.push(`// ${options.description}`)
	if (options.context) {
		lines.push(
			`// Context: ${getInputTypeHint(options.context)}  (--context / ARGC_CTX)`,
		)
	}
	if (lines.length > 0) lines.push('')
	lines.push(`type ${pascalCase(options.name)} = {`)

	const children = isGroup(schema)
		? schema['~argc.group'].children
		: isCommand(schema)
			? {}
			: schema

	for (const [key, child] of Object.entries(children)) {
		lines.push(...generateCommandSchema(options.name, [key], key, child, '  '))
	}
	lines.push('}')
	return lines.join('\n')
}

export function countSchemaCommands(schema: Router): number {
	if (isCommand(schema)) return 1
	return Object.values(getRouterChildren(schema)).reduce(
		(total, child) => total + countSchemaCommands(child),
		0,
	)
}

export function generateSchemaOutline(
	schema: Router,
	depth: number = 2,
): string[] {
	const lines: string[] = ['App']
	const walk = (
		router: Router,
		indent: string,
		remainingDepth: number,
	): number => {
		if (isCommand(router)) return 1
		let total = 0
		for (const [key, child] of Object.entries(getRouterChildren(router))) {
			const count = countSchemaCommands(child)
			total += count
			if (remainingDepth > 0) {
				lines.push(
					`${indent}${key}${isCommand(child) ? '' : `  ${count} commands`}`,
				)
				if (!isCommand(child)) walk(child, `${indent}  `, remainingDepth - 1)
			}
		}
		return total
	}
	walk(schema, '  ', depth)
	return lines
}

export function generateSchemaHintExample(schema: Router): string | null {
	const path = findDeepPath(schema, [], 1)
	return path ? path.join('.') : null
}

function findDeepPath(
	router: Router,
	path: string[],
	minDepth: number,
): string[] | null {
	if (path.length >= minDepth && !isCommand(router)) return path
	for (const [key, child] of Object.entries(getRouterChildren(router))) {
		const found = findDeepPath(child, [...path, key], minDepth)
		if (found) return found
	}
	return null
}
