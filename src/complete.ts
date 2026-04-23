import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { Router, Schema } from './types'

import { getRouterChildren } from './router'
import { extractInputParamsDetailed, type ParamInfo } from './schema'
import { isCommand, isGroup } from './types'

export type CompletionContext = {
	words: string[]
	current: number
}

export type SupportedShell = 'bash' | 'zsh' | 'fish'

function kebabCase(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function camelCase(str: string): string {
	return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function findByAlias(
	children: { [key: string]: Router },
	alias: string,
): Router | null {
	for (const [, router] of Object.entries(children)) {
		if (isCommand(router)) {
			if (router['~argc'].meta.aliases?.includes(alias)) return router
		}
	}
	return null
}

function walkRouter(router: Router, words: string[]): Router {
	let current = router
	let i = 0

	while (i < words.length) {
		const word = words[i]!

		if (word.startsWith('-')) {
			i++
			// Peek: if next word exists, doesn't start with -, and isn't a valid
			// child of the current router, treat it as the flag's value and skip it.
			if (
				i < words.length &&
				!words[i]!.startsWith('-') &&
				!isCommand(current)
			) {
				const children = getRouterChildren(current)
				const next = words[i]!
				if (!(next in children) && !findByAlias(children, next)) {
					i++
				}
			}
			continue
		}

		if (isCommand(current)) break

		const children = getRouterChildren(current)

		if (word in children) {
			current = children[word]!
			i++
			continue
		}

		const aliased = findByAlias(children, word)
		if (aliased) {
			current = aliased
			i++
			continue
		}

		break
	}

	return current
}

function extractEnumValues(typeStr: string): string[] {
	const parts = typeStr.split('|').map((p) => p.trim())
	const values: string[] = []
	for (const part of parts) {
		if (
			(part.startsWith('"') && part.endsWith('"')) ||
			(part.startsWith("'") && part.endsWith("'"))
		) {
			values.push(part.slice(1, -1))
		}
	}
	return values.length === parts.length ? values : []
}

function collectParams(
	router: Router,
	globals: Schema | undefined,
): ParamInfo[] {
	const params: ParamInfo[] = []

	if (isCommand(router) && router['~argc'].input) {
		const inputParams = extractInputParamsDetailed(router['~argc'].input)
		const argNames = new Set(
			(router['~argc'].args ?? []).map((a) =>
				a.name.endsWith('...') ? a.name.slice(0, -3) : a.name,
			),
		)
		for (const p of inputParams) {
			if (!argNames.has(p.name)) {
				params.push(p)
			}
		}
	}

	if (globals) {
		params.push(...extractInputParamsDetailed(globals))
	}

	return params
}

const BUILTIN_FLAGS = [
	'--help',
	'-h',
	'--version',
	'-v',
	'--schema',
	'--input',
	'--run',
	'--completions',
]

function getFlagCandidates(
	router: Router,
	globals: Schema | undefined,
): string[] {
	const flags = [...BUILTIN_FLAGS]
	const params = collectParams(router, globals)
	for (const p of params) {
		flags.push(`--${kebabCase(p.name)}`)
	}
	return flags
}

function filterByPrefix(candidates: string[], prefix: string): string[] {
	if (!prefix) return candidates
	return candidates.filter((c) => c.startsWith(prefix))
}

export function complete(
	router: Router,
	globals: Schema | undefined,
	ctx: CompletionContext,
): string[] {
	const { words, current } = ctx
	const currentWord =
		current >= 0 && current < words.length ? (words[current] ?? '') : ''
	const preceding = words.slice(0, Math.max(0, current))

	const resolved = walkRouter(router, preceding)

	// Check if previous word is a non-boolean flag expecting a value
	if (current > 0 && !currentWord.startsWith('-')) {
		const prevWord = words[current - 1]
		if (prevWord && prevWord.startsWith('--')) {
			const flagName = camelCase(prevWord.slice(2))
			const params = collectParams(resolved, globals)
			const param = params.find((p) => p.name === flagName)
			if (param && param.type !== 'boolean') {
				const enumValues = extractEnumValues(param.type)
				if (enumValues.length > 0) {
					return filterByPrefix(enumValues, currentWord)
				}
				return []
			}
		}
	}

	const candidates: string[] = []

	// Subcommands (if at router/group, not at command leaf)
	if (!isCommand(resolved)) {
		const children = getRouterChildren(resolved)
		for (const [name, child] of Object.entries(children)) {
			const hidden = isCommand(child)
				? child['~argc'].meta.hidden
				: isGroup(child)
					? child['~argc.group'].meta.hidden
					: false
			if (!hidden) {
				candidates.push(name)
				if (isCommand(child) && child['~argc'].meta.aliases) {
					candidates.push(...child['~argc'].meta.aliases)
				}
			}
		}
	}

	// Flags
	candidates.push(...getFlagCandidates(resolved, globals))

	return filterByPrefix(candidates, currentWord)
}

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function normalizeShellName(value: string): SupportedShell | null {
	const shell = basename(value.trim()).replace(/^-+/, '')
	if (shell === 'bash' || shell === 'zsh' || shell === 'fish') {
		return shell
	}
	return null
}

function detectParentShell(): SupportedShell | null {
	const proc = Bun.spawnSync({
		cmd: ['ps', '-p', String(process.ppid), '-o', 'comm='],
		stdout: 'pipe',
		stderr: 'ignore',
	})
	if (!proc.success) return null
	return normalizeShellName(new TextDecoder().decode(proc.stdout))
}

export function detectCurrentShell(): SupportedShell | null {
	return detectParentShell() ?? normalizeShellName(process.env.SHELL ?? '')
}

export function getCompletionInstallPath(
	shell: SupportedShell,
	programName: string,
): string | null {
	const home = process.env.HOME
	if (!home) return null

	switch (shell) {
		case 'bash':
			return join(
				home,
				'.local',
				'share',
				'bash-completion',
				'completions',
				programName,
			)
		case 'zsh':
			return join(home, '.zfunc', `_${programName}`)
		case 'fish':
			return join(home, '.config', 'fish', 'completions', `${programName}.fish`)
	}
}

export async function installCompletionScript(
	shell: SupportedShell,
	programName: string,
): Promise<string> {
	const script = generateCompletionScript(shell, programName)
	const path = getCompletionInstallPath(shell, programName)
	if (!script || !path) {
		throw new Error('Unable to resolve completion install path')
	}

	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${script}\n`)
	return path
}

export function getCompletionReloadHint(
	shell: SupportedShell,
	path: string,
): string {
	// A child process cannot source into the parent shell, so the best we can do
	// is install to the standard autoload path and print the exact reload command.
	switch (shell) {
		case 'fish':
			return `Current shell: run 'source ${path}' if the new completions do not appear immediately.`
		case 'zsh':
			return `Current shell: run 'source ${path}', or start a new shell if '${dirname(path)}' is already in $fpath.`
		case 'bash':
			return `Current shell: run 'source ${path}', or start a new shell.`
	}
}

export function generateCompletionScript(
	shell: string,
	programName: string,
): string | null {
	switch (shell) {
		case 'bash':
			return generateBashScript(programName)
		case 'zsh':
			return generateZshScript(programName)
		case 'fish':
			return generateFishScript(programName)
		default:
			return null
	}
}

function generateBashScript(name: string): string {
	const fn = sanitizeName(name)
	return `# bash completion for ${name}
_${fn}_completions() {
  local IFS=$'\\n'
  COMPREPLY=($(${name} --_complete "$((COMP_CWORD - 1))" -- "\${COMP_WORDS[@]:1}"))
}
complete -o default -F _${fn}_completions ${name}`
}

function generateZshScript(name: string): string {
	const fn = sanitizeName(name)
	return `# zsh completion for ${name}
_${fn}() {
  local -a completions
  completions=("\${(@f)$(${name} --_complete "$((CURRENT - 2))" -- "\${words[@]:1}")}")
  compadd -a completions
}
compdef _${fn} ${name}`
}

function generateFishScript(name: string): string {
	const fn = sanitizeName(name)
	return `# fish completion for ${name}
function __${fn}_complete
  set -l tokens (commandline -opc)
  set -e tokens[1]
  set -l cur (commandline -ct)
  if test -z "$cur"
    command ${name} --_complete (count $tokens) -- $tokens "" 2>/dev/null
  else
    # fish keeps the current token separate from -opc, so pass it explicitly.
    command ${name} --_complete (count $tokens) -- $tokens $cur 2>/dev/null
  end
end
complete -c ${name} -f -a '(__${fn}_complete)'`
}
