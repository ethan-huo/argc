export const BUILTIN_COMMANDS = ['@run', '@schema', '@completions'] as const

const BUILTIN_COMMAND_SET = new Set<string>(BUILTIN_COMMANDS)

export function isBuiltinCommand(name: string | undefined): boolean {
	return name !== undefined && BUILTIN_COMMAND_SET.has(name)
}
