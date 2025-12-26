export { CLI, cli } from './cli'
export { colors } from './colors'
export { c, CommandBuilder, g, group, GroupBuilder } from './command'
export { parseArgv } from './parser'
export { generateSchema } from './schema'
export { isCommand, isGroup } from './types'
export type {
	AnyCommand,
	AnyGroup,
	AnySchema,
	ArgDef,
	CLIOptions,
	CommandDef,
	CommandMeta,
	GroupDef,
	GroupMeta,
	Handler,
	HandlerMeta,
	HandlerOptions,
	Handlers,
	InferInput,
	InferOutput,
	Router,
	RunConfig,
	Schema,
} from './types'
