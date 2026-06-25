import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseSync } from 'oxc-parser'

import type { HookDispatcher } from './hook'
import type { ErrorIssue } from './render'
import type { Router, Schema } from './types'

import { ArgcError, renderResult, withStdoutRerouted } from './render'
import { getRouterChildren, findHandler } from './router'
import { extractCliInputParamsDetailed } from './schema'
import { isCommand } from './types'

export async function readStdin(): Promise<string> {
	return await new Response(Bun.stdin).text()
}

type ScriptFn = (input?: unknown) => Promise<unknown>
type ScriptHandlers = ScriptFn | { [key: string]: ScriptHandlers }

export type ScriptAPI = {
	handlers: ScriptHandlers
	call: Record<string, ScriptFn>
	context: unknown
	args: string[]
	raw: string[]
}

type RunSource =
	| { kind: 'stdin' }
	| { kind: 'inline'; code: string }
	| { kind: 'module'; path: string }

export type ScriptRunOptions = {
	source: RunSource
	json: boolean
	args: string[]
	raw: string[]
	context: unknown
	appName: string
}

function expandHome(path: string): string {
	if (path.startsWith('~/')) {
		const home = process.env.HOME
		if (!home) return path
		return `${home}${path.slice(1)}`
	}
	return path
}

export function parseRunSource(token: string | undefined): RunSource {
	if (token === undefined || token === '-') return { kind: 'stdin' }
	if (token.startsWith('@')) {
		const path = token.slice(1)
		if (!path) throw new Error('expected a file path after @')
		return { kind: 'module', path }
	}
	return { kind: 'inline', code: token }
}

function objectLiteralReturnBody(code: string): string | undefined {
	const trimmed = code.trim()
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined

	const wrapped = `(${code})`
	const parsed = parseSync('snippet.js', wrapped, { lang: 'js' })
	if (parsed.errors.length > 0) return undefined

	const statement = parsed.program.body.at(-1)
	if (statement?.type !== 'ExpressionStatement') return undefined
	let expression: { type: string; expression?: unknown } = statement.expression
	while (expression.type === 'ParenthesizedExpression') {
		expression = expression.expression as { type: string; expression?: unknown }
	}
	if (expression.type !== 'ObjectExpression') {
		return undefined
	}

	// Bare `{ ... }` parses as a block in statement position; @run users mean a result.
	return `return (${code})`
}

async function executeInlineBody(
	body: string,
	scope: Record<string, unknown>,
): Promise<unknown> {
	const AsyncFunction = (async () => {}).constructor as new (
		...args: string[]
	) => (...values: unknown[]) => Promise<unknown>
	const names = Object.keys(scope)
	const fn = new AsyncFunction(...names, body)
	return await fn(...names.map((name) => scope[name]))
}

function pathFromIssuePath(path: unknown): string | undefined {
	if (!Array.isArray(path)) return undefined
	return path
		.map((part) => {
			if (typeof part === 'object' && part !== null && 'key' in part) {
				return String((part as { key: PropertyKey }).key)
			}
			return String(part)
		})
		.filter(Boolean)
		.join('.')
}

function normalizeIssues(issues: unknown): ErrorIssue[] {
	if (!Array.isArray(issues)) return []
	return issues.map((issue) => {
		const record = issue as { path?: unknown; message?: unknown }
		const normalized: ErrorIssue = {
			message:
				typeof record.message === 'string' ? record.message : String(issue),
		}
		const at = pathFromIssuePath(record.path)
		if (at) normalized.at = at
		return normalized
	})
}

function unknownKeyIssues(
	input: Record<string, unknown>,
	schema: Schema | undefined,
): ErrorIssue[] {
	if (!schema)
		return Object.keys(input).map((key) => ({
			at: key,
			message: 'unknown key',
		}))
	const fields = new Set(
		extractCliInputParamsDetailed(schema).map((param) => param.name),
	)
	return Object.keys(input)
		.filter((key) => !fields.has(key))
		.map((key) => ({ at: key, message: 'unknown key' }))
}

