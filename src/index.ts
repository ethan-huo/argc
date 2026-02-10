export { CLI, cli } from './cli'
export { complete, generateCompletionScript } from './complete'
export type { CompletionContext } from './complete'
export { c, CommandBuilder, group, GroupBuilder } from './command'
export { parseArgv } from './parser'
export { generateSchema, generateSchemaHintExample, generateSchemaOutline } from './schema'
export type {
	AnyCommand,
	AnyGroup,
	ArgDef,
	CLIOptions,
	CombinedHandlers,
	CommandDef,
	CommandMeta,
	FlattenHandlers,
	GroupDef,
	GroupMeta,
	Handler,
	HandlerMeta,
	HandlerOptions,
	Handlers,
	InferHandler,
	InferHandlers,
	InferInput,
	Router,
	RunConfig,
	Schema,
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from './types'
