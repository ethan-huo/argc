import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import type { SchemaExplorer } from './schema-explorer';
export type { StandardJSONSchemaV1, StandardSchemaV1 };
export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput> & StandardJSONSchemaV1<TInput, TOutput>;
export type CommandMeta = {
    description?: string;
    examples?: string[];
    deprecated?: boolean;
    hidden?: boolean;
};
export type CommandDef<TInput extends Schema = Schema> = {
    '~argc': {
        input?: TInput;
        meta: CommandMeta;
        positionals: string[];
    };
};
export type AnyCommand = CommandDef<Schema>;
export type GroupMeta = {
    description?: string;
    hidden?: boolean;
};
export type GroupDef<TChildren extends {
    [key: string]: Router;
} = {
    [key: string]: Router;
}> = {
    '~argc.group': {
        meta: GroupMeta;
        children: TChildren;
    };
};
export type AnyGroup = GroupDef<{
    [key: string]: Router;
}>;
export declare function isGroup(x: unknown): x is AnyGroup;
export type Router = AnyCommand | AnyGroup | {
    [key: string]: Router;
};
export type ContextOutput<TContext extends Schema | undefined> = TContext extends Schema ? StandardSchemaV1.InferOutput<TContext> : undefined;
export type CLIOptions<TContext extends Schema | undefined = undefined> = {
    name: string;
    version: string;
    description?: string;
    schemaExplorer?: SchemaExplorer;
    context?: TContext;
    run?: boolean;
    hook?: false | HookTransport;
    hookTimeoutMs?: number;
};
export type HandlerMeta = {
    path: string[];
    command: string;
    raw: string[];
    callId: string;
};
export type HandlerOptions<TInput, TContext> = {
    input: TInput;
    context: TContext;
    meta: HandlerMeta;
    emit: (data: unknown) => void;
};
export type Handler<TInput, TContext> = (options: HandlerOptions<TInput, TContext>) => unknown | Promise<unknown>;
export type Handlers<T extends Router, TContext extends Schema | undefined> = T extends CommandDef<infer TInput> ? Handler<StandardSchemaV1.InferOutput<TInput>, ContextOutput<TContext>> : T extends GroupDef<infer TChildren> ? {
    [K in keyof TChildren]: TChildren[K] extends Router ? Handlers<TChildren[K], TContext> : never;
} : {
    [K in keyof T]: T[K] extends Router ? Handlers<T[K], TContext> : never;
};
export type RunConfig<TSchema extends Router, TContext extends Schema | undefined> = {
    handlers: Handlers<TSchema, TContext>;
};
export type HookErrorData = {
    name?: string;
    message: string;
};
export type HookEndData = {
    duration: number;
    ok: boolean;
};
type HookEventBase = {
    callId: string;
    seq: number;
    app: string;
    command: string;
    path: string[];
    at: number;
};
export type HookEvent = (HookEventBase & {
    kind: 'call';
    data: null;
}) | (HookEventBase & {
    kind: 'call.emit';
    data: unknown;
}) | (HookEventBase & {
    kind: 'call.error';
    data: HookErrorData;
}) | (HookEventBase & {
    kind: 'call.end';
    data: HookEndData;
});
export type HookTransport = (events: HookEvent[]) => void | Promise<void>;
export declare function isCommand(x: unknown): x is AnyCommand;
export type InferHandlers<TSchema extends Router, TContext extends Schema | undefined = undefined> = Handlers<TSchema, TContext>;
export type InferInput<TSchema extends Router, TPath extends string> = TSchema extends GroupDef<infer TChildren> ? InferInputFromRouter<TChildren, TPath> : TSchema extends CommandDef<infer TInput> ? TPath extends '' ? StandardSchemaV1.InferOutput<TInput> : never : TSchema extends {
    [key: string]: Router;
} ? InferInputFromRouter<TSchema, TPath> : never;
type InferInputFromRouter<TRouter extends {
    [key: string]: Router;
}, TPath extends string> = TPath extends `${infer Head}.${infer Tail}` ? Head extends keyof TRouter ? TRouter[Head] extends Router ? InferInput<TRouter[Head], Tail> : never : never : TPath extends keyof TRouter ? TRouter[TPath] extends CommandDef<infer TInput> ? StandardSchemaV1.InferOutput<TInput> : TRouter[TPath] extends GroupDef ? never : never : never;
export type InferHandler<TSchema extends Router, TPath extends string, TContext extends Schema | undefined = undefined> = Handler<InferInput<TSchema, TPath>, ContextOutput<TContext>>;
export type FlatHandlers<T, Prefix extends string = ''> = T extends Handler<infer I, infer C> ? {
    [K in Prefix]: Handler<I, C>;
} : {
    [K in keyof T & string]: FlatHandlers<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
}[keyof T & string];
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;
type Simplify<T> = {
    [K in keyof T]: T[K];
} & {};
export type FlattenHandlers<T> = Simplify<UnionToIntersection<FlatHandlers<T>>>;
export type CombinedHandlers<T> = T & FlattenHandlers<T>;