async function validateInput(
	commandPath: string[],
	schema: Schema | undefined,
	input: unknown,
): Promise<unknown> {
	const objectInput =
		input === undefined ? ({} as Record<string, unknown>) : input
	if (
		objectInput === null ||
		typeof objectInput !== 'object' ||
		Array.isArray(objectInput)
	) {
		throw new ArgcError({
			error: 'INVALID_INPUT',
			command: commandPath.join('.'),
			issues: [{ message: 'input must be an object' }],
		})
	}

	const unknown = unknownKeyIssues(
		objectInput as Record<string, unknown>,
		schema,
	)
	let schemaIssues: ErrorIssue[] = []
	let value: unknown = objectInput
	if (schema) {
		const result = await schema['~standard'].validate(objectInput)
		if (result.issues) {
			schemaIssues = normalizeIssues(result.issues)
		} else {
			value = result.value
		}
	}
	const issues = [...schemaIssues, ...unknown]
	if (issues.length > 0) {
		throw new ArgcError({
			error: 'INVALID_INPUT',
			command: commandPath.join('.'),
			issues,
		})
	}
	return value
}

function buildScriptHandlerTree(
	path: string[],
	router: Router,
	handlers: Record<string, unknown>,
	context: unknown,
	rawArgv: string[],
	appName: string,
	hookDispatcher: HookDispatcher,
): ScriptHandlers {
	if (isCommand(router)) {
		const handler = findHandler(path, handlers)
		const commandName = path.join('.')
		return (async (input?: unknown) => {
			if (!handler) throw new Error(`No handler for command: ${commandName}`)
			const validatedInput = await validateInput(
				path,
				router['~argc'].input,
				input,
			)
			const hookCall = hookDispatcher.createCall(path, commandName)
			let ok = false
			try {
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
			context,
			rawArgv,
			appName,
			hookDispatcher,
		)
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
		for (const [key, value] of Object.entries(node)) {
			walk(value, prefix ? `${prefix}.${key}` : key)
		}
	}
	walk(handlers, '')
	return out
}

function buildScriptApi(
	router: Router,
	handlers: Record<string, unknown>,
	context: unknown,
	rawArgv: string[],
	args: string[],
	appName: string,
	hookDispatcher: HookDispatcher,
): ScriptAPI {
	const handlerTree = buildScriptHandlerTree(
		[],
		router,
		handlers,
		context,
		rawArgv,
		appName,
		hookDispatcher,
	)
	return {
		handlers: handlerTree,
		call: flattenHandlerTree(handlerTree),
		context,
		args,
		raw: rawArgv,
	}
}

async function runInline(
	code: string,
	scope: Record<string, unknown>,
): Promise<unknown> {
	const objectBody = objectLiteralReturnBody(code)
	if (objectBody !== undefined) {
		return await executeInlineBody(objectBody, scope)
	}

	const parsed = parseSync('snippet.js', code, { lang: 'js' })
	if (parsed.errors.length > 0) {
		throw new SyntaxError(
			parsed.errors.map((error) => error.message).join('\n'),
		)
	}

	let body = code
	const last = parsed.program.body.at(-1)
	if (last?.type === 'ExpressionStatement') {
		const expression = last.expression
		body = `${code.slice(0, last.start)}return (${code.slice(
			expression.start,
			expression.end,
		)})`
	}

	return await executeInlineBody(body, scope)
}

async function runScriptFile(path: string, api: ScriptAPI): Promise<unknown> {
	const fullPath = resolvePath(process.cwd(), expandHome(path))
	const mod = (await import(pathToFileURL(fullPath).href)) as Record<
		string,
		unknown
	>
	if (typeof mod.default === 'function') {
		return await (mod.default as (argc: ScriptAPI) => unknown)(api)
	}
	if (typeof mod.main === 'function') {
		return await (mod.main as (argc: ScriptAPI) => unknown)(api)
	}
	throw new Error('@run @file module must export default or main')
}

export async function runScriptMode(
	schema: Router,
	handlers: Record<string, unknown>,
	hookDispatcher: HookDispatcher,
	options: ScriptRunOptions,
): Promise<void> {
	const api = buildScriptApi(
		schema,
		handlers,
		options.context,
		options.raw,
		options.args,
		options.appName,
		hookDispatcher,
	)
	const scope: Record<string, unknown> = {
		argc: api,
		...((typeof api.handlers === 'object' && api.handlers !== null
			? api.handlers
			: {}) as Record<string, unknown>),
	}
	const result = await withStdoutRerouted(async () => {
		if (options.source.kind === 'stdin')
			return await runInline(await readStdin(), scope)
		if (options.source.kind === 'inline')
			return await runInline(options.source.code, scope)
		return await runScriptFile(options.source.path, api)
	})
	await hookDispatcher.drain()
	process.stdout.write(renderResult(result, options.json ? 'json' : 'yaml'))
}

export async function readTextInput(path: string): Promise<string> {
	return await readFile(resolvePath(process.cwd(), expandHome(path)), 'utf8')
}
