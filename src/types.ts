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

export type CLIOptions<
	TGlobals extends Schema = Schema,
	TContext = undefined,
> = {
	name: string
	version: string
	description?: string
	schemaMaxLines?: number
	globals?: TGlobals
	context?: (
		globals: StandardSchemaV1.InferOutput<TGlobals>,
	) => TContext | Promise<TContext>
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

export type RunConfig<TSchema extends Router, TContext> = {
	handlers: Handlers<TSchema, TContext>
}

// ============ Utilities ============

export function isCommand(x: unknown): x is AnyCommand {
	return x !== null && typeof x === 'object' && '~argc' in x
}

// ============ Inference Helpers ============

/**
 * Infer all handler types from a schema.
 * Useful when handlers are split across multiple files.
 *
 * @example
 * ```ts
 * // schema.ts
 * export const schema = { get: c.meta(...).input(...), ... }
 * export type AppHandlers = InferHandlers<typeof schema>
 *
 * // commands/get.ts
 * import type { AppHandlers } from '../schema'
 * export const runGet: AppHandlers['get'] = ({ input }) => { ... }
 * ```
 */
export type InferHandlers<
	TSchema extends Router,
	TContext = unknown,
> = Handlers<TSchema, TContext>

/**
 * Infer the input type for a specific command path.
 *
 * @example
 * ```ts
 * type GetInput = InferInput<typeof schema, 'get'>
 * type UserCreateInput = InferInput<typeof schema, 'user.create'>
 * ```
 */
export type InferInput<
	TSchema extends Router,
	TPath extends string,
> = TSchema extends GroupDef<infer TChildren>
	? InferInputFromRouter<TChildren, TPath>
	: TSchema extends CommandDef<infer TInput>
		? TPath extends ''
			? StandardSchemaV1.InferOutput<TInput>
			: never
		: TSchema extends { [key: string]: Router }
			? InferInputFromRouter<TSchema, TPath>
			: never

// Helper: navigate through a plain router object
type InferInputFromRouter<
	TRouter extends { [key: string]: Router },
	TPath extends string,
> = TPath extends `${infer Head}.${infer Tail}`
	? Head extends keyof TRouter
		? TRouter[Head] extends Router
			? InferInput<TRouter[Head], Tail>
			: never
		: never
	: TPath extends keyof TRouter
		? TRouter[TPath] extends CommandDef<infer TInput>
			? StandardSchemaV1.InferOutput<TInput>
			: TRouter[TPath] extends GroupDef
				? never // Group needs subcommand
				: never
		: never

/**
 * Infer the handler function type for a specific command path.
 *
 * @example
 * ```ts
 * type GetHandler = InferHandler<typeof schema, 'get'>
 * export const runGet: GetHandler = ({ input }) => { ... }
 * ```
 */
export type InferHandler<
	TSchema extends Router,
	TPath extends string,
	TContext = unknown,
> = Handler<InferInput<TSchema, TPath>, TContext>

/**
 * Flatten nested handlers to dot-notation paths.
 *
 * @example
 * ```ts
 * type AppHandlers = FlatHandlers<typeof app.Handlers>
 * const runGet: AppHandlers['user.get'] = ...  // instead of ['user']['get']
 * ```
 */
export type FlatHandlers<T, Prefix extends string = ''> = T extends Handler<
	infer I,
	infer C
>
	? { [K in Prefix]: Handler<I, C> }
	: {
			[K in keyof T & string]: FlatHandlers<
				T[K],
				Prefix extends '' ? K : `${Prefix}.${K}`
			>
		}[keyof T & string]

// Convert union to intersection: { a: 1 } | { b: 2 } → { a: 1 } & { b: 2 }
type UnionToIntersection<U> = (
	U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
	? I
	: never

// Merge intersection into single object type
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Flatten nested handlers to dot-notation paths (as single object type).
 *
 * @example
 * ```ts
 * export type AppHandlers = FlattenHandlers<typeof app.Handlers>
 *
 * // commands/get.ts
 * const runGet: AppHandlers['user.get'] = ({ input, context }) => { ... }
 * ```
 */
export type FlattenHandlers<T> = Simplify<UnionToIntersection<FlatHandlers<T>>>

/**
 * Combined handlers: both nested access and dot-notation paths.
 *
 * @example
 * ```ts
 * type AppHandlers = typeof app.Handlers
 *
 * // Dot-notation for single handlers
 * const runGet: AppHandlers['user.get'] = ...
 *
 * // Nested access for handler groups
 * const userHandlers: AppHandlers['user'] = { get: ..., create: ... }
 * ```
 */
export type CombinedHandlers<T> = T & FlattenHandlers<T>
