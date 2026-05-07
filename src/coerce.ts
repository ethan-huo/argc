import type { Schema } from './types'

type JSONSchema = Record<string, unknown>

export function coerceCliInput(
	schema: Schema | undefined,
	input: Record<string, unknown>,
): Record<string, unknown> {
	if (!schema) return input

	const jsonSchema = readInputJsonSchema(schema)
	if (!jsonSchema) return input

	const coerced = coerceValue(input, jsonSchema)
	if (isRecord(coerced)) return coerced
	return input
}

function readInputJsonSchema(schema: Schema): JSONSchema | null {
	try {
		return schema['~standard'].jsonSchema.input({ target: 'draft-07' })
	} catch {
		return null
	}
}

function coerceValue(value: unknown, schema: JSONSchema): unknown {
	const type = schema.type
	if (typeof type !== 'string') return value

	switch (type) {
		case 'string':
			return value
		case 'number':
			return coerceNumber(value, false)
		case 'integer':
			return coerceNumber(value, true)
		case 'boolean':
			return coerceBoolean(value)
		case 'array':
			return coerceArray(value, schema)
		case 'object':
			return coerceObject(value, schema)
		default:
			return value
	}
}

function coerceNumber(value: unknown, integer: boolean): unknown {
	if (typeof value !== 'string') return value

	const trimmed = value.trim()
	if (trimmed === '') return value

	const parsed = Number(trimmed)
	if (Number.isNaN(parsed)) return value
	if (integer && !Number.isInteger(parsed)) return value
	return parsed
}

function coerceBoolean(value: unknown): unknown {
	if (typeof value !== 'string') return value

	const normalized = value.trim().toLowerCase()
	if (normalized === 'true') return true
	if (normalized === 'false') return false
	return value
}

function coerceArray(value: unknown, schema: JSONSchema): unknown {
	const items = schema.items
	if (!isRecord(items)) return value

	const values = Array.isArray(value) ? value : [value]
	return values.map((item) => coerceValue(item, items))
}

function coerceObject(value: unknown, schema: JSONSchema): unknown {
	if (!isRecord(value)) return value

	const properties = schema.properties
	if (!isRecord(properties)) return value

	const output: Record<string, unknown> = { ...value }
	for (const [key, propertySchema] of Object.entries(properties)) {
		if (!(key in output) || !isRecord(propertySchema)) continue
		output[key] = coerceValue(output[key], propertySchema)
	}
	return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
