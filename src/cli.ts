import { JSON5 } from 'bun'

import type { SchemaSelectionResult } from './schema-selector'
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

import {
	complete,
	detectCurrentShell,
	generateCompletionScript,
	getCompletionReloadHint,
	installCompletionScript,
} from './complete'
import { showHelp, renderNamespaceCommands } from './help'
import { createHookDispatcher } from './hook'
import { parseInputSource, type InputSource } from './parser'
import {
	ArgcError,
	formatRuntimeError,
	renderError,
	renderResult,
	type ErrorIssue,
	withStdoutRerouted,
} from './render'
import { getRouterChildren, findHandler } from './router'
import { extractCliInputParamsDetailed, isValidIdentifier } from './schema'
import { createDefaultSchemaExplorer } from './schema-explorer'
import {
	parseRunSource,
	readStdin,
	readTextInput,
	runScriptMode,
} from './script'
import { suggestSimilar } from './suggest'
import { isCommand, isGroup } from './types'

type ParsedCall = {
	commandPath: string[]
	command: AnyCommand
	input: InputSource
	context: InputSource
	raw: string[]
}

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
				process.stderr.write(renderError(error.envelope))
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

	private async runInner(
		runOptions: RunConfig<TSchema, TContext>,
		argv: string[],
	): Promise<void> {
		if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
			showHelp(this.options)
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
		if (argv[0]?.startsWith('@')) {
			await this.runBuiltin(runOptions, argv)
			return
		}

		const parsed = this.parseCall(argv)
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
		if (argv.length > 1) {
			throw new ArgcError({
				error: 'RUNTIME_ERROR',
				detail: '@schema accepts at most one selector',
			})
		}
		const selectorValue = argv[0]
		const schemaExplorer =
			this.options.schemaExplorer ?? createDefaultSchemaExplorer()
		let selection: SchemaSelectionResult | null = null
		let schemaOutput = schemaExplorer.render(this.schema, this.schemaOptions())
		if (selectorValue) {
			selection = schemaExplorer.select(this.schema, selectorValue)
			if (selection.empty) {
				throw new ArgcError({
					error: 'UNKNOWN_COMMAND',
					got: selectorValue,
					$hint: `${this.options.name} @schema`,
				})
			}
			schemaOutput = schemaExplorer.render(
				selection.schema,
				this.schemaOptions(),
			)
		}
		const lines = schemaOutput.split('\n')
		if (lines.length > schemaExplorer.maxLines) {
			const outlineSchema = selection === null ? this.schema : selection.schema
			process.stdout.write(
				`// App is large: ${lines.length} lines across ${this.countCommands(outlineSchema)} commands. Drill in with a selector.\n\n`,
			)
			for (const line of schemaExplorer.outline(outlineSchema)) {
				process.stdout.write(`${line}\n`)
			}
			const hint = schemaExplorer.hint(outlineSchema)
			if (hint)
				process.stdout.write(`\nnext: ${this.options.name} @schema .${hint}\n`)
			return
		}
		process.stdout.write(`${schemaOutput}\n`)
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
		let current: Router = this.schema
		const commandPath: string[] = []
		let index = 0
		while (index < argv.length && !isCommand(current)) {
			const token = argv[index]!
			if (
				token === '--context' ||
				token.startsWith('{') ||
				token.startsWith('@') ||
				token === '-'
			) {
				break
			}
			const children = getRouterChildren(current)
			if (!(token in children)) {
				const similar = suggestSimilar(token, Object.keys(children))[0]
				const envelope: {
					error: 'UNKNOWN_COMMAND'
					[key: string]: unknown
				} = {
					error: 'UNKNOWN_COMMAND',
					got: [...commandPath, token].join(' '),
					$hint: `${this.options.name} @schema ${
						commandPath.length > 0 ? `.${commandPath.join('.')}` : ''
					}`.trim(),
				}
				if (similar) envelope.did_you_mean = [...commandPath, similar].join(' ')
				throw new ArgcError(envelope)
			}
			commandPath.push(token)
			current = children[token]!
			index++
		}

		if (!isCommand(current)) {
			if (commandPath.length === 0) {
				showHelp(this.options)
				throw new ArgcError({
					error: 'NOT_A_COMMAND',
					namespace: '',
					$hint: `${this.options.name} @schema`,
				})
			}
			throw new ArgcError({
				error: 'NOT_A_COMMAND',
				namespace: commandPath.join(' '),
				commands: renderNamespaceCommands(current, commandPath),
				$hint: `${this.options.name} @schema .${commandPath.join('.')}`,
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
			if (token.startsWith('--')) {
				throw new ArgcError({
					error: 'UNKNOWN_COMMAND',
					got: token,
					$hint: `${this.options.name} @schema .${commandPath.join('.')}`,
				})
			}
			if (seenInput) {
				throw new ArgcError({
					error: 'TWO_INPUTS',
					$hint: `a command takes one input object; pass context via --context:\n${this.options.name} ${commandPath.join(
						' ',
					)} <input> --context <ctx>`,
				})
			}
			input = parseInputSource(token)
			seenInput = true
			index++
		}

		return {
			commandPath,
			command: current,
			input,
			context,
			raw: argv,
		}
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
				detail: `no handler for command: ${commandPath.join(' ')}`,
			})
		}
		const input = await this.resolveInput(inputSource)
		const validatedInput = await this.validateInput(commandPath, command, input)
		const hookDispatcher = this.createHookDispatcher()
		const hookCall = hookDispatcher.createCall(
			commandPath,
			commandPath.join(' '),
		)
		let ok = false
		try {
			const result = await withStdoutRerouted(async () => {
				return await handler({
					input: validatedInput,
					context,
					meta: {
						path: commandPath,
						command: commandPath.join(' '),
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
				detail: formatRuntimeError(error),
			})
		}
	}

	private async resolveContext(
		source: InputSource,
	): Promise<ContextOutput<TContext>> {
		if (!this.options.context) {
			if (source.kind !== 'omitted') {
				throw new ArgcError({
					error: 'INVALID_INPUT',
					command: '$context',
					issues: [{ message: 'context is not declared by this CLI' }],
				})
			}
			return undefined as ContextOutput<TContext>
		}
		const env = process.env.ARGC_CTX
		const actualSource =
			source.kind === 'omitted' && env !== undefined
				? ({ kind: 'inline', value: env } as InputSource)
				: source
		const input = await this.resolveInput(actualSource)
		const issues = await this.validateObject(this.options.context, input)
		if (issues.length > 0) {
			throw new ArgcError({
				error: 'INVALID_INPUT',
				command: '$context',
				issues,
			})
		}
		const result = await this.options.context['~standard'].validate(input)
		if (result.issues) {
			throw new ArgcError({
				error: 'INVALID_INPUT',
				command: '$context',
				issues: this.normalizeIssues(result.issues),
			})
		}
		return result.value as ContextOutput<TContext>
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
				command: commandPath.join(' '),
				issues: allIssues,
				$hint: `${this.options.name} @schema .${commandPath.join('.')}`,
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
			if (key.startsWith('@') || !isValidIdentifier(key)) {
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
