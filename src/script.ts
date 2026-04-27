import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { HookDispatcher } from './hook'
import type { parseArgv } from './parser'
import type { Router, Schema } from './types'

import { showValidationError } from './help'
import { getRouterChildren, findHandler } from './router'
import { fmt as colors } from './terminal'
import { isCommand } from './types'

export function expandHome(path: string): string {
	if (path.startsWith('~/')) {
		const home = process.env.HOME
		if (!home) return path
		return `${home}${path.slice(1)}`
	}
	return path
}

export async function readStdin(): Promise<string> {
	return await new Response(Bun.stdin).text()
}

export function formatRuntimeError(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message || String(error)
		const prefix =
			error.name && error.name !== 'Error' && !msg.startsWith(`${error.name}:`)
				? `${error.name}: `
				: ''
		return `${prefix}${msg}`
	}
	return String(error)
}

type ScriptFn = (input?: unknown) => Promise<unknown>
type ScriptHandlers = ScriptFn | { [key: string]: ScriptHandlers }

type ScriptAPI = {
	handlers: ScriptHandlers
	call: Record<string, ScriptFn>
	globals: unknown
	args: string[]
	raw: string[]
}

type RunSource =
	| { kind: 'stdin' }
	| { kind: 'inline'; code: string }
	| { kind: 'module'; path: string }

const BUILTIN_FLAG_KEYS = new Set([
	'help',
	'h',
	'version',
	'v',
	'schema',
	'input',
	'run',
	'completions',
	'_complete',
])

function stripBuiltinFlags(
	flags: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(flags)) {
		if (BUILTIN_FLAG_KEYS.has(k)) continue
		out[k] = v
	}
	return out
}

function flattenHandlerTree(
	handlers: ScriptHandlers,
): Record<string, ScriptFn> {
	const out: Record<string, ScriptFn> = {}
	const walk = (node: ScriptHandlers, prefix: string): void => {
		if (typeof node === 'function') {
			out[prefix] = node as ScriptFn
			return
		}
		for (const [k, v] of Object.entries(node)) {
			walk(v, prefix ? `${prefix}.${k}` : k)
		}
	}
	walk(handlers, '')
	return out
}

function parseRunSource(flag: unknown): RunSource {
	if (flag === true || flag === '-') return { kind: 'stdin' }
	if (typeof flag === 'string') {
		if (flag.startsWith('@')) {
			const path = flag.slice(1)
			if (!path) {
				console.log(
					colors.error('Invalid --run value (expected @<file> after @)'),
				)
				process.exit(1)
			}
			return { kind: 'module', path }
		}
		return { kind: 'inline', code: flag }
	}
	console.log(
		colors.error('Invalid --run value (expected code, -, stdin, or @<file>)'),
	)
	process.exit(1)
}

async function runEval(code: string, api: ScriptAPI): Promise<void> {
	const fn = new Function(
		'argc',
		`"use strict"; return (async () => {\n${code}\n})();`,
	) as (argc: ScriptAPI) => Promise<unknown>
	await fn(api)
}

async function runScriptFile(path: string, api: ScriptAPI): Promise<void> {
	const expanded = expandHome(path)
	const fullPath = resolvePath(process.cwd(), expanded)
	const url = pathToFileURL(fullPath).href

	const mod = (await import(url)) as Record<string, unknown>
	const maybeDefault = mod.default
	if (typeof maybeDefault === 'function') {
		await (maybeDefault as (argc: ScriptAPI) => unknown)(api)
		return
	}
	const maybeMain = mod.main
	if (typeof maybeMain === 'function') {
		await (maybeMain as (argc: ScriptAPI) => unknown)(api)
		return
	}

	throw new Error('--run @file module must export default or main')
}

