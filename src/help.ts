import type { Router, Schema } from './types'

import { getRouterChildren } from './router'
import { getInputTypeHint } from './schema'
import { isCommand, isGroup } from './types'

export function showHelp(options: {
	name: string
	version: string
	description?: string
	context?: Schema
}): void {
	const { name, description } = options
	const lines: string[] = []
	lines.push(`${name}${description ? ` — ${description}` : ''}`)
	lines.push('')
	lines.push('CALL')
	lines.push(`  ${name} <path> [<input>]                 run a command`)
	if (options.context) {
		lines.push(
			`  ${name} <path> [<input>] --context <obj> with cross-cutting context`,
		)
	}
	lines.push(
		`  ${name} @run '<code>'                    run code against the typed API`,
	)
	lines.push(`  ${name} @schema [.selector]              print the typed API`)
	lines.push('')
	lines.push(
		'INPUT   one quoted JSON5 token · @file · - (stdin) · omitted = {}',
	)
	lines.push(`        ${name} user create "{ name: 'alice' }"`)
	lines.push(`        ${name} db seed @payload.json`)
	if (options.context) {
		lines.push('')
		lines.push('CONTEXT  --context <obj>  or  ARGC_CTX env')
		lines.push(`  type Context = ${getInputTypeHint(options.context)}`)
	}
	lines.push('')
	lines.push(`EXPLORE  ${name} @schema            whole API`)
	lines.push(`         ${name} @schema .user      one namespace`)
	lines.push(`         ${name} @schema ..create   recursive search`)
	lines.push('  selector: .name  ."key"  .*  .{a,b}  ..name')
	lines.push('')
	lines.push('built-ins  @run  @schema  @completions   ·   --help  --version')
	process.stdout.write(`${lines.join('\n')}\n`)
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
