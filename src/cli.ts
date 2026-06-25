import { JSON5 } from 'bun'
import { stringify } from 'yaml'

import type {
	AnyCommand,
	CLIOptions,
	CombinedHandlers,
	ContextOutput,
	Handlers,
	HookTransport,
	Router,
	RunConfig,
	Schema,
	StandardSchemaV1,
} from './types'

import { isBuiltinCommand } from './builtins'
import {
	complete,
	detectCurrentShell,
	generateCompletionScript,
	getCompletionReloadHint,
	installCompletionScript,
} from './complete'
import { showCommandHelp, showHelp } from './help'
import { createHookDispatcher } from './hook'
import { parseHumanArgs } from './human'
import { colorizeSchema } from './markup'
import { parseInputSource, type InputSource } from './parser'
import {
	ArgcError,
	formatRuntimeError,
	renderError,
	renderResult,
	type ErrorEnvelope,
	type ErrorIssue,
	withStdoutRerouted,
} from './render'
import { getRouterChildren, findHandler } from './router'
import {
	extractCliInputParamsDetailed,
	formatSchemaSelectorPath,
	getInputTypeHint,
	isValidCommandKey,
} from './schema'
import { createDefaultSchemaExplorer } from './schema-explorer'
import {
	parseRunSource,
	readStdin,
	readTextInput,
	runScriptMode,
} from './script'
import { suggestSimilar } from './suggest'
import { isCommand, isGroup } from './types'

type ParsedCommandCall = {
	kind: 'command'
	commandPath: string[]
	command: AnyCommand
	input: InputSource
	context: InputSource
	raw: string[]
}

type ParsedHelpCall = {
	kind: 'help'
}

type ParsedCall = ParsedCommandCall | ParsedHelpCall

const SYSTEM_CONTEXT: InputSource = { kind: 'omitted' }

export class CLI<
	TSchema extends Router,
	TContext extends Schema | undefined = undefined,
