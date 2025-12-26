import type { StandardSchemaV1 } from '@standard-schema/spec'

// ============ Schema Types ============

export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<
	TInput,
	TOutput
>

export type AnySchema = Schema<unknown, unknown>

export type InferInput<T> = T extends Schema<infer I, unknown> ? I : never
export type InferOutput<T> = T extends Schema<unknown, infer O> ? O : never

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

export type CommandDef<TInput extends AnySchema = AnySchema> = {
	'~argc': {
		input?: TInput
		meta: CommandMeta
		args?: ArgDef[]
	}
}

export type AnyCommand = CommandDef<AnySchema>

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

export type CLIOptions<
	TGlobals extends AnySchema = Schema<Record<string, never>>,
> = {
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
		? Handler<InferOutput<TInput>, TContext>
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
	TContract extends Router,
	TGlobals extends AnySchema,
	TContext,
> = {
	context?: (globals: InferOutput<TGlobals>) => TContext | Promise<TContext>
	handlers: Handlers<
		TContract,
		unknown extends TContext ? InferOutput<TGlobals> : TContext
	>
}

// ============ Utilities ============

export function isCommand(x: unknown): x is AnyCommand {
	return x !== null && typeof x === 'object' && '~argc' in x
}