function buildScriptHandlerTree(
	path: string[],
	router: Router,
	handlers: Record<string, unknown>,
	getContext: () => Promise<unknown>,
	rawArgv: string[],
	appName: string,
	hookDispatcher: HookDispatcher,
): ScriptHandlers {
	if (isCommand(router)) {
		const command = router
		const handler = findHandler(path, handlers)
		const commandName = path.join(' ')

		return (async (input?: unknown) => {
			if (!handler) {
				throw new Error(`No handler for command: ${commandName}`)
			}

			const providedInput =
				input === undefined ? ({} as Record<string, unknown>) : input

			let validatedInput = providedInput
			const def = command['~argc']
			if (def.input) {
				const result = await def.input['~standard'].validate(providedInput)
				if (result.issues) {
					const errorFields = new Set<string>()
					const errorMessages: Record<string, string> = {}
					for (const issue of result.issues) {
						const field = issue.path
							?.map((p: { key: PropertyKey } | PropertyKey) =>
								typeof p === 'object' ? p.key : p,
							)
							?.join('.')
						if (field) {
							errorFields.add(field)
							errorMessages[field] = issue.message
						}
					}

					console.error(colors.error('invalid arguments'))
					console.error()
					showValidationError(
						appName,
						path,
						command,
						errorFields,
						errorMessages,
					)
					process.exit(1)
				}
				validatedInput = result.value as Record<string, unknown>
			}

			const hookCall = hookDispatcher.createCall(path, commandName)
			let ok = false
			try {
				const context = await getContext()
				const result = await handler({
					input: validatedInput,
					context,
					meta: {
						path,
						command: commandName,
						raw: rawArgv,
						callId: hookCall.callId,
					},
					emit: hookCall.emit,
				})
				ok = true
				return result
			} catch (error) {
				hookCall.error(error)
				throw error
			} finally {
				hookCall.end(ok)
			}
		}) as ScriptHandlers
	}

	const out: Record<string, ScriptHandlers> = {}
	for (const [key, child] of Object.entries(getRouterChildren(router))) {
		out[key] = buildScriptHandlerTree(
			[...path, key],
			child,
			handlers,
			getContext,
			rawArgv,
			appName,
			hookDispatcher,
		)
	}
	return out
}

function buildScriptApi(
	router: Router,
	handlers: Record<string, unknown>,
	getContext: () => Promise<unknown>,
	rawArgv: string[],
	globals: unknown,
	args: string[],
	appName: string,
	hookDispatcher: HookDispatcher,
): ScriptAPI {
	const handlerTree = buildScriptHandlerTree(
		[],
		router,
		handlers,
		getContext,
		rawArgv,
		appName,
		hookDispatcher,
	)
	const call = flattenHandlerTree(handlerTree)
	return { handlers: handlerTree, call, globals, args, raw: rawArgv }
}

export async function runScriptMode(
	schema: Router,
	options: {
		globals?: Schema
		context?: (globals: unknown) => unknown | Promise<unknown>
	},
	handlers: Record<string, unknown>,
	parsed: ReturnType<typeof parseArgv>,
	appName: string,
	hookDispatcher: HookDispatcher,
): Promise<void> {
	const flagsWithoutBuiltins = stripBuiltinFlags(parsed.flags)

	// Parse + validate globals (same behavior as normal mode)
	let globals: unknown = flagsWithoutBuiltins
	if (options.globals) {
		const result =
			await options.globals['~standard'].validate(flagsWithoutBuiltins)
		if (result.issues) {
			console.error(colors.error('Global options validation failed'))
			for (const issue of result.issues) {
				const path = issue.path
					?.map((p: { key: PropertyKey } | PropertyKey) =>
						typeof p === 'object' ? p.key : p,
					)
					?.join('.')
				console.error(
					`  ${path ? `${colors.option(path)}: ` : ''}${issue.message}`,
				)
			}
			process.exit(1)
		}
		globals = result.value
	}

	let contextPromise: Promise<unknown> | null = null
	const getContext = async (): Promise<unknown> => {
		if (!options.context) return undefined
		if (!contextPromise)
			contextPromise = Promise.resolve(options.context(globals))
		return await contextPromise
	}

	const api = buildScriptApi(
		schema,
		handlers,
		getContext,
		parsed.raw,
		globals,
		parsed.positionals,
		appName,
		hookDispatcher,
	)

	let shouldExit = false
	try {
		if (parsed.flags.run !== undefined) {
			const source = parseRunSource(parsed.flags.run)
			if (source.kind === 'stdin') {
				await runEval(await readStdin(), api)
				return
			}
			if (source.kind === 'inline') {
				await runEval(source.code, api)
				return
			}
			await runScriptFile(source.path, api)
			return
		}
	} catch (error) {
		console.error(colors.error(formatRuntimeError(error)))
		shouldExit = true
	} finally {
		await hookDispatcher.drain()
	}

	if (shouldExit) {
		process.exit(1)
	}
}
