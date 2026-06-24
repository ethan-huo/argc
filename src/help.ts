import { stringify } from 'yaml'

import type { AnyCommand, Router, Schema } from './types'

import { getRouterChildren } from './router'
import {
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
	// help is a content section (YAML block scalar) = free text, so write it as a
	// small markdown doc, not a fake column-aligned card. Discovery-first: the
	// cold-start next step is @schema, so lead with it.
	const n = options.name
	const help = [
		'New here? Print the typed API first — it lists every command and its input type:',
		`\`${n} @schema\`  ·  narrow with \`${n} @schema .<namespace>\``,
		'',
		'Call a command by its dotted path, passing one quoted JSON5 object:',
		`\`${n} <path> "<json5>"\` — input may also be \`@file\`, \`-\` (stdin), or omitted (\`{}\`)`,
		'',
		'- `--context "<json5>"` — cross-cutting config (or `ARGC_CTX`)',
		'- `@run "<code>"` — run TypeScript against the typed API',
		'- `@schema` selectors: `.name` `."key"` `.*` `.{a,b}` `..name`',
	].join('\n')
	const output: Record<string, unknown> = {
		program,
		help,
		// join → multi-line string → YAML renders a |- block scalar, so the inner
		// quotes stay verbatim instead of a seq of escaped \" strings.
		examples: buildSurfaceExamples(schema, options).join('\n'),
	}
	if (options.context) {
		output.context = [
			`type Context = ${getInputTypeHint(options.context)}`,
			'pass via  --context "<json5>"  or  ARGC_CTX',
		].join('\n')
	}
	process.stdout.write(stringify(output, { lineWidth: 0 }))
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
	if (field.kind === 'array') return `--${field.name} <value>  # repeatable`
	return `--${field.name} <value>`
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
	const usageParts = [
		options.name,
		commandPath.join('.'),
		...positionals.map((name) => `<${name}>`),
	]
	const output: Record<string, unknown> = {
		usage: usageParts.join(' '),
	}
	if (positionals.length > 0) output.positionals = positionals.join('\n')
	if (fields.length > 0) {
		output.flags = fields.map((field) => flagUsage(field)).join('\n')
	}
	process.stdout.write(stringify(output, { lineWidth: 0 }))
}
