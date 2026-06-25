import type { AnyCommand, Router, Schema } from './types'

import { renderOkfMarkdown } from './markup'
import { getRouterChildren } from './router'
import {
	buildCommandInputExample,
	buildSurfaceExamples,
	extractInputFieldDescriptors,
	getInputTypeHint,
	type FieldDescriptor,
} from './schema'
import { isCommand, isGroup } from './types'

export function showHelp(
	schema: Router,
	options: {
		name: string
		version: string
		description?: string
		context?: Schema
	},
): void {
	const program = options.description
		? `${options.name} — ${options.description}`
		: options.name
	const n = options.name
	const body = [
		'## Usage',
		'',
		'Call any command by its dotted path, passing one quoted object literal — the same',
		'`{ ... }` you would write inside `@run`:',
		'',
		`${n} <path> "<object>"`,
		'',
		'Values must be literals; to compute or compose inputs, use `@run`. Input may also come from',
		'a file (`@payload.json`), from stdin (`-`), or be omitted (it defaults to `{}`).',
		'Cross-cutting config goes through `--context "<object>"` or the `ARGC_CTX` environment variable.',
		'',
		'## Schema',
		'',
		`\`${n} @schema\` prints the typed API — every command and the exact shape of its input.`,
		`Append a selector to focus on one area, e.g. \`${n} @schema .<namespace>\`.`,
		'',
		'## Examples',
		'',
		...buildSurfaceExamples(schema, options),
	].join('\n')
	const frontmatter: Record<string, unknown> = {
		program,
		version: options.version,
	}
	if (options.context) {
		frontmatter.context = [
			`type Context = ${getInputTypeHint(options.context)}`,
			'pass via --context "<object>" or ARGC_CTX',
		].join('; ')
	}
	process.stdout.write(renderOkfMarkdown(frontmatter, body))
}

export function renderNamespaceCommands(
	router: Router,
	prefix: string[],
): string[] {
	const lines: string[] = []
	for (const [key, value] of Object.entries(getRouterChildren(router))) {
		const hidden = isCommand(value)
			? value['~argc'].meta.hidden
			: isGroup(value)
				? value['~argc.group'].meta.hidden
				: false
		if (!hidden) lines.push([...prefix, key].join('.'))
	}
	return lines
}

function flagUsage(field: FieldDescriptor): string {
	if (field.kind === 'boolean') return `--${field.name}[=true|false]`
	if (field.kind === 'array') return `--${field.name} <value>`
	return `--${field.name} <value>`
}

function fieldDescription(field: FieldDescriptor): string {
	if (field.description) return field.description
	if (field.kind === 'array') return 'repeatable; pass once per value'
	if (field.kind === 'boolean')
		return `boolean; bare --${field.name} is true, --${field.name}=false is false`
	return 'value'
}

export function showCommandHelp(
	command: AnyCommand,
	commandPath: string[],
	options: {
		name: string
	},
): void {
	const fields = extractInputFieldDescriptors(command['~argc'].input)
	const positionals = command['~argc'].positionals
	const positionalSet = new Set(positionals)
	const optionFields = fields.filter((field) => !positionalSet.has(field.name))
	const usageParts = [
		options.name,
		commandPath.join('.'),
		...positionals.map((name) => `<${name}>`),
	]
	if (optionFields.length > 0) usageParts.push('[options]')
	const frontmatter: Record<string, unknown> = {
		command: `${options.name} ${commandPath.join('.')}`,
	}
	const summary = command['~argc'].meta.description
	if (summary) frontmatter.summary = summary

	const body: string[] = ['## Usage', '', usageParts.join(' ')]
	if (positionals.length > 0) {
		body.push('', '## Arguments', '')
		for (const name of positionals) {
			const field = fields.find((entry) => entry.name === name)
			const description = field?.description ?? 'value'
			body.push(`- \`${name}\` — ${description}`)
		}
	}
	if (optionFields.length > 0) {
		body.push('', '## Options', '')
		for (const field of optionFields) {
			body.push(`- \`${flagUsage(field)}\` — ${fieldDescription(field)}`)
		}
	}
	body.push(
		'',
		'You can also pass the whole input as one object literal:',
		'',
		`${options.name} ${commandPath.join('.')} "${buildCommandInputExample(command)}"`,
	)
	process.stdout.write(renderOkfMarkdown(frontmatter, body.join('\n')))
}
