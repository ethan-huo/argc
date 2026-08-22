import type { CommandDef, CommandMeta, GroupDef, GroupMeta, Router, Schema } from './types';
type CommandBuilderDef<TInput extends Schema> = CommandDef<TInput>['~argc'];
export declare class CommandBuilder<TInput extends Schema = Schema> implements CommandDef<TInput> {
    '~argc': CommandBuilderDef<TInput>;
    constructor(def?: Partial<CommandBuilderDef<TInput>>);
    input<T extends Schema>(schema: T): CommandBuilder<T>;
    meta(meta: CommandMeta): CommandBuilder<TInput>;
    positional(...names: string[]): CommandBuilder<TInput>;
}
export declare const c: CommandBuilder<Schema>;
export declare class GroupBuilder<TChildren extends {
    [key: string]: Router;
} = Record<string, never>> implements GroupDef<TChildren> {
    '~argc.group': GroupDef<TChildren>['~argc.group'];
    constructor(meta?: GroupMeta, children?: TChildren);
    meta(meta: GroupMeta): GroupBuilder<TChildren>;
    children<T extends {
        [key: string]: Router;
    }>(children: T): GroupBuilder<T>;
}
export declare function group<T extends {
    [key: string]: Router;
}>(meta: GroupMeta, children: T): GroupDef<T>;
export {};