> {
	declare Handlers: CombinedHandlers<Handlers<TSchema, TContext>>

	private schema: TSchema
	private options: CLIOptions<TContext>
	private stdinTextPromise: Promise<string> | undefined

	constructor(schema: TSchema, options: CLIOptions<TContext>) {
		this.schema = schema
		this.options = options
		this.assertValidCommandKeys(schema, [])
	}

	async run(
		runOptions: RunConfig<TSchema, TContext>,
		argv: string[] = process.argv.slice(2),
	): Promise<void> {
		try {
			await this.runInner(runOptions, argv)
		} catch (error) {
			if (error instanceof ArgcError) {
				process.stderr.write(renderError(this.finalizeEnvelope(error.envelope)))
				process.exit(1)
			}
			process.stderr.write(
				renderError({
					error: 'RUNTIME_ERROR',
					detail: formatRuntimeError(error),
				}),
			)
			process.exit(1)
		}
	}

	// Invariant in one place: an INVALID_INPUT always carries its command $schema.
	// Explicit parser hints survive so the human path can point back to command help;
	// schema validation itself still emits no hint.
	private finalizeEnvelope(envelope: ErrorEnvelope): ErrorEnvelope {
		if (
			envelope.error === 'INVALID_INPUT' &&
			!envelope.$schema &&
			typeof envelope.command === 'string'
		) {
			return {
				...envelope,
				$schema: this.renderSchemaSlice(envelope.command.split('.')),
			}
		}
		return envelope
	}

	private async runInner(
		runOptions: RunConfig<TSchema, TContext>,
		argv: string[],
	): Promise<void> {
		if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
			showHelp(this.schema, this.options)
			return
		}
		if (argv.length === 1 && argv[0] === '--version') {
			process.stdout.write(`${this.options.version}\n`)
			return
		}
		if (argv[0] === '--_complete') {
			const cword = Number.parseInt(argv[1] ?? '0', 10)
			const sep = argv.indexOf('--')
			const words = sep === -1 ? argv.slice(2) : argv.slice(sep + 1)
			for (const result of complete(this.schema, { words, current: cword })) {
				process.stdout.write(`${result}\n`)
			}
			return
		}
		if (isBuiltinCommand(argv[0])) {
			await this.runBuiltin(runOptions, argv)
			return
		}

		const parsed = this.parseCall(argv)
		if (parsed.kind === 'help') return
		const context = await this.resolveContext(parsed.context)
		const result = await this.invokeCommand(
			parsed.commandPath,
			parsed.command,
			parsed.input,
			context,
			runOptions.handlers as Record<string, unknown>,
			parsed.raw,
		)
		process.stdout.write(renderResult(result))
	}

	private async runBuiltin(
		runOptions: RunConfig<TSchema, TContext>,
		argv: string[],
	): Promise<void> {
		const name = argv[0]
		if (name === '@schema') {
			await this.runSchema(argv.slice(1))
			return
		}
		if (name === '@completions') {
			await this.runCompletions(argv.slice(1))
			return
		}
		if (name === '@run') {
			if (this.options.run === false) {
				throw new ArgcError({
					error: 'RUN_DISABLED',
					$hint: `this tool was built with { run: false }`,
				})
			}
			const parsed = this.parseRun(argv)
			const context = await this.resolveContext(SYSTEM_CONTEXT)
			await runScriptMode(
				this.schema,
				runOptions.handlers as Record<string, unknown>,
				this.createHookDispatcher(),
				{
					source: parsed.source,
					json: parsed.json,
					args: parsed.args,
					raw: argv,
					context,
					appName: this.options.name,
				},
			)
			return
		}
		throw new ArgcError({
			error: 'UNKNOWN_COMMAND',
			got: name,
			$hint: `${this.options.name} @schema`,
		})
	}

	private parseRun(argv: string[]): {
		source: ReturnType<typeof parseRunSource>
		json: boolean
		args: string[]
	} {
		const sourceToken = argv[1]
		let json = false
		let args: string[] = []
		for (let index = 2; index < argv.length; index++) {
			const token = argv[index]!
			if (token === '--') {
				args = argv.slice(index + 1)
				break
			}
			if (token === '--json') {
				json = true
				continue
			}
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: `unknown @run option: ${token}`,
			})
		}
		return { source: parseRunSource(sourceToken), json, args }
	}

	private async runSchema(argv: string[]): Promise<void> {
		const explorer = this.getSchemaExplorer()
		// A selector is @schema's argument; a malformed or non-matching selector is a
		// BAD_SELECTOR (not an unknown command), and it embeds the root outline so the
		// agent sees the real structure and fixes the path in one shot.
		if (argv.length > 1) {
			throw new ArgcError({
				error: 'BAD_SELECTOR',
				selector: argv.join(' '),
				reason: '@schema takes at most one selector',
				$schema: this.renderSchemaSlice([]),
			})
		}
		const selectorValue = argv[0]
		let target: Router = this.schema
		if (selectorValue) {
			let selection: ReturnType<typeof explorer.select>
			try {
				selection = explorer.select(this.schema, selectorValue)
			} catch (error) {
				throw new ArgcError({
					error: 'BAD_SELECTOR',
					selector: selectorValue,
					reason: formatRuntimeError(error),
					$schema: this.renderSchemaSlice([]),
				})
			}
			if (selection.empty) {
				throw new ArgcError({
					error: 'BAD_SELECTOR',
					selector: selectorValue,
					reason: 'matched nothing',
					$schema: this.renderSchemaSlice([]),
				})
			}
			target = selection.schema
		}

		// One OKF envelope (--- frontmatter --- body) for both folded and full
		// output, so the agent parses one shape. Body is the typed API, or the
		// compact outline when too large. Frontmatter carries only what has a
		// reason to be there: context, fold status + drill-in, navigation.
		const body = explorer.render(target, this.schemaOptions())
		const lines = body.split('\n')
		const name = this.options.name

		// Guidance is dynamic — it must match the state, not be a constant block.
		const fm: Record<string, string> = {}
		if (this.options.context) {
			fm.context = getInputTypeHint(this.options.context)
		}
		let outBody = body
		if (lines.length > explorer.maxLines) {
			// Folded: the agent must navigate, so pile on selector guidance.
			const hint = explorer.hint(target)
			fm.status = `compact outline — full schema is ${lines.length} lines across ${this.countCommands(target)} commands; narrow with a selector`
			if (hint) fm.next = `${name} @schema .${hint}`
			fm.selectors = [
				'.name            a child',
				'."key"           a child whose name needs quoting',
				'.["key"]         a child by bracket key',
				'.*               all children',
				'.{a.{x,y},b.z}   a set: each branch a full sub-selector, any depth, nestable',
				'..name           recursive search anywhere below',
			].join('\n')
			outBody = explorer.outline(target).join('\n')
		} else {
			// Fully shown: nothing to drill into — say so, do not suggest selectors.
			fm.status = 'fully shown — no further selector needed'
		}
		fm.call = `${name} <path> "<object>"  ·  ${name} @run "<code>"`

		const output = `---\n${stringify(fm, { lineWidth: 0 })}---\n${outBody}\n`
		process.stdout.write(colorizeSchema(output))
	}

	private async runCompletions(argv: string[]): Promise<void> {
		if (argv.length === 0) {
			const shell = detectCurrentShell()
			if (!shell) {
				throw new ArgcError({
					error: 'RUNTIME_ERROR',
					detail: 'could not detect shell; pass bash, zsh, or fish',
				})
			}
			const path = await installCompletionScript(shell, this.options.name)
			process.stdout.write(
				`installed: ${path}\n$hint: ${getCompletionReloadHint(shell, path)}\n`,
			)
			return
		}
		if (argv.length > 1) {
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: '@completions accepts at most one shell',
			})
		}
		const script = generateCompletionScript(argv[0]!, this.options.name)
		if (!script) {
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: `unknown shell: ${argv[0]}`,
			})
		}
		process.stdout.write(`${script}\n`)
	}

	private parseCall(argv: string[]): ParsedCall {
		const pathToken = argv[0]
		if (
			!pathToken ||
			pathToken === '--context' ||
			pathToken === '-' ||
			pathToken.startsWith('{')
		) {
			showHelp(this.schema, this.options)
			throw new ArgcError({
				error: 'NOT_A_COMMAND',
				got: pathToken ?? '',
				$schema: this.renderSchemaSlice([]),
			})
		}

		const resolved = this.resolveDottedPath(pathToken)
		const commandPath = resolved.path
		const current = resolved.router
		let index = 1

		if (!isCommand(current)) {
			const spacePath = this.collectBarePath(argv, index)
			if (spacePath.length > 0) {
				throw new ArgcError({
					error: 'BAD_PATH',
					got: [pathToken, ...spacePath].join(' '),
					$hint: `paths are dotted — ${this.options.name} ${[
						pathToken,
						...spacePath,
					].join('.')} "{ ... }"`,
				})
			}
			throw new ArgcError({
				error: 'NOT_A_COMMAND',
				got: commandPath.join('.'),
				$schema: this.renderSchemaSlice(commandPath),
			})
		}

		let input: InputSource = { kind: 'omitted' }
		let context: InputSource = SYSTEM_CONTEXT
		let seenInput = false

		while (index < argv.length) {
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
				index++
				continue
			}
			if (token === '--help' || token === '-h') {
				showCommandHelp(current, commandPath, { name: this.options.name })
				return { kind: 'help' }
			}
			if (token.startsWith('--')) {
				if (seenInput) {
					throw new ArgcError({
						error: 'TWO_INPUTS',
						$hint: 'object input cannot be mixed with other input forms',
					})
				}
				if (this.hasCommandHelpToken(argv, index)) {
					showCommandHelp(current, commandPath, { name: this.options.name })
					return { kind: 'help' }
				}
				const human = parseHumanArgs(current, argv.slice(index), {
					commandPath,
					appName: this.options.name,
				})
				input = { kind: 'object', value: human.input }
				if (human.context) context = human.context
				seenInput = true
				break
			}
			if (!this.isInputToken(token)) {
				if (seenInput) {
					throw new ArgcError({
						error: 'TWO_INPUTS',
						$hint: 'object input cannot be mixed with other input forms',
					})
				}
				if (this.hasCommandHelpToken(argv, index)) {
					showCommandHelp(current, commandPath, { name: this.options.name })
					return { kind: 'help' }
				}
				const human = parseHumanArgs(current, argv.slice(index), {
					commandPath,
					appName: this.options.name,
				})
				input = { kind: 'object', value: human.input }
				if (human.context) context = human.context
				seenInput = true
				break
			}
			if (seenInput) {
				throw new ArgcError({
					error: 'TWO_INPUTS',
					$hint: `a command takes one input object; pass context via --context:\n${this.options.name} ${commandPath.join(
						'.',
					)} <input> --context <ctx>`,
				})
			}
			input = parseInputSource(token)
			seenInput = true
			index++
		}

		return {
			kind: 'command',
			commandPath,
			command: current,
			input,
			context,
			raw: argv,
		}
	}

	private resolveDottedPath(pathToken: string): {
		path: string[]
		router: Router
	} {
		const segments = pathToken.split('.')
		let current: Router = this.schema
		const resolvedPath: string[] = []

		for (const segment of segments) {
			if (!segment || !isValidCommandKey(segment)) {
				throw new ArgcError({
					error: 'BAD_PATH',
					got: pathToken,
					$hint: 'paths are dotted identifiers or @-prefixed identifiers',
				})
			}
			const children = getRouterChildren(current)
			if (!(segment in children)) {
				const similar = suggestSimilar(segment, Object.keys(children))[0]
				const envelope: {
					error: 'UNKNOWN_COMMAND'
					got: string
					did_you_mean?: string
					$schema: string
				} = {
					error: 'UNKNOWN_COMMAND',
					got: pathToken,
					$schema: this.renderSchemaSlice(resolvedPath),
				}
				if (similar) {
					envelope.did_you_mean = [...resolvedPath, similar].join('.')
				}
				throw new ArgcError(envelope)
			}
			current = children[segment]!
			resolvedPath.push(segment)
		}

		return { path: resolvedPath, router: current }
	}

	private hasCommandHelpToken(argv: string[], start: number): boolean {
		return argv
			.slice(start)
			.some((token) => token === '--help' || token === '-h')
	}

	private isInputToken(token: string): boolean {
		return token.startsWith('{') || token.startsWith('@') || token === '-'
	}

	private collectBarePath(argv: string[], start: number): string[] {
		const path: string[] = []
		for (let index = start; index < argv.length; index++) {
			const token = argv[index]!
			if (
				token === '--context' ||
				token.startsWith('--') ||
				this.isInputToken(token)
			) {
				break
			}
			path.push(token)
		}
		return path
	}

	private getSchemaExplorer() {
		return this.options.schemaExplorer ?? createDefaultSchemaExplorer()
	}

	private renderSchemaSlice(path: string[]): string {
		const explorer = this.getSchemaExplorer()
		const router =
			path.length === 0
				? this.schema
				: explorer.select(this.schema, formatSchemaSelectorPath(path)).schema
		const output = explorer.render(router, this.schemaOptions())
		const lines = output.split('\n')
		if (lines.length <= explorer.maxLines) return output
		return [
			`// Schema slice is large: ${lines.length} lines across ${this.countCommands(router)} commands.`,
			'',
			...explorer.outline(router),
		].join('\n')
	}

	private async invokeCommand(
		commandPath: string[],
		command: AnyCommand,
		inputSource: InputSource,
		context: ContextOutput<TContext>,
		handlers: Record<string, unknown>,
		raw: string[],
	): Promise<unknown> {
		const handler = findHandler(commandPath, handlers)
		if (!handler) {
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: `no handler for command: ${commandPath.join('.')}`,
			})
		}
		const input = await this.resolveInput(inputSource)
		const validatedInput = await this.validateInput(commandPath, command, input)
		const hookDispatcher = this.createHookDispatcher()
		const hookCall = hookDispatcher.createCall(
			commandPath,
			commandPath.join('.'),
		)
		let ok = false
		try {
			const result = await withStdoutRerouted(async () => {
				return await handler({
					input: validatedInput,
					context,
					meta: {
						path: commandPath,
						command: commandPath.join('.'),
						raw,
						callId: hookCall.callId,
					},
					emit: hookCall.emit,
				})
			})
			ok = true
			return result
		} catch (error) {
			hookCall.error(error)
			throw error
		} finally {
			hookCall.end(ok)
			await hookDispatcher.drain()
		}
	}

	private async resolveInput(source: InputSource): Promise<unknown> {
		if (source.kind === 'omitted') return {}
		if (source.kind === 'object') return source.value
		let raw: string
		if (source.kind === 'stdin') {
			raw = await this.readStdinText()
		} else if (source.kind === 'file') {
			raw = await readTextInput(source.path)
		} else {
			raw = source.value
		}
		try {
			const parsed = JSON5.parse(raw)
			if (
				parsed === null ||
				typeof parsed !== 'object' ||
				Array.isArray(parsed)
			) {
				throw new Error('input must be an object')
			}
			return parsed
		} catch (error) {
			throw new ArgcError({
				error: 'BAD_INPUT_JSON',
				detail: `invalid object literal: ${formatRuntimeError(error)}`,
			})
		}
	}

	private async resolveContext(
		source: InputSource,
	): Promise<ContextOutput<TContext>> {
		if (!this.options.context) {
			if (source.kind !== 'omitted') {
				throw new ArgcError({
					error: 'INVALID_CONTEXT',
					issues: [{ message: 'this CLI declares no context' }],
				})
			}
			return undefined as ContextOutput<TContext>
		}
		// Context problems always show the Context type so the agent can fix the shape.
		const contextSchema = `type Context = ${getInputTypeHint(this.options.context)}`
		const env = process.env.ARGC_CTX
		const actualSource =
			source.kind === 'omitted' && env !== undefined
				? ({ kind: 'inline', value: env } as InputSource)
				: source
		let input: unknown
		try {
			input = await this.resolveInput(actualSource)
		} catch (error) {
			if (
				error instanceof ArgcError &&
				error.envelope.error === 'BAD_INPUT_JSON'
			) {
				throw new ArgcError({
					error: 'BAD_INPUT_JSON',
					source: 'context',
					detail: error.envelope.detail,
					$schema: contextSchema,
				})
			}
			throw error
		}
		const unknownKeyIssues = await this.validateObject(
			this.options.context,
			input,
		)
		const result = await this.options.context['~standard'].validate(input)
		let schemaIssues: ErrorIssue[] = []
		let value: unknown = input
		if (result.issues) {
			schemaIssues = this.normalizeIssues(result.issues)
		} else {
			value = result.value
		}
		const allIssues = [...schemaIssues, ...unknownKeyIssues]
		if (allIssues.length > 0) {
			throw new ArgcError({
				error: 'INVALID_CONTEXT',
				issues: allIssues,
				$schema: contextSchema,
			})
		}
		return value as ContextOutput<TContext>
	}

	private async validateInput(
		commandPath: string[],
		command: AnyCommand,
		input: unknown,
	): Promise<unknown> {
		const issues = await this.validateObject(command['~argc'].input, input)
		let schemaIssues: ErrorIssue[] = []
		let value = input
		if (command['~argc'].input) {
			const result = await command['~argc'].input['~standard'].validate(input)
			if (result.issues) {
				schemaIssues = this.normalizeIssues(result.issues)
			} else {
				value = result.value
			}
		}
		const allIssues = [...schemaIssues, ...issues]
		if (allIssues.length > 0) {
			throw new ArgcError({
				error: 'INVALID_INPUT',
				command: commandPath.join('.'),
				issues: allIssues,
				$schema: this.renderSchemaSlice(commandPath),
			})
		}
		return value
	}

	private async validateObject(
		schema: Schema | undefined,
		input: unknown,
	): Promise<ErrorIssue[]> {
		if (input === null || typeof input !== 'object' || Array.isArray(input)) {
			return [{ message: 'input must be an object' }]
		}
		const fields = new Set(
			schema
				? extractCliInputParamsDetailed(schema).map((param) => param.name)
				: [],
		)
		return Object.keys(input as Record<string, unknown>)
			.filter((key) => !fields.has(key))
			.map((key) => ({ at: key, message: 'unknown key' }))
	}

	private normalizeIssues(
		issues: readonly StandardSchemaV1.Issue[],
	): ErrorIssue[] {
		return issues.map((issue) => {
			const normalized: ErrorIssue = { message: issue.message }
			const at = issue.path
				?.map((part: { key: PropertyKey } | PropertyKey) =>
					typeof part === 'object' ? part.key : part,
				)
				.join('.')
			if (at) normalized.at = at
			return normalized
		})
	}

	private schemaOptions() {
		const options: {
			name: string
			description?: string
			context?: TContext
		} = { name: this.options.name }
		if (this.options.description !== undefined) {
			options.description = this.options.description
		}
		if (this.options.context !== undefined) {
			options.context = this.options.context
		}
		return options
	}

	private countCommands(router: Router): number {
		if (isCommand(router)) return 1
		return Object.values(getRouterChildren(router)).reduce(
			(total, child) => total + this.countCommands(child),
			0,
		)
	}

	private readStdinText(): Promise<string> {
		this.stdinTextPromise ??= readStdin()
		return this.stdinTextPromise
	}

	private assertValidCommandKeys(router: Router, path: string[]): void {
		if (isCommand(router)) {
			const meta = router['~argc'].meta as Record<string, unknown>
			if ('aliases' in meta) {
				throw new Error(
					`Command aliases are not supported in argc 7: ${path.join('.')}`,
				)
			}
			return
		}
		const children = getRouterChildren(router)
		for (const [key, child] of Object.entries(children)) {
			if (
				(path.length === 0 && isBuiltinCommand(key)) ||
				!isValidCommandKey(key)
			) {
				throw new Error(`Invalid command key: ${[...path, key].join('.')}`)
			}
			this.assertValidCommandKeys(child, [...path, key])
		}
	}

	private createHookDispatcher() {
		const options: {
			app: string
			hook?: false | HookTransport
			hookUrl?: string
			timeoutMs: number
		} = {
			app: this.options.name,
			timeoutMs: this.options.hookTimeoutMs ?? 2000,
		}
		if (this.options.hook !== undefined) options.hook = this.options.hook
		if (process.env.ARGC_HOOK_URL !== undefined) {
			options.hookUrl = process.env.ARGC_HOOK_URL
		}
		return createHookDispatcher(options)
	}
}

export function cli<
	TSchema extends Router,
	TContext extends Schema | undefined = undefined,
>(schema: TSchema, options: CLIOptions<TContext>): CLI<TSchema, TContext> {
	return new CLI(schema, options)
}
