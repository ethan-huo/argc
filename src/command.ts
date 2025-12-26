import type {
	AnySchema,
	ArgDef,
	CommandDef,
	CommandMeta,
	GroupDef,
	GroupMeta,
	Router,
	Schema,
} from './types'

type CommandBuilderDef<TInput extends AnySchema> = CommandDef<TInput>['~argc']

export class CommandBuilder<
	TInput extends AnySchema = Schema<unknown>,
> implements CommandDef<TInput> {
	'~argc': CommandBuilderDef<TInput>

	constructor(def: Partial<CommandBuilderDef<TInput>> = {}) {
		this['~argc'] = {
			meta: {},
			...def,
		} as CommandBuilderDef<TInput>
	}

	input<T extends AnySchema>(schema: T): CommandBuilder<T> {
		return new CommandBuilder({
			...this['~argc'],
			input: schema,
		})
	}

	meta(meta: CommandMeta): CommandBuilder<TInput> {
		return new CommandBuilder({
			...this['~argc'],
			meta: { ...this['~argc'].meta, ...meta },
		})
	}

	args(...args: (string | ArgDef)[]): CommandBuilder<TInput> {
		return new CommandBuilder({
			...this['~argc'],
			args: args.map((a) => (typeof a === 'string' ? { name: a } : a)),
		})
	}
}

export const c = new CommandBuilder()

// Group builder for defining command groups with metadata
export class GroupBuilder<
	TChildren extends { [key: string]: Router } = Record<string, never>,
> implements GroupDef<TChildren> {
	'~argc.group': GroupDef<TChildren>['~argc.group']

	constructor(meta: GroupMeta = {}, children: TChildren = {} as TChildren) {
		this['~argc.group'] = { meta, children }
	}

	meta(meta: GroupMeta): GroupBuilder<TChildren> {
		return new GroupBuilder(
			{ ...this['~argc.group'].meta, ...meta },
			this['~argc.group'].children,
		)
	}

	children<T extends { [key: string]: Router }>(children: T): GroupBuilder<T> {
		return new GroupBuilder(this['~argc.group'].meta, children)
	}
}

export function group<T extends { [key: string]: Router }>(
	meta: GroupMeta,
	children: T,
): GroupDef<T> {
	return new GroupBuilder(meta, children)
}

export const g = new GroupBuilder()
