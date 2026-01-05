import type {
	AnyCommand,
	CLIOptions,
	CombinedHandlers,
	Handlers,
	Router,
	RunConfig,
	Schema,
	StandardSchemaV1,
} from './types'

import { fmt as colors, padEnd } from './terminal'
import { parseArgv } from './parser'
import {
	extractInputParamsDetailed,
	generateSchema,
	generateSchemaHintExample,
	generateSchemaOutline,
	getInputTypeHint,
} from './schema'
import { formatSuggestion, suggestSimilar } from './suggest'
import { isCommand, isGroup } from './types'
import {
	buildSchemaSubset,
	matchSchemaSelector,
	parseSchemaSelector,
} from './schema-selector'

// Helper to get children from a router (handles both groups and plain objects)
function getRouterChildren(router: Router): { [key: string]: Router } {
	if (isCommand(router)) return {}
	if (isGroup(router)) return router['~argc.group'].children
	return router
}

// Reserved global option names that conflict with built-in flags
const RESERVED_GLOBALS = new Set(['help', 'h', 'version', 'v', 'schema', 'input'])

export class CLI<
	TSchema extends Router,
	TGlobals extends Schema = Schema,
	TContext = undefined,
> {
	// Phantom type for external inference (e.g., typeof app.Handlers)
	// Combined: both nested ['user']['get'] and flat ['user.get'] access
	declare Handlers: CombinedHandlers<Handlers<TSchema, Awaited<TContext>>>

	private schema: TSchema
	private options: CLIOptions<TGlobals, TContext>

	constructor(schema: TSchema, options: CLIOptions<TGlobals, TContext>) {
		this.schema = schema
		this.options = options

		// Check for reserved global option names
		if (options.globals) {
			const globalParams = extractInputParamsDetailed(options.globals)
			const conflicts = globalParams
				.map((p) => p.name)
				.filter((name) => RESERVED_GLOBALS.has(name))
			if (conflicts.length > 0) {
				console.error(colors.error('Invalid global options configuration'))
				console.error()
				console.error(
					`  Reserved names: ${conflicts.map((n) => colors.option(`--${n}`)).join(', ')}`,
				)
				console.error(
					colors.dim('  These conflict with built-in flags: -h/--help, -v/--version, --schema'),
				)
				process.exit(1)
			}
		}
	}

	async run(
		runOptions: RunConfig<TSchema, Awaited<TContext>>,
		argv: string[] = process.argv.slice(2),
	): Promise<void> {
		const parsed = parseArgv(argv)

		// Handle --help (allowed at any level)
		if (parsed.flags.help || parsed.flags.h) {
			const { commandPath, router } = this.resolveRouter(parsed.positionals)
			this.showHelp(commandPath, router)
			return
		}

		// Global flags only work at root level (no positionals yet)
		const isRootLevel = parsed.positionals.length === 0

		// Handle --version (root only)
		if (parsed.flags.version || parsed.flags.v) {
			if (isRootLevel) {
				console.log(this.options.version)
				return
			}
			// Otherwise fall through - will be treated as unknown flag
		}

		// Handle --schema (root only, for AI agents)
		if (parsed.flags.schema) {
			if (isRootLevel) {
				let selectorMatches: ReturnType<typeof matchSchemaSelector> | null =
					null
				let schemaOutput = generateSchema(this.schema, {
					name: this.options.name,
					description: this.options.description,
					globals: this.options.globals,
				})
				const selectorValue =
					typeof parsed.flags.schema === 'string'
						? parsed.flags.schema
						: null
					if (selectorValue) {
						try {
							const steps = parseSchemaSelector(selectorValue)
							selectorMatches = matchSchemaSelector(this.schema, steps)
							const subset = buildSchemaSubset(this.schema, selectorMatches, 1)
							schemaOutput = generateSchema(subset, {
								name: this.options.name,
								description: this.options.description,
								globals: this.options.globals,
							})
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error)
						console.log(colors.error(`Invalid schema selector: ${message}`))
						process.exit(1)
					}
				}
				const maxLines = this.options.schemaMaxLines ?? 100
				const lines = schemaOutput.split('\n')

					if (lines.length > maxLines) {
						console.log(
							`Schema too large (${lines.length} lines). Showing compact outline.`,
						)
						console.log()
						const outlineSchema =
							selectorMatches === null
								? this.schema
								: buildSchemaSubset(this.schema, selectorMatches, 2)
						for (const line of generateSchemaOutline(outlineSchema, 2)) {
							console.log(line)
						}
					console.log()
					const hintExample = generateSchemaHintExample(outlineSchema)
					if (hintExample) {
						console.log(`hint: use --schema=.${hintExample}`)
					}
					console.log(
						'hint: selector is jq-like (path, *, {a,b}, ..name)',
					)
					return
				}

				// Dim comment lines for readability
				for (const line of lines) {
					if (
						line.trimStart().startsWith('//') ||
						line.startsWith('CLI Syntax:') ||
						line.startsWith('  arrays:') ||
						line.startsWith('  objects:')
					) {
						console.log(colors.dim(line))
					} else {
						console.log(line)
					}
				}
				return
			}
			// Otherwise fall through
		}

		// Extract command from positionals
		const { commandPath, command, remaining, router, failedAt } =
			this.extractCommand(parsed.positionals)

		// Check for invalid root-only flags used with subcommands
		if (commandPath.length > 0) {
			if (parsed.flags.version || parsed.flags.v) {
				console.log(colors.error("Invalid argument '-v'"))
				console.log()
				this.showHelp(commandPath, router)
				process.exit(1)
			}
			if (parsed.flags.schema) {
				console.log(colors.error("Invalid argument '--schema'"))
				console.log()
				this.showHelp(commandPath, router)
				process.exit(1)
			}
		}

		if (!command) {
			if (failedAt !== null) {
				// User typed something wrong - git style message
				const availableCommands = this.getAvailableCommands(router)
				const similar = suggestSimilar(failedAt, availableCommands)
				console.log(
					`${this.options.name}: '${failedAt}' is not a ${this.options.name} command. See '${this.options.name} --help'.`,
				)
				const suggestionLines = formatSuggestion(similar)
				if (suggestionLines.length > 0) {
					console.log()
					for (const line of suggestionLines) {
						console.log(line)
					}
				}
				process.exit(1)
			} else {
				// Reached a group without specifying subcommand, show group help
				this.showHelp(commandPath, router)
				process.exit(commandPath.length === 0 ? 0 : 1)
			}
		}

		// Find handler
		const handler = this.findHandler(
			commandPath,
			runOptions.handlers as Record<string, unknown>,
		)
		if (!handler) {
			console.error(
				colors.error(`No handler for command: ${colors.command(commandPath.join(' '))}`),
			)
			process.exit(1)
		}

		const commandDef = command['~argc']
		const { flagsWithoutInput, inputFlag } = this.extractInputFlag(parsed.flags)
		if (inputFlag !== undefined) {
			this.assertJsonInputUsage(flagsWithoutInput, remaining)
		}
		let input = this.buildInput(flagsWithoutInput, remaining, commandDef.args)
		if (inputFlag !== undefined) {
			input = await this.parseJsonInput(inputFlag)
		}

		// Validate input with schema
		let validatedInput = input
		if (commandDef.input) {
			const result = await commandDef.input['~standard'].validate(input)
			if (result.issues) {
				// Collect error fields
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

				// Show validation error summary + details
				console.error(colors.error('invalid arguments'))
				console.error()
				this.showValidationError(commandPath, command, errorFields, errorMessages)
				process.exit(1)
			}
			validatedInput = result.value as Record<string, unknown>
		}

		// Parse and validate globals
		let globals = flagsWithoutInput as StandardSchemaV1.InferOutput<TGlobals>
		if (this.options.globals) {
			const result = await this.options.globals['~standard'].validate(
				flagsWithoutInput,
			)
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
			globals = result.value as StandardSchemaV1.InferOutput<TGlobals>
		}

		// Build context from options
		let context: unknown = undefined
		if (this.options.context) {
			context = await this.options.context(globals)
		}

		// Call handler
		await handler({
			input: validatedInput,
			context,
			meta: {
				path: commandPath,
				command: commandPath.join(' '),
				raw: parsed.raw,
			},
		})
	}

	private resolveRouter(positionals: string[]): {
		commandPath: string[]
		router: Router
	} {
		let current: Router = this.schema
		const commandPath: string[] = []

		for (const segment of positionals) {
			if (isCommand(current)) {
				break
			}
			const children = getRouterChildren(current)
			if (segment in children) {
				commandPath.push(segment)
				current = children[segment]!
			} else {
				break
			}
		}

		return { commandPath, router: current }
	}

	private extractCommand(positionals: string[]): {
		commandPath: string[]
		command: AnyCommand | null
		remaining: string[]
		router: Router
		failedAt: string | null
	} {
		let current: Router = this.schema
		const commandPath: string[] = []

		for (let i = 0; i < positionals.length; i++) {
			const segment = positionals[i]!

			if (isCommand(current)) {
				return {
					commandPath,
					command: current,
					remaining: positionals.slice(i),
					router: current,
					failedAt: null,
				}
			}

			const children = getRouterChildren(current)
			// Try direct match first
			if (segment in children) {
				commandPath.push(segment)
				current = children[segment]!
			} else {
				// Try alias match
				const aliasMatch = this.findByAlias(children, segment)
				if (aliasMatch) {
					commandPath.push(aliasMatch.name)
					current = aliasMatch.router
				} else {
					// Failed to match - return current router for suggestions
					return {
						commandPath,
						command: null,
						remaining: [],
						router: current,
						failedAt: segment,
					}
				}
			}
		}

		if (isCommand(current)) {
			return {
				commandPath,
				command: current,
				remaining: [],
				router: current,
				failedAt: null,
			}
		}

		// Reached a router (group), not a command
		return {
			commandPath,
			command: null,
			remaining: [],
			router: current,
			failedAt: null,
		}
	}

	private getAvailableCommands(router: Router): string[] {
		if (isCommand(router)) return []
		return Object.keys(getRouterChildren(router))
	}

	private findHandler(
		path: string[],
		handlers: Record<string, unknown>,
	): ((opts: unknown) => Promise<void> | void) | null {
		let current: unknown = handlers

		for (const segment of path) {
			if (
				typeof current === 'object' &&
				current !== null &&
				segment in current
			) {
				current = (current as Record<string, unknown>)[segment]
			} else {
				return null
			}
		}

		if (typeof current === 'function') {
			return current as (opts: unknown) => Promise<void> | void
		}

		return null
	}

	private buildInput(
		flags: Record<string, unknown>,
		positionals: string[],
		argDefs?: { name: string }[],
	): Record<string, unknown> {
		const input: Record<string, unknown> = { ...flags }

		if (argDefs) {
			for (let i = 0; i < argDefs.length && i < positionals.length; i++) {
				input[argDefs[i]!.name] = positionals[i]!
			}
		}

		if (positionals.length > (argDefs?.length ?? 0)) {
			input._positionals = positionals.slice(argDefs?.length ?? 0)
		}

		return input
	}

	private extractInputFlag(flags: Record<string, unknown>): {
		flagsWithoutInput: Record<string, unknown>
		inputFlag: unknown | undefined
	} {
		const { input, ...rest } = flags as Record<string, unknown>
		return { flagsWithoutInput: rest, inputFlag: input }
	}

	private assertJsonInputUsage(
		flagsWithoutInput: Record<string, unknown>,
		positionals: string[],
	): void {
		const globalNames = this.getGlobalOptionNames()
		const nonGlobalFlags = Object.keys(flagsWithoutInput).filter(
			(name) => !globalNames.has(name),
		)

		if (positionals.length === 0 && nonGlobalFlags.length === 0) return

		console.log(colors.error('Invalid --input usage'))
		console.log()
		if (positionals.length > 0) {
			console.log('  Cannot use positional arguments with --input')
		}
		if (nonGlobalFlags.length > 0) {
			console.log(
				`  Cannot use flags with --input: ${nonGlobalFlags.map((name) => `--${name}`).join(', ')}`,
			)
		}
		process.exit(1)
	}

	private getGlobalOptionNames(): Set<string> {
		if (!this.options.globals) return new Set()
		const params = extractInputParamsDetailed(this.options.globals)
		return new Set(params.map((p) => p.name))
	}

	private async parseJsonInput(flag: unknown): Promise<Record<string, unknown>> {
		const raw =
			flag === true
				? await this.readStdin()
				: typeof flag === 'string'
					? await this.readInputString(flag)
					: null
		if (raw === null) {
			console.log(
				colors.error(
					'Invalid --input value (expected JSON string, @file, or stdin)',
				),
			)
			process.exit(1)
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(raw)
		} catch {
			console.log(colors.error('Invalid JSON input'))
			process.exit(1)
		}

		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			console.log(colors.error('JSON input must be an object'))
			process.exit(1)
		}

		return parsed as Record<string, unknown>
	}

	private async readStdin(): Promise<string> {
		return await new Response(Bun.stdin).text()
	}

	private async readInputString(value: string): Promise<string> {
		if (value.startsWith('@')) {
			const path = this.expandHome(value.slice(1))
			if (!path) {
				console.log(colors.error('Invalid --input file path'))
				process.exit(1)
			}
			return await Bun.file(path).text()
		}
		return value
	}

	private expandHome(path: string): string {
		if (path.startsWith('~/')) {
			const home = process.env.HOME
			if (!home) return path
			return `${home}${path.slice(1)}`
		}
		return path
	}

	private showHelp(commandPath: string[], router: Router): void {
		const { name, version, description } = this.options
		const fullCommand =
			commandPath.length > 0 ? `${name} ${commandPath.join(' ')}` : name

		console.log(`${colors.bold(name)} ${colors.dim(`v${version}`)}`)
		if (commandPath.length === 0 && description) {
			console.log(description)
		}
		console.log()

		if (isCommand(router)) {
			// Show command-specific help
			const meta = router['~argc'].meta
			const args = router['~argc'].args
			const input = router['~argc'].input
			const argNames = new Set(args?.map((a) => a.name) ?? [])

			// Extract input params with descriptions
			const inputParams = input ? extractInputParamsDetailed(input) : []

			// Usage line
			let usage = `${colors.bold('Usage:')} ${colors.command(fullCommand)}`
			if (args?.length) {
				usage += ` ${args.map((a) => colors.arg(`<${a.name}>`)).join(' ')}`
			}
			usage += ` ${colors.dim('[options]')}`
			console.log(usage)

			if (meta.description) {
				console.log()
				console.log(meta.description)
			}

			// Arguments (positional)
			if (args?.length) {
				console.log()
				console.log(colors.bold('Arguments:'))
				for (const arg of args) {
					// Find description from input params
					const paramInfo = inputParams.find((p) => p.name === arg.name)
					const desc = arg.description ?? paramInfo?.description ?? ''
					console.log(
						`  ${colors.arg(arg.name.padEnd(16))} ${colors.dim(desc)}`,
					)
				}
			}

			// Options (non-positional input params)
			const options = inputParams.filter((p) => !argNames.has(p.name))
			if (options.length > 0) {
				console.log()
				console.log(colors.bold('Options:'))
				for (const opt of options) {
					const flag = opt.optional
						? `--${opt.name}`
						: `--${opt.name} (required)`
					const typeHint = opt.type !== 'boolean' ? ` <${opt.type}>` : ''
					const defaultHint =
						opt.default !== undefined
							? ` (default: ${JSON.stringify(opt.default)})`
							: ''
					const usageHint = getTypeUsageHint(opt.type, opt.name)
					const desc = opt.description ?? ''
					console.log(
						`  ${colors.option(`${flag}${typeHint}`.padEnd(24))} ${colors.dim(`${desc}${defaultHint}${usageHint}`)}`,
					)
				}
			}

			console.log()
			console.log(colors.bold('Input:'))
			const inputType = input ? getInputTypeHint(input) : 'object'
			console.log(
				`  ${colors.option(`--input <${inputType}>`.padEnd(24))} ${colors.dim('Read command input from JSON string or stdin')}`,
			)

			// Examples
			if (meta.examples?.length) {
				console.log()
				console.log(colors.bold('Examples:'))
				for (const ex of meta.examples) {
					console.log(`  ${colors.dim(ex)}`)
				}
			}
		} else {
			// Show subcommands (router group or plain object)
			const groupMeta = isGroup(router) ? router['~argc.group'].meta : null
			const children = getRouterChildren(router)

			console.log(
				`${colors.bold('Usage:')} ${colors.command(fullCommand)} ${colors.arg('<command>')} ${colors.dim('[options]')}`,
			)

			if (groupMeta?.description) {
				console.log()
				console.log(groupMeta.description)
			}

			console.log()
			console.log(colors.bold('Commands:'))

			for (const [key, value] of Object.entries(children)) {
				const desc = this.getRouterDescription(value)
				const hidden = isCommand(value)
					? value['~argc'].meta.hidden
					: isGroup(value)
						? value['~argc.group'].meta.hidden
						: false
				const deprecated = isCommand(value)
					? value['~argc'].meta.deprecated
					: false
				if (!hidden) {
					// Format: "alias, command" like pnpm style
					const aliases = isCommand(value)
						? value['~argc'].meta.aliases
						: undefined
					const cmdName = aliases?.length
						? `${aliases.join(', ')}, ${key}`
						: key
					const deprecatedTag = deprecated ? colors.yellow(' [deprecated]') : ''
					console.log(
						`  ${colors.command(cmdName.padEnd(20))}  ${colors.dim(desc)}${deprecatedTag}`,
					)
				}
			}

			console.log()
			console.log(
				colors.dim(
					`Run '${fullCommand} <command> --help' for more information on a command.`,
				),
			)
		}

		console.log()
		console.log(colors.bold('Global Options:'))

		// Show user-defined global options
		if (this.options.globals) {
			const globalParams = extractInputParamsDetailed(this.options.globals)
			for (const opt of globalParams) {
				const flag = `--${opt.name}`
				const typeHint = opt.type !== 'boolean' ? ` <${opt.type}>` : ''
				const defaultHint =
					opt.default !== undefined
						? ` (default: ${JSON.stringify(opt.default)})`
						: ''
				const desc = opt.description ?? ''
				console.log(
					`  ${colors.option(`${flag}${typeHint}`.padEnd(24))} ${colors.dim(`${desc}${defaultHint}`)}`,
				)
			}
		}

		// Built-in options
		console.log(
			`  ${colors.option('-h, --help'.padEnd(24))} ${colors.dim('Show help')}`,
		)
		console.log(
			`  ${colors.option('-v, --version'.padEnd(24))} ${colors.dim('Show version')}`,
		)
		console.log(
			`  ${colors.option('--schema'.padEnd(24))} ${colors.dim('Typed CLI spec for AI agents')}`,
		)
	}

	private getRouterDescription(router: Router): string {
		if (isCommand(router)) {
			return router['~argc'].meta.description ?? ''
		}
		if (isGroup(router)) {
			return router['~argc.group'].meta.description ?? ''
		}
		// For plain router objects, return subcommand count
		const keys = Object.keys(router)
		return `${keys.length} subcommand${keys.length > 1 ? 's' : ''}`
	}

	private findByAlias(
		children: { [key: string]: Router },
		alias: string,
	): { name: string; router: Router } | null {
		for (const [name, router] of Object.entries(children)) {
			if (isCommand(router)) {
				const aliases = router['~argc'].meta.aliases
				if (aliases?.includes(alias)) {
					return { name, router }
				}
			}
		}
		return null
	}

	private showValidationError(
		commandPath: string[],
		command: AnyCommand,
		errorFields: Set<string>,
		errorMessages: Record<string, string>,
	): void {
		const args = command['~argc'].args ?? []
		const input = command['~argc'].input
		const argNames = new Set(args.map((a) => a.name))
		const inputParams = input ? extractInputParamsDetailed(input) : []

		// Build usage line
		const cmdName =
			commandPath.length > 0
				? `${this.options.name} ${commandPath.join(' ')}`
				: this.options.name
		const argParts = args.map((a) => `<${a.name}>`)
		const hasOptions = inputParams.some((p) => !argNames.has(p.name))
		const optionsPart = hasOptions ? '[options]' : ''
		const usageLine = [cmdName, ...argParts, optionsPart]
			.filter(Boolean)
			.join(' ')

		console.error(`${colors.bold('Usage:')} ${colors.command(usageLine)}`)
		console.error()

		const orderedFields: string[] = []
		for (const arg of args) orderedFields.push(arg.name)
		for (const param of inputParams) {
			if (!argNames.has(param.name)) orderedFields.push(param.name)
		}
		for (const field of errorFields) {
			if (!orderedFields.includes(field)) orderedFields.push(field)
		}

		const errors: {
			field: string
			label: string
			message: string
			required: boolean
		}[] = []

		for (const field of orderedFields) {
			if (!errorFields.has(field)) continue
			const raw = errorMessages[field] ?? ''
			let msg = raw
			let required = false
			if (/^Invalid key: Expected .+ but received undefined$/.test(msg)) {
				msg = 'required'
				required = true
			} else {
				msg = msg.replace(/^Invalid \w+: /, '')
				if (msg.toLowerCase() === 'required') required = true
			}

			const label = argNames.has(field) ? `<${field}>` : `--${field}`
			errors.push({ field, label, message: msg, required })
		}

		const missing = errors.filter((e) => e.required).map((e) => e.label)
		if (missing.length > 0) {
			console.error(
				`${colors.bold('Missing required:')} ${missing.join(', ')}`,
			)
			console.error()
		}

		if (errors.length > 0) {
			console.error(colors.bold('Details:'))
			const maxLabelLen = Math.max(...errors.map((e) => e.label.length))
			for (const err of errors) {
				console.error(
					`  ${colors.red(padEnd(err.label, maxLabelLen))}  ${err.message}`,
				)
			}
		}

		const examples = command['~argc'].meta.examples
		if (examples?.length) {
			console.error()
			console.error(colors.bold('Hint:'))
			console.error(`  ${colors.dim(examples[0]!)}`)
		}

		console.error()
		console.error(
			colors.dim(`Run '${cmdName} --help' for full usage.`),
		)
	}
}

export function cli<
	TSchema extends Router,
	TGlobals extends Schema = Schema,
	TContext = undefined,
>(
	schema: TSchema,
	options: CLIOptions<TGlobals, TContext>,
): CLI<TSchema, TGlobals, TContext> {
	return new CLI(schema, options)
}

// Generate usage hint for complex types
function getTypeUsageHint(type: string, name: string): string {
	// Array type: string[], number[], etc.
	if (type.endsWith('[]')) {
		return ` (repeatable)`
	}

	// Object type: { ... }
	if (type.startsWith('{') && type.endsWith('}')) {
		return ` (use --${name}.<key>)`
	}

	return ''
}
