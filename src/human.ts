import type { AnyCommand } from './types'

import { parseInputSource, type InputSource } from './parser'
import { ArgcError } from './render'
import {
	extractInputFieldDescriptors,
	type FieldDescriptor,
	type FieldKind,
} from './schema'

export type HumanParseResult = {
	input: Record<string, unknown>
	context?: InputSource
}

type HumanParseOptions = {
	commandPath: string[]
	appName: string
}

type FieldIndex = Map<string, FieldDescriptor>

function isNumericString(value: string): boolean {
	return /^[-+]?(?:\d+|\d*\.\d+)(?:e[-+]?\d+)?$/i.test(value)
}

function coerceScalar(value: string, kind: FieldKind): unknown {
	if ((kind === 'number' || kind === 'integer') && isNumericString(value)) {
		return Number(value)
	}
	if (kind === 'boolean') {
		if (value === 'true') return true
		if (value === 'false') return false
	}
	return value
}

function coerceValue(value: string, field: FieldDescriptor): unknown {
	if (field.kind === 'array') {
		return coerceScalar(value, field.item?.kind ?? 'unknown')
	}
	return coerceScalar(value, field.kind)
}

function setField(
	input: Record<string, unknown>,
	field: FieldDescriptor,
	value: unknown,
): void {
	if (field.kind !== 'array') {
		input[field.name] = value
		return
	}
	const current = input[field.name]
	if (Array.isArray(current)) {
		current.push(value)
		return
	}
	input[field.name] = [value]
}

function helpHint(options: HumanParseOptions): string {
	return `${options.appName} ${options.commandPath.join('.')} --help`
}

function unknownFlag(options: HumanParseOptions, name: string): never {
	throw new ArgcError({
		error: 'INVALID_INPUT',
		command: options.commandPath.join('.'),
		issues: [{ at: name, message: 'unknown flag' }],
		$hint: helpHint(options),
	})
}

function missingFlagValue(options: HumanParseOptions, name: string): never {
	throw new ArgcError({
		error: 'INVALID_INPUT',
		command: options.commandPath.join('.'),
		issues: [{ at: name, message: 'missing flag value' }],
		$hint: helpHint(options),
	})
}

function addPositional(
	input: Record<string, unknown>,
	positionals: string[],
	fields: FieldIndex,
	index: number,
	value: string,
	options: HumanParseOptions,
): number {
	const name = positionals[index]
	if (!name) {
		throw new ArgcError({
			error: 'INVALID_INPUT',
			command: options.commandPath.join('.'),
			issues: [{ message: `unexpected positional: ${value}` }],
			$hint: helpHint(options),
		})
	}
	const field = fields.get(name)
	if (!field) {
		throw new ArgcError({
			error: 'INVALID_INPUT',
			command: options.commandPath.join('.'),
			issues: [{ at: name, message: 'unknown positional field' }],
		})
	}
	setField(input, field, coerceValue(value, field))
	return index + 1
}

function splitFlag(token: string): { name: string; value?: string } {
	const body = token.slice(2)
	const equals = body.indexOf('=')
	if (equals === -1) return { name: body }
	return {
		name: body.slice(0, equals),
		value: body.slice(equals + 1),
	}
}

export function parseHumanArgs(
	command: AnyCommand,
	argv: string[],
	options: HumanParseOptions,
): HumanParseResult {
	const fields = new Map(
		extractInputFieldDescriptors(command['~argc'].input).map((field) => [
			field.name,
			field,
		]),
	)
	const input: Record<string, unknown> = {}
	const positionals = command['~argc'].positionals
	let positionalIndex = 0
	let context: InputSource | undefined

	for (let index = 0; index < argv.length; index++) {
		const token = argv[index]!
		if (token === '--context') {
			index++
			if (index >= argv.length) {
				throw new ArgcError({
					error: 'BAD_INPUT_JSON',
					detail: 'missing value after --context',
				})
			}
			context = parseInputSource(argv[index]!)
			continue
		}
		if (token === '--help' || token === '-h') {
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: '--help must be handled before human parsing',
			})
		}
		if (token.startsWith('--')) {
			const flag = splitFlag(token)
			const field = fields.get(flag.name)
			if (!field) unknownFlag(options, flag.name)
			if (field.kind === 'boolean' && flag.value === undefined) {
				setField(input, field, true)
				continue
			}
			let value = flag.value
			if (value === undefined) {
				index++
				if (index >= argv.length) missingFlagValue(options, flag.name)
				value = argv[index]!
				if (value.startsWith('--')) missingFlagValue(options, flag.name)
			}
			setField(input, field, coerceValue(value, field))
			continue
		}
		if (token.startsWith('{') || token.startsWith('@') || token === '-') {
			throw new ArgcError({
				error: 'TWO_INPUTS',
				$hint: 'input forms cannot be mixed with object, file, or stdin input',
			})
		}
		positionalIndex = addPositional(
			input,
			positionals,
			fields,
			positionalIndex,
			token,
			options,
		)
	}

	return { input, context }
}
