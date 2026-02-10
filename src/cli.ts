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

import { fmt as colors } from './terminal'
import { parseArgv } from './parser'
import {
	extractInputParamsDetailed,
	generateSchema,
	generateSchemaHintExample,
	generateSchemaOutline,
} from './schema'
import { formatSuggestion, suggestSimilar } from './suggest'
import { complete, generateCompletionScript } from './complete'
import { isCommand } from './types'
import {
	buildSchemaSubset,
	matchSchemaSelector,
	parseSchemaSelector,
} from './schema-selector'
import { JSON5 } from 'bun'

import { getRouterChildren, findHandler } from './router'
import { normalizeArgName, showHelp, showValidationError } from './help'
import { expandHome, readStdin, formatRuntimeError, runScriptMode } from './script'

// Reserved global option names that conflict with built-in flags
const RESERVED_GLOBALS = new Set([
	'help',
	'h',
	'version',
	'v',
	'schema',
	'input',
	'eval',
	'script',
	'completions',
	'_complete',
])

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
					colors.dim('  These conflict with built-in flags (-h, -v, --help, --version, --schema, --input, --eval, --script, --completions, --_complete)'),
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

		// Handle shell completion (must be before all other flag handling)
		if (parsed.flags._complete !== undefined) {
			const cword =
				typeof parsed.flags._complete === 'number'
					? parsed.flags._complete
					: 0
			const results = complete(this.schema, this.options.globals, {
				words: parsed.positionals,
				current: cword,
			})
			for (const r of results) console.log(r)
			return
		}

		// Handle --help (allowed at any level)
		if (parsed.flags.help || parsed.flags.h) {
			const { commandPath, router } = this.resolveRouter(parsed.positionals)
			showHelp(this.options, commandPath, router)
			return
		}

		// Handle scripting mode (global): --eval / --script
		if (parsed.flags.eval !== undefined || parsed.flags.script !== undefined) {
			if (parsed.flags.eval !== undefined && parsed.flags.script !== undefined) {
				console.log(colors.error('Cannot use --eval and --script together'))
				process.exit(1)
			}
			if (parsed.flags.schema) {
				console.log(colors.error("Invalid argument '--schema'"))
				process.exit(1)
			}
			if (parsed.flags.version || parsed.flags.v) {
				console.log(colors.error("Invalid argument '--version'"))
				process.exit(1)
			}
			await runScriptMode(
				this.schema,
				this.options as { globals?: Schema; context?: (globals: unknown) => unknown | Promise<unknown> },
				runOptions.handlers as Record<string, unknown>,
				parsed,
				this.options.name,
			)
			return
		}

		// Global flags only work at root level (no positionals yet)
		const isRootLevel = parsed.positionals.length === 0

		// Handle --completions (root only)
		if (parsed.flags.completions !== undefined) {
			if (isRootLevel) {
				const shell =
					typeof parsed.flags.completions === 'string'
						? parsed.flags.completions
						: null
				if (!shell) {
					console.error(
						colors.error(
							'--completions requires a shell name (bash, zsh, fish)',
						),
					)
					process.exit(1)
				}
				const script = generateCompletionScript(
					shell,
					this.options.name,
				)
				if (!script) {
					console.error(
						colors.error(
							`Unknown shell: ${shell}. Supported: bash, zsh, fish`,
						),
					)
					process.exit(1)
				}
				console.log(script)
				return
			}
			// Otherwise fall through - will be treated as command flag
		}

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
				showHelp(this.options, commandPath, router)
				process.exit(1)
			}
			if (parsed.flags.schema) {
				console.log(colors.error("Invalid argument '--schema'"))
				console.log()
				showHelp(this.options, commandPath, router)
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
				showHelp(this.options, commandPath, router)
				process.exit(commandPath.length === 0 ? 0 : 1)
			}
		}

		// Find handler
		const handler = findHandler(
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
		const inputParams = commandDef.input
			? extractInputParamsDetailed(commandDef.input)
			: []
		const inputFieldNames = new Set(inputParams.map((p) => p.name))
		const allowSystemInput = !inputFieldNames.has('input')

		const { flagsWithoutInput, inputFlag } = allowSystemInput
			? this.extractInputFlag(parsed.flags)
			: { flagsWithoutInput: parsed.flags, inputFlag: undefined }
		if (allowSystemInput && inputFlag !== undefined) {
			this.assertJsonInputUsage(flagsWithoutInput, remaining)
		}
		let input = this.buildInput(flagsWithoutInput, remaining, commandDef.args)
		if (allowSystemInput && inputFlag !== undefined) {
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
				showValidationError(this.options.name, commandPath, command, errorFields, errorMessages)
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

		try {
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
		} catch (error) {
			console.error(colors.error(formatRuntimeError(error)))
			process.exit(1)
		}
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

	private buildInput(
		flags: Record<string, unknown>,
		positionals: string[],
		argDefs?: { name: string }[],
	): Record<string, unknown> {
		const input: Record<string, unknown> = { ...flags }

		if (argDefs) {
			for (let i = 0; i < argDefs.length; i++) {
				const argName = argDefs[i]!.name
				const isVariadic = argName.endsWith('...')
				const normalized = normalizeArgName(argName)

				if (isVariadic) {
					if (i !== argDefs.length - 1) {
						console.log(
							colors.error('Invalid args: variadic argument must be last'),
						)
						process.exit(1)
					}
					input[normalized] = positionals.slice(i)
					return input
				}

				if (i < positionals.length) {
					input[normalized] = positionals[i]!
				}
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
				? await readStdin()
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
			parsed = JSON5.parse(raw)
		} catch {
			console.log(
				colors.error('Invalid JSON input (supports JSON/JSONC/JSON5)'),
			)
			process.exit(1)
		}

		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			console.log(colors.error('JSON input must be an object'))
			process.exit(1)
		}

		return parsed as Record<string, unknown>
	}

	private async readInputString(value: string): Promise<string> {
		if (value.startsWith('@')) {
			const path = expandHome(value.slice(1))
			if (!path) {
				console.log(colors.error('Invalid --input file path'))
				process.exit(1)
			}
			return await Bun.file(path).text()
		}
		return value
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
