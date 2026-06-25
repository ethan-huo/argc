import type { AnyCommand, Router, Schema } from './types'

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

export type FieldKind =
	| 'string'
	| 'number'
	| 'integer'
	| 'boolean'
	| 'array'
	| 'object'
	| 'unknown'

export type FieldDescriptor = {
	name: string
	required: boolean
	kind: FieldKind
	item?: FieldDescriptor
	enum?: unknown[]
	default?: unknown
	description?: string
	rawSchema: JSONSchema
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function isValidIdentifier(name: string): boolean {
	return IDENTIFIER_RE.test(name)
}

function formatPropertyKey(name: string): string {
	return isValidIdentifier(name) ? name : JSON.stringify(name)
}

function formatExamplePropertyKey(name: string): string {
	return isValidIdentifier(name) ? name : `'${name.replaceAll("'", "\\'")}'`
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

function fieldKindFromJsonSchema(schema: JSONSchema): FieldKind {
	const type = schema.type
	if (type === 'string') return 'string'
	if (type === 'number') return 'number'
	if (type === 'integer') return 'integer'
	if (type === 'boolean') return 'boolean'
	if (type === 'array') return 'array'
	if (type === 'object') return 'object'
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		const types = new Set(schema.enum.map((value) => typeof value))
		if (types.size === 1) {
			const [only] = [...types]
			if (only === 'string') return 'string'
			if (only === 'number') return 'number'
			if (only === 'boolean') return 'boolean'
		}
	}
	if (schema.properties) return 'object'
	return 'unknown'
}

function buildFieldDescriptor(
	name: string,
	schema: JSONSchema,
	required: boolean,
): FieldDescriptor {
	const descriptor: FieldDescriptor = {
		name,
		required,
		kind: fieldKindFromJsonSchema(schema),
		rawSchema: schema,
	}
	if (Array.isArray(schema.enum)) descriptor.enum = schema.enum
	if (schema.default !== undefined) descriptor.default = schema.default
	if (schema.description !== undefined)
		descriptor.description = schema.description as string
	if (descriptor.kind === 'array') {
		const itemSchema = schema.items as JSONSchema | undefined
		if (itemSchema) {
			descriptor.item = buildFieldDescriptor(`${name}[]`, itemSchema, true)
		}
	}
	return descriptor
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

export function extractInputFieldDescriptors(
	schema: Schema | undefined,
): FieldDescriptor[] {
	if (!schema) return []
	const jsonSchema = readJsonSchema(schema, 'input')
	if (!jsonSchema) return []
	const properties = jsonSchema.properties as
		| Record<string, JSONSchema>
		| undefined
	if (!properties) return []
	const required = new Set((jsonSchema.required as string[]) ?? [])
	return Object.entries(properties).map(([name, prop]) =>
		buildFieldDescriptor(name, prop, required.has(name)),
	)
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
	if (type.startsWith('"') && type.endsWith('"')) {
		try {
			const value = JSON.parse(type) as string
			return `'${value.replaceAll("'", "\\'")}'`
		} catch {
			return "'value'"
		}
	}
	if (type.startsWith("'") && type.endsWith("'")) return type
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
			(param) =>
				`${formatExamplePropertyKey(param.name)}: ${sampleValue(param.type)}`,
		)
		.join(', ')} }`
}

function pushDoc(lines: string[], indent: string, text: string): void {
	lines.push(`${indent}/** ${normalizeDocText(text)} */`)
}

function normalizeDocText(text: string): string {
	return text.replaceAll('*/', '* /')
}

function pushCommandDoc(
	lines: string[],
	indent: string,
	description: string | undefined,
	example: string | undefined,
): void {
	const desc = description ? normalizeDocText(description) : undefined
	const sample = example ? normalizeDocText(example) : undefined
	if (!desc && !sample) return
	if (desc && !sample) {
		lines.push(`${indent}/** ${desc} */`)
		return
	}
	lines.push(`${indent}/**`)
	if (desc) {
		lines.push(`${indent} * ${desc}`)
		lines.push(`${indent} *`)
	}
	lines.push(`${indent} * @example`)
	lines.push(`${indent} * ${sample}`)
	lines.push(`${indent} */`)
}

function getCommandInputExample(router: Router): string {
	if (!isCommand(router)) return '{}'
	const input = router['~argc'].input
	const params = input ? extractOutputParamsDetailed(input) : []
	return exampleInput(params)
}

export function buildCommandInputExample(command: AnyCommand): string {
	return getCommandInputExample(command)
}

function findFirstCommand(
	router: Router,
	path: string[] = [],
): { path: string[]; router: Router } | null {
	if (isCommand(router)) return { path, router }
	for (const [key, child] of Object.entries(getRouterChildren(router))) {
		const found = findFirstCommand(child, [...path, key])
		if (found) return found
	}
	return null
}

function findFirstNamespace(
	router: Router,
	path: string[] = [],
): string[] | null {
	if (isCommand(router)) return null
	if (path.length > 0) return path
	for (const [key, child] of Object.entries(getRouterChildren(router))) {
		const found = findFirstNamespace(child, [...path, key])
		if (found) return found
	}
	return null
}

export function buildSurfaceExamples(
	schema: Router,
	options: SchemaOptions,
): string[] {
	const command = findFirstCommand(schema)
	const namespace = findFirstNamespace(schema)
	if (!command) {
		return [`${options.name} @schema`]
	}
	const dottedPath = command.path.join('.')
	const input = getCommandInputExample(command.router)
	const direct = `${options.name} ${dottedPath} "${input}"`
	const examples = [direct]
	examples.push(
		[
			`${options.name} @run - --json <<'JS'`,
			'await Promise.all([',
			`  ${dottedPath}(${input}),`,
			`  ${dottedPath}(${input}),`,
			'])',
			'JS',
		].join('\n'),
	)
	examples.push(
		`${options.name} @schema ${
			namespace ? `.${namespace.join('.')}` : `.${dottedPath}`
		}`,
	)
	return examples
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
		const example =
			params.length > 0
				? `${appName} ${path.join('.')} "${exampleInput(params)}"`
				: undefined
		pushCommandDoc(lines, indent, meta.description, example)
		if (params.length > 0) {
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
	// Body only: the typed API. Tool name, call tutorial, and context live in the
	// OKF frontmatter the @schema handler wraps around this — no logic to repeat
	// the tool's identity inside its own API surface.
	const lines: string[] = [`type ${pascalCase(options.name)} = {`]

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

// One flat line per top-level namespace: `name{child1,child2,...}` (v6 format).
// Not an indented tree — that is unparseable noise and was never the rendering.
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

function renderOutlineNode(
	name: string,
	router: Router,
	depth: number,
): string {
	if (depth <= 0) return name
	if (isCommand(router)) return name
	const children = getRouterChildren(router)
	const parts = Object.entries(children).map(([childName, child]) =>
		renderOutlineNode(childName, child, depth - 1),
	)
	if (parts.length === 0) return `${name}{}`
	return `${name}{${parts.join(',')}}`
}

// Concrete deep path (e.g. `posthog.switch-organization`), not just a top key —
// a runnable next step beats a bare namespace name.
export function generateSchemaHintExample(schema: Router): string | null {
	const entries = Object.entries(getRouterChildren(schema))
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

function findDeepPath(
	router: Router,
	path: string[],
	minDepth: number,
): string[] | null {
	if (minDepth <= 1) return path
	if (isCommand(router)) return null
	for (const [name, child] of Object.entries(getRouterChildren(router))) {
		const found = findDeepPath(child, [...path, name], minDepth - 1)
		if (found) return found
	}
	return null
}
