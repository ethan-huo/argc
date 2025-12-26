import type {
	StandardJSONSchemaV1,
	StandardSchemaV1,
} from '@standard-schema/spec'

// Re-export Standard Schema types
export type { StandardJSONSchemaV1, StandardSchemaV1 }

// Schema type: validation + JSON Schema generation
// This is what argc requires - a schema that can both validate AND generate JSON Schema
export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<
	TInput,
	TOutput
> &
	StandardJSONSchemaV1<TInput, TOutput>

// ============ Command Types ============

export type CommandMeta = {
	description?: string
	examples?: string[]
	aliases?: string[]
	deprecated?: boolean
	hidden?: boolean
}

export type ArgDef = {
	name: string
	description?: string
}

export type CommandDef<TInput extends Schema = Schema> = {
	'~argc': {
		input?: TInput
		meta: CommandMeta
		args?: ArgDef[]
	}
}

export type AnyCommand = CommandDef<Schema>

// ============ Group Types ============

export type GroupMeta = {
	description?: string
	hidden?: boolean
}

export type GroupDef<
	TChildren extends { [key: string]: Router } = { [key: string]: Router },
> = {
	'~argc.group': {
		meta: GroupMeta
		children: TChildren
	}
}

export type AnyGroup = GroupDef<{ [key: string]: Router }>

export function isGroup(x: unknown): x is AnyGroup {
	return x !== null && typeof x === 'object' && '~argc.group' in x
}

// ============ Router Types ============

export type Router = AnyCommand | AnyGroup | { [key: string]: Router }

// ============ CLI Options ============

export type CLIOptions<TGlobals extends Schema = Schema> = {
	name: string
	version: string
	description?: string
	globals?: TGlobals
}

// ============ Handler Types ============

export type HandlerMeta = {
	path: string[]
	command: string
	raw: string[]
}

export type HandlerOptions<TInput, TContext> = {
	input: TInput
	context: TContext
	meta: HandlerMeta
}

export type Handler<TInput, TContext> = (
	options: HandlerOptions<TInput, TContext>,
) => void | Promise<void>

// Recursive handler type matching router structure
export type Handlers<T extends Router, TContext> =
	T extends CommandDef<infer TInput>
		? Handler<StandardSchemaV1.InferOutput<TInput>, TContext>
		: T extends GroupDef<infer TChildren>
			? {
					[K in keyof TChildren]: TChildren[K] extends Router
						? Handlers<TChildren[K], TContext>
						: never
				}
			: {
					[K in keyof T]: T[K] extends Router ? Handlers<T[K], TContext> : never
				}

// ============ Run Config ============

export type RunConfig<
	TSchema extends Router,
	TGlobals extends Schema,
	TContext,
> = {
	context?: (
		globals: StandardSchemaV1.InferOutput<TGlobals>,
	) => TContext | Promise<TContext>
	handlers: Handlers<
		TSchema,
		unknown extends TContext ? StandardSchemaV1.InferOutput<TGlobals> : TContext
	>
}

// ============ Utilities ============

export function isCommand(x: unknown): x is AnyCommand {
	return x !== null && typeof x === 'object' && '~argc' in x
}
