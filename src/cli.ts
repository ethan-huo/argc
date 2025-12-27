import type {
	AnyCommand,
	CLIOptions,
	Handlers,
	Router,
	Schema,
	StandardSchemaV1,
} from './types'

import { fmt as colors } from './terminal'
import { parseArgv } from './parser'
import { extractInputParamsDetailed, generateSchema } from './schema'
import { formatSuggestion, suggestSimilar } from './suggest'
import { isCommand, isGroup } from './types'

// Helper to get children from a router (handles both groups and plain objects)
function getRouterChildren(router: Router): { [key: string]: Router } {
	if (isCommand(router)) return {}
	if (isGroup(router)) return router['~argc.group'].children
	return router
}

type ContextFn<TGlobals extends Schema, TContext> = (
	globals: StandardSchemaV1.InferOutput<TGlobals>,
) => TContext | Promise<TContext>

type RunOptionsWithContext<
	TSchema extends Router,
	TGlobals extends Schema,
	TContext,
> = {
	context: ContextFn<TGlobals, TContext>
	handlers: Handlers<TSchema, TContext>
}

type RunOptionsWithoutContext<TSchema extends Router, TGlobals extends Schema> =
	{
		context?: never
		handlers: Handlers<TSchema, StandardSchemaV1.InferOutput<TGlobals>>
	}

export class CLI<TSchema extends Router, TGlobals extends Schema = Schema> {
	private schema: TSchema
	private options: CLIOptions<TGlobals>

	constructor(schema: TSchema, options: CLIOptions<TGlobals>) {
		this.schema = schema
		this.options = options
	}

	// Overload: with context function
	run<TContext>(
		runOptions: RunOptionsWithContext<TSchema, TGlobals, TContext>,
		argv?: string[],
	): Promise<void>

	// Overload: without context function
	run(
		runOptions: RunOptionsWithoutContext<TSchema, TGlobals>,
		argv?: string[],
	): Promise<void>

	// Implementation
	async run<TContext>(
		runOptions:
			| RunOptionsWithContext<TSchema, TGlobals, TContext>
			| RunOptionsWithoutContext<TSchema, TGlobals>,
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
				const schemaOutput = generateSchema(this.schema, {
					name: this.options.name,
					description: this.options.description,
					globals: this.options.globals,
				})
				// Dim comment lines for readability
				for (const line of schemaOutput.split('\n')) {
					if (line.trimStart().startsWith('//') || line.startsWith('CLI Syntax:') || line.startsWith('  arrays:') || line.startsWith('  objects:')) {
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

		// Build input from flags + positionals
		const commandDef = command['~argc']
		const input = this.buildInput(parsed.flags, remaining, commandDef.args)

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

				// Show Rust-style error with inline annotations
				console.error(colors.error('invalid arguments'))
				console.error()
				this.showOptionsWithErrors(command, errorFields, errorMessages)
				process.exit(1)
			}
			validatedInput = result.value as Record<string, unknown>
		}

		// Parse and validate globals
		let globals = parsed.flags as StandardSchemaV1.InferOutput<TGlobals>
		if (this.options.globals) {
			const result = await this.options.globals['~standard'].validate(
				parsed.flags,
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

		// Build context
		let context: unknown = globals
		if (runOptions.context) {
			context = await runOptions.context(globals)
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
		console.log(
			`  ${colors.option('-h, --help'.padEnd(16))} ${colors.dim('Show help')}`,
		)
		console.log(
			`  ${colors.option('-v, --version'.padEnd(16))} ${colors.dim('Show version')}`,
		)
		console.log(
			`  ${colors.option('--schema'.padEnd(16))} ${colors.dim('Typed CLI spec for AI agents')}`,
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

	private showOptionsWithErrors(
		command: AnyCommand,
		errorFields: Set<string>,
		errorMessages: Record<string, string>,
	): void {
		const args = command['~argc'].args
		const input = command['~argc'].input
		const argNames = new Set(args?.map((a) => a.name) ?? [])
		const inputParams = input ? extractInputParamsDetailed(input) : []

		// First show positional args
		for (const arg of args ?? []) {
			const isError = errorFields.has(arg.name)
			const paramInfo = inputParams.find((p) => p.name === arg.name)
			const desc = arg.description ?? paramInfo?.description ?? ''

			if (isError) {
				console.error(`   ${colors.red(`<${arg.name}>`)}`)
				console.error(
					`   ${colors.red('^')} ${colors.red(errorMessages[arg.name]!)}`,
				)
			} else {
				console.error(
					`   ${colors.option(`<${arg.name}>`)}${desc ? `  ${desc}` : ''}`,
				)
			}
		}

		// Then show options (non-positional)
		for (const opt of inputParams) {
			if (argNames.has(opt.name)) continue

			const isError = errorFields.has(opt.name)
			const flag = `--${opt.name}`
			const typeHint = opt.type !== 'boolean' ? ` <${opt.type}>` : ''
			const desc = opt.description ?? ''
			const defaultHint =
				opt.default !== undefined
					? ` (default: ${JSON.stringify(opt.default)})`
					: ''

			if (isError) {
				console.error(`   ${colors.red(flag)}${typeHint}`)
				console.error(
					`   ${colors.red('^')} ${colors.red(errorMessages[opt.name]!)}`,
				)
			} else {
				console.error(
					`   ${colors.option(flag)}${colors.dim(typeHint)}${desc ? `  ${desc}` : ''}${colors.dim(defaultHint)}`,
				)
			}
		}
	}
}

export function cli<TSchema extends Router, TGlobals extends Schema = Schema>(
	schema: TSchema,
	options: CLIOptions<TGlobals>,
): CLI<TSchema, TGlobals> {
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
