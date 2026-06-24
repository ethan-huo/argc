import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import type { Router } from './types'

import { getRouterChildren } from './router'
import { isCommand, isGroup } from './types'

export type CompletionContext = {
	words: string[]
	current: number
}

export type SupportedShell = 'bash' | 'zsh' | 'fish'

function filterByPrefix(candidates: string[], prefix: string): string[] {
	if (!prefix) return candidates
	return candidates.filter((candidate) => candidate.startsWith(prefix))
}

function collectPaths(
	router: Router,
	prefix: string[] = [],
	out: string[] = [],
): string[] {
	if (prefix.length > 0) out.push(prefix.join('.'))
	if (isCommand(router)) return out
	for (const [name, child] of Object.entries(getRouterChildren(router))) {
		const hidden = isCommand(child)
			? child['~argc'].meta.hidden
			: isGroup(child)
				? child['~argc.group'].meta.hidden
				: false
		if (!hidden) collectPaths(child, [...prefix, name], out)
	}
	return out
}

export function complete(router: Router, ctx: CompletionContext): string[] {
	const { words, current } = ctx
	const currentWord =
		current >= 0 && current < words.length ? (words[current] ?? '') : ''
	const preceding = words.slice(0, Math.max(0, current))

	if (preceding.length === 0 && currentWord.startsWith('@')) {
		return filterByPrefix(['@run', '@schema', '@completions'], currentWord)
	}

	const candidates = preceding.length === 0 ? collectPaths(router) : []
	if (preceding.length === 0) candidates.push('@run', '@schema', '@completions')
	return filterByPrefix(candidates, currentWord)
}

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

function normalizeShellName(value: string): SupportedShell | null {
	const shell = basename(value.trim()).replace(/^-+/, '')
	if (shell === 'bash' || shell === 'zsh' || shell === 'fish') return shell
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
	if (!script || !path)
		throw new Error('Unable to resolve completion install path')
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${script}\n`)
	return path
}

export function getCompletionReloadHint(
	shell: SupportedShell,
	path: string,
): string {
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
complete -c ${name} -e

function __${fn}_complete
  set -l tokens (commandline -opc)
  set -e tokens[1]
  set -l cur (commandline -ct)
  if test -z "$cur"
    command ${name} --_complete (count $tokens) -- $tokens "" 2>/dev/null
  else
    command ${name} --_complete (count $tokens) -- $tokens $cur 2>/dev/null
  end
end
complete -c ${name} -f -a '(__${fn}_complete)'`
}
