# argc

Schema-first CLI framework for Bun. Define typed commands once, get validated
handlers, predictable stdout, and an agent-readable `@schema`.

## Install

```bash
bun add github:ethan-huo/argc#v7.2.0
```

Use release tags for downstream projects. `main` is the source branch and does
not commit generated declaration files; tags include `dist/*.d.ts`.

## Quick Start

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli, group } from 'argc'

const s = toStandardJsonSchema

const commands = {
	user: group(
		{ description: 'User management' },
		{
			create: c
				.meta({
					description: 'Create a user',
					examples: ['myapp user.create "{ name: \'alice\' }"'],
				})
				.input(
					s(
						v.object({
							name: v.pipe(v.string(), v.minLength(2)),
							role: v.optional(v.string(), 'member'),
						}),
					),
				),
		},
	),
}

const app = cli(commands, {
	name: 'myapp',
	version: '7.2.0',
	description: 'Example argc CLI',
})

await app.run({
	handlers: {
		'user.create': ({ input }) => ({
			ok: true,
			user: input,
		}),
	},
})
```

```bash
$ myapp user.create "{ name: 'alice', role: 'admin' }"
ok: true
user:
  name: alice
  role: admin
```

## Command Shape

argc 7 is a clean-break typed command surface:

- Commands are addressed by dotted path: `myapp user.create`
- Input is one quoted object literal token: `"{ name: 'alice' }"`
- Large input can come from a file or stdin: `@payload.json` or `-`
- `@schema`, `@run`, and `@completions` are builtins
- `--help` and `--version` are the only direct global flags
- Handler return values are serialized to stdout
- Handler logs (`console.log` / `process.stdout`) are redirected to stderr

There are no command aliases, `.args()`, input flags, `--input`, `--schema`,
`--run`, global transforms, or compatibility shims for the v1 surface.

## Input

Quote object literal input so the shell passes it as one argv token:

```bash
myapp user.create "{ name: 'alice', tags: ['admin', 'dev'] }"
```

Use files for reusable payloads:

```bash
myapp user.create @payload.json
```

Use stdin when another process generates the payload:

```bash
printf "{ name: 'alice' }" | myapp user.create -
```

Bare braces are rejected because the shell splits them before argc can parse the
payload.

## Context

Define process context with `CLIOptions.context`. It is validated verbatim and
injected into handlers as `context`.

```typescript
const app = cli(commands, {
	name: 'myapp',
	version: '7.2.0',
	context: s(
		v.object({
			token: v.string(),
		}),
	),
})
```

Pass context with `--context` or `ARGC_CTX`:

```bash
myapp user.create "{ name: 'alice' }" --context "{ token: 'secret' }"
ARGC_CTX="{ token: 'secret' }" myapp user.create "{ name: 'alice' }"
```

## Output

Default output is YAML. Strings print as raw text, `undefined` prints nothing,
and structured values use block-style YAML.

```typescript
handlers: {
	'user.create': ({ input }) => ({
		created: input.name,
		next: ['myapp user.get "{ name: \'alice\' }"'],
	}),
}
```

Use `@run --json` when scripting needs strict JSON.

Errors are YAML envelopes on stderr with stable error codes:

```yaml
error: UNKNOWN_KEY
message: Unknown input key: nam
issues:
  - path: nam
    message: Unknown input key
```

## Agent Schema

`@schema` is the agent-facing contract:

```bash
myapp @schema
myapp @schema .user.create
myapp @schema .user.create.input
```

Schema output is TypeScript-like and includes quoted object literal examples. Command
and group keys must be valid JavaScript identifiers and cannot start with `@`.
Input field names come from domain data and may be non-identifiers; `@schema`
quotes them when needed:

```typescript
type Input = {
	'content-type'?: string
}
```

## Scripting

`@run` executes small agent-authored scripts against typed command handlers:

```bash
myapp @run "const user = await user.create({ name: 'alice' }); user" --json
```

Inline scripts expose command locals (`user.create`) plus `argc`. File scripts
receive only `argc` to avoid accidental identifier collisions:

```typescript
// script.ts
export default async function main(argc) {
	return argc.commands.user.create({ name: 'alice' })
}
```

```bash
myapp @run @script.ts --json
```

`run: false` disables `@run`.

## Handlers

Handlers can be flat or nested:

```typescript
await app.run({
	handlers: {
		'user.create': ({ input, context }) => ({ input, context }),
	},
})

await app.run({
	handlers: {
		user: {
			create: ({ input }) => input,
		},
	},
})
```

Type split handler modules with `typeof app.Handlers`.

## Completions

Install generated shell completions with:

```bash
myapp @completions zsh
myapp @completions bash
myapp @completions fish
```

Completions are path-oriented and include builtins. They do not complete input
object keys as shell flags because command input is a single structured value.
