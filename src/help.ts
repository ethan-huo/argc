import type { AnyCommand, Router, Schema } from './types'
import { isCommand, isGroup } from './types'
import { fmt as colors, padEnd } from './terminal'
import { extractInputParamsDetailed, getInputTypeHint } from './schema'
import { getRouterChildren } from './router'

export function normalizeArgName(name: string): string {
	return name.endsWith('...') ? name.slice(0, -3) : name
}

export function getArgInfo(
	args?: { name: string }[],
): { names: Set<string>; display: Map<string, string> } {
	const names = new Set<string>()
	const display = new Map<string, string>()
	for (const arg of args ?? []) {
		const normalized = normalizeArgName(arg.name)
		names.add(normalized)
		display.set(normalized, arg.name)
	}
	return { names, display }
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

function getRouterDescription(router: Router): string {
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

export function showHelp(
	options: { name: string; version: string; description?: string; globals?: Schema },
	commandPath: string[],
	router: Router,
): void {
	const { name, version, description } = options
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
		const argInfo = getArgInfo(args)

		// Extract input params with descriptions
		const inputParams = input ? extractInputParamsDetailed(input) : []
		const inputFieldNames = new Set(inputParams.map((p) => p.name))

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
				const paramInfo = inputParams.find(
					(p) => p.name === normalizeArgName(arg.name),
				)
				const desc = arg.description ?? paramInfo?.description ?? ''
				console.log(
					`  ${colors.arg(arg.name.padEnd(16))} ${colors.dim(desc)}`,
				)
			}
		}

		// Options (non-positional input params)
		const optionsList = inputParams.filter((p) => !argInfo.names.has(p.name))
		if (optionsList.length > 0) {
			console.log()
			console.log(colors.bold('Options:'))
			for (const opt of optionsList) {
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

		if (inputParams.length > 0 && !inputFieldNames.has('input')) {
			console.log()
			console.log(colors.bold('Input:'))
			const inputType = input ? getInputTypeHint(input) : 'object'
			console.log(
				`  ${colors.option(`--input <${inputType}>`.padEnd(24))} ${colors.dim('Read command input from JSON string or stdin')}`,
			)
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
			const desc = getRouterDescription(value)
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
	if (options.globals) {
		const globalParams = extractInputParamsDetailed(options.globals)
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
	console.log(
		`  ${colors.option('--eval <code>'.padEnd(24))} ${colors.dim('Run a script block (gets handlers API)')}`,
	)
	console.log(
		`  ${colors.option('--script <file>'.padEnd(24))} ${colors.dim('Run a script file (gets handlers API)')}`,
	)
	console.log(
		`  ${colors.option('--completions <shell>'.padEnd(24))} ${colors.dim('Generate shell completion script (bash, zsh, fish)')}`,
	)
}

export function showValidationError(
	appName: string,
	commandPath: string[],
	command: AnyCommand,
	errorFields: Set<string>,
	errorMessages: Record<string, string>,
): void {
	const args = command['~argc'].args ?? []
	const input = command['~argc'].input
	const argInfo = getArgInfo(args)
	const inputParams = input ? extractInputParamsDetailed(input) : []

	// Build usage line
	const cmdName =
		commandPath.length > 0
			? `${appName} ${commandPath.join(' ')}`
			: appName
	const argParts = args.map((a) => `<${a.name}>`)
	const hasOptions = inputParams.some((p) => !argInfo.names.has(p.name))
	const optionsPart = hasOptions ? '[options]' : ''
	const usageLine = [cmdName, ...argParts, optionsPart]
		.filter(Boolean)
		.join(' ')

	console.error(`${colors.bold('Usage:')} ${colors.command(usageLine)}`)
	console.error()

	const orderedFields: string[] = []
	for (const arg of args)
		orderedFields.push(normalizeArgName(arg.name))
	for (const param of inputParams) {
		if (!argInfo.names.has(param.name)) orderedFields.push(param.name)
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

		const display = argInfo.display.get(field)
		const label = display ? `<${display}>` : `--${field}`
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
