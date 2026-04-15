# argc

Schema-first CLI framework for Bun. Define once, get type-safe handlers + AI-readable schema.

## Features

- **Schema-first** - Your schema IS the CLI definition
- **Transform inputs** - Convert strings to rich objects (`Bun.file()`, dates, etc.)
- **Arrays & Objects** - `--tag a --tag b` and `--db.host localhost` syntax
- **AI-native schema** - `--schema` outputs TypeScript-like types, compact outlines, and jq-like selectors
- **Hook events** - Handlers can emit structured events for agent runtimes and UIs
- **Command aliases** - `ls, list` style display
- **Nested groups** - Unlimited depth (`deploy aws lambda`)
- **Lazy validation** - Transform only runs for executed command
- **Global → Context** - Transform globals into injected context
- **Zero runtime deps** - only `@standard-schema/spec` as peer

## Install

```bash
bun add github:ethan-huo/argc
```

## Quick Start

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

import { c, cli } from 'argc'

const s = toStandardJsonSchema

const schema = {
	greet: c.meta({ description: 'Greet someone' }).input(
		s(
			v.object({
				name: v.pipe(v.string(), v.minLength(2)),
				loud: v.optional(v.boolean(), false),
			}),
		),
	),
}

cli(schema, { name: 'hello', version: '1.0.0' }).run({
	handlers: {
		greet: ({ input }) => {
			const msg = `Hello, ${input.name}!`
			console.log(input.loud ? msg.toUpperCase() : msg)
		},
	},
})
```

```bash
$ hello greet --name world --loud
HELLO, WORLD!
```

### Positional Arguments (use sparingly)

Prefer `input()` flags for agent-friendly schemas. Use positional args only when they make the CLI clearer for humans. Positional args are always required. For optional parameters, use flags or `--input`.

```typescript
const schema = {
	env: c
		.meta({ description: 'Set an env var' })
		.args('key', 'value')
		.input(
			s(
				v.object({
					key: v.string(),
					value: v.string(),
				}),
			),
		),
}
```

```bash
$ myapp env API_KEY secret
```

Variadic positional args are supported by adding `...` to the last arg name:

```typescript
const schema = {
	join: c
		.meta({ description: 'Join files' })
		.args('files...')
		.input(s(v.object({ files: v.array(v.string()) }))),
}
```

```bash
$ myapp join a.txt b.txt c.txt
```

Note: `...` must be used on the last positional argument.

## Transform: Schema Superpowers

The killer feature. Your schema transforms CLI strings into rich objects:

Explicit flag values stay as strings until your schema transforms them. The only built-in exception is boolean flag presence: `--flag` becomes `true`, and `--no-flag` becomes `false`.

```typescript
const schema = {
  seed: c
    .meta({ description: 'Seed database from file' })
    .input(s(v.object({
      file: v.pipe(
        v.string(),
        v.endsWith('.json'),
        v.transform((path) => Bun.file(path).json()),  // string → Promise<object>
      ),
    }))),
}

// Handler receives the transformed value
handlers: {
  seed: async ({ input }) => {
    const data = await input.file  // Already parsed JSON!
    console.log('Seeding:', data)
  },
}
```

```bash
$ myapp seed --file ./data.json
Seeding: { users: [...], products: [...] }
```

More transform examples:

```typescript
// String → number for CLI flags
port: v.pipe(
	v.string(),
	v.transform((s) => Number(s)),
	v.number(),
)

// String → Date
startDate: v.pipe(
	v.string(),
	v.transform((s) => new Date(s)),
)

// String → URL with validation
endpoint: v.pipe(
	v.string(),
	v.url(),
	v.transform((s) => new URL(s)),
)

// String → Glob patterns
pattern: v.pipe(
	v.string(),
	v.transform((p) => new Bun.Glob(p)),
)
```

## Arrays & Nested Objects

Define complex types in your schema - argc handles the CLI input automatically.

**Arrays** - repeat the flag:

```typescript
c.input(
	s(
		v.object({
			tags: v.array(v.string()),
		}),
	),
)
```

```bash
$ myapp create --tags admin --tags dev
# input.tags = ['admin', 'dev']
```

**Nested objects** - use dot notation:

```typescript
c.input(
	s(
		v.object({
			db: v.object({
				host: v.string(),
				port: v.pipe(
					v.string(),
					v.transform((s) => Number(s)),
					v.number(),
				),
			}),
		}),
	),
)
```

```bash
$ myapp connect --db.host localhost --db.port 5432
# input.db = { host: 'localhost', port: 5432 }
```

Help output shows usage hints:

```
--tags <string[]>                    (repeatable)
--db <{ host: string, port: string }>  (use --db.<key>)
```

## JSON Input

Commands can accept a full JSON object via `--input` (useful for agents or generated payloads).

```bash
$ myapp user set --input '{"name":"alice","role":"admin"}'
```

You can also load JSON from a file:

```bash
$ myapp user set --input @payload.json
```

You can also pipe JSON from stdin:

```bash
$ echo '{"name":"alice","role":"admin"}' | myapp user set --input
```

`--input` also accepts JSONC/JSON5 (comments, trailing commas, single quotes, unquoted keys, `Infinity`, `.5`, etc.):

```bash
$ myapp user set --input "{ name: 'alice', /* comment */ role: 'admin', }"
```

When using `--input`, do not pass other command flags or positionals (global options are still allowed).

## Scripting Mode

You can run code against your CLI handlers via a global flag:

- `--run "..."` treats the value as inline code
- `--run @./file.ts` treats the value as a module file
- `--run` or `--run -` reads code from stdin

```bash
# Inline block
$ myapp --run "await argc.handlers.user.create({ name: 'alice' })"

# Module file (TS/JS)
$ myapp --run @./scripts/seed.ts

# Read code from stdin
$ cat ./scripts/seed-snippet.js | myapp --run

# Explicit stdin
$ myapp --run -
```

The script receives an `argc` object with:

- `argc.handlers` - your handlers as functions, matching your schema shape
- `argc.call` - flat map (`'user.create' -> fn`)
- `argc.globals` - validated global options
- `argc.args` - extra positionals passed to the script (use `--` to pass through values that look like flags)

Notes:

- Scripts do not receive `context` directly; they can only call handlers.
- `--run @file` modules can export either `default` or `main`:
  - `export default async function (argc) { ... }`
  - `export async function main(argc) { ... }`
- For `--run @file`, `argc` is also available as `globalThis.__argcRun` for modules that run via side effects.

Example passing args:

```bash
$ myapp --run @./scripts/batch.ts -- user1 user2 user3
```

## AI Agent Integration

Run `--schema` to get a TypeScript-like type definition:

```bash
$ myapp --schema
```

```
CLI Syntax:
  arrays:  --tag a --tag b             → tag: ["a", "b"]
  objects: --user.name x --user.age 1  → user: { name: "x", age: 1 }

My CLI app

type Myapp = {
  // Global options available to all commands
  $globals: { verbose?: boolean = false }

  // User management
  user: {
    // List all users
    list(all?: boolean = false, format?: "json" | "table" = "table")
    // Create a new user
    // $ myapp user create --name john --email john@example.com
    create(name: string, email?: string)
  }
}
```

If the schema is large (>`schemaMaxLines`, default 100), `--schema` prints a compact outline and hints for exploration.

Use jq-like selectors to narrow the output:

| Pattern  | Meaning           | Example                   |
| -------- | ----------------- | ------------------------- |
| `.name`  | Navigate to child | `--schema=.user.create`   |
| `.*`     | All children      | `--schema=.user.*`        |
| `.{a,b}` | Specific children | `--schema=.{user,deploy}` |
| `..name` | Recursive search  | `--schema=..create`       |

Patterns compose: `--schema=.deploy..lambda`, `--schema=.*.list`

## Hook Events for Agent Runtimes

CLI stdout is for the agent reading the command result. Hook events are for the system around the agent: runtime logs, UI rendering, progress panels, audit trails, or tool-call replay.

Handlers receive an `emit(data)` function and a generated `meta.callId`:

```typescript
app.run({
	handlers: {
		migrate: async ({ input, emit, meta }) => {
			emit({ step: 'running', current: 0, total: input.steps })

			await runMigrations(input.steps)

			emit({ step: 'done', applied: input.steps, callId: meta.callId })
			console.log(`Migrated ${input.steps} steps`) // stdout is still for the agent
		},
	},
})
```

`emit()` is always available. If no hook transport is configured, it is a no-op. Use it when the handler knows something structured that stdout should not have to encode, such as progress, generated asset metadata, IDs, or preview payloads.

argc does **not** automatically send command input. Tool authors decide what is safe and useful to expose:

```typescript
// Good: explicit, minimal, safe
emit({ artifact: 'image', path: outputPath, width, height })

// Avoid: may leak prompts, tokens, file paths, or customer data
emit(input)
```

### Receiving Events

Agent runtimes can enable zero-config delivery with an env var:

```bash
ARGC_HOOK_URL=http://localhost:9090/events myapp image generate --prompt "..."
```

argc sends JSON batches with events like:

```json
[
	{
		"callId": "01JSD9Y7N4J3W2V5Z8QK6M1R0A",
		"seq": 1,
		"app": "myapp",
		"command": "image generate",
		"path": ["image", "generate"],
		"kind": "call",
		"data": null,
		"at": 1760000000000
	},
	{
		"callId": "01JSD9Y7N4J3W2V5Z8QK6M1R0A",
		"seq": 2,
		"app": "myapp",
		"command": "image generate",
		"path": ["image", "generate"],
		"kind": "call.emit",
		"data": { "artifact": "image", "path": "./out.png" },
		"at": 1760000000015
	},
	{
		"callId": "01JSD9Y7N4J3W2V5Z8QK6M1R0A",
		"seq": 3,
		"app": "myapp",
		"command": "image generate",
		"path": ["image", "generate"],
		"kind": "call.end",
		"data": { "duration": 128, "ok": true },
		"at": 1760000000128
	}
]
```

Events are batched and delivered fire-and-forget. `seq` is monotonic within one `CLI.run()` dispatcher; consumers should group by `callId` and sort by `seq`.

You can override the env var with `CLIOptions.hook`:

```typescript
const app = cli(schema, {
	name: 'myapp',
	version: '1.0.0',
	hook: async (events) => {
		await sendToRuntime(events)
	},
	hookTimeoutMs: 2000, // default
})
```

Use `hook: false` to explicitly disable `ARGC_HOOK_URL` auto-observation for an app.

## Command Aliases

Define command aliases:

```typescript
list: c
  .meta({ description: 'List users', aliases: ['ls', 'l'] })
  .input(s(v.object({ ... })))
```

```bash
$ myapp user --help
Commands:
  ls, l, list    List users      # aliases shown first
  create         Create a user
```

Routing works automatically:

```bash
$ myapp user ls      # routes to 'list' handler
$ myapp user l       # routes to 'list' handler
$ myapp user list    # routes to 'list' handler
```

## Nested Command Groups

Unlimited nesting depth:

```typescript
const schema = {
  deploy: group({ description: 'Deployment' }, {
    aws: group({ description: 'AWS deployment' }, {
      lambda: c.meta({ description: 'Deploy to Lambda' }).input(...),
      s3: c.meta({ description: 'Deploy to S3' }).input(...),
    }),
    vercel: c.meta({ description: 'Deploy to Vercel' }).input(...),
  }),
}
```

```bash
$ myapp deploy aws lambda --region us-west-2
```

## Global Options → Context

Transform global options into a typed context available in all handlers:

```typescript
const app = cli(schema, {
	name: 'myapp',
	version: '1.0.0',
	globals: s(
		v.object({
			env: v.optional(v.picklist(['dev', 'staging', 'prod']), 'dev'),
			verbose: v.optional(v.boolean(), false),
		}),
	),
	// Transform globals into context (type inferred from return value)
	context: (globals) => ({
		env: globals.env,
		log: globals.verbose
			? (msg: string) => console.log(`[${globals.env}]`, msg)
			: () => {},
	}),
})

app.run({
	handlers: {
		deploy: ({ input, context }) => {
			context.log('Starting deployment...') // Only logs if --verbose
			// context.env is typed as 'dev' | 'staging' | 'prod'
		},
	},
})
```

```bash
$ myapp deploy --env prod --verbose
[prod] Starting deployment...
```

## Git-Style Unknown Command

Helpful suggestions for typos:

```bash
$ myapp usr
myapp: 'usr' is not a myapp command. See 'myapp --help'.

The most similar command is
        user
```

## API Reference

### `c` - Command Builder

```typescript
c.meta({
	description: 'Command description',
	aliases: ['alias1', 'alias2'],
	examples: ['myapp cmd --flag value'],
	deprecated: true, // shows warning
	hidden: true, // hides from help
})
	.args('positional1', 'positional2') // positional arguments (in order)
	.input(schema) // Standard JSON Schema (still required)
```

### `group()` - Command Group

```typescript
group({ description: 'Group description' }, {
  subcommand1: c.meta(...).input(...),
  subcommand2: c.meta(...).input(...),
  nested: group({ ... }, { ... }),  // can nest groups
})
```

### `cli()` - Create CLI

```typescript
const app = cli(schema, {
  name: 'myapp',          // required
  version: '1.0.0',       // required (shown with -v)
  description: 'My CLI',  // optional (shown in help)
  globals: globalsSchema, // optional (global options schema)
  context: (globals) => ({ ... }),  // optional: transform globals to context
  hook: (events) => { ... }, // optional: batch hook event transport
  hookTimeoutMs: 2000,    // optional: drain timeout for hook delivery (default: 2000)
  schemaMaxLines: 100,    // optional: --schema switches to outline above this (default: 100)
})

// Handler types inferred from app (includes context type)
type AppHandlers = typeof app.Handlers
```

### `.run()` - Execute

```typescript
app.run({
  handlers: { ... },  // required: type-safe command handlers
})
```

Each handler receives `{ input, context, meta, emit }`:

- `input` - validated command input (typed from schema)
- `context` - value returned by `context()` option (or `undefined`)
- `meta.path` - command path as array (`['user', 'create']`)
- `meta.command` - command path as string (`'user create'`)
- `meta.raw` - original argv before parsing
- `meta.callId` - generated ULID shared by hook events for this command call
- `emit(data)` - sends a structured `call.emit` hook event, or no-ops when no hook transport is configured

Handlers can be registered as nested objects or flat dot-notation:

```typescript
app.run({
  handlers: {
    // Nested
    user: {
      get: ({ input }) => { ... },
      create: ({ input }) => { ... },
    },
    // Flat (can mix with nested)
    'deploy.aws.lambda': ({ input }) => { ... },
  },
})
```

## Built-in Flags

| Flag                     | Scope         | Description                                     |
| ------------------------ | ------------- | ----------------------------------------------- |
| `-h, --help`             | Everywhere    | Show help                                       |
| `-v, --version`          | Root only     | Show version                                    |
| `--schema[=selector]`    | Root only     | Typed CLI spec for AI agents                    |
| `--input <json\|@file>`  | Command level | Pass input as JSON/JSON5 string, file, or stdin |
| `--run <code\|@file\|->` | Root only     | Run inline code, stdin, or a module file        |
| `--completions <shell>`  | Root only     | Generate shell completion script                |

## Shell Completions

Generate and install completion scripts:

```bash
# bash
myapp --completions bash > ~/.local/share/bash-completion/completions/myapp

# zsh
myapp --completions zsh > ~/.zfunc/_myapp  # ensure ~/.zfunc is in $fpath

# fish
myapp --completions fish > ~/.config/fish/completions/myapp.fish
```

## Schema Libraries

argc requires schemas that implement both `StandardSchemaV1` (validation) and `StandardJSONSchemaV1` (type introspection).

**Zod** and **ArkType** natively support Standard JSON Schema - no wrapper needed:

```typescript
// zod - works directly
import { z } from 'zod'
c.input(z.object({ name: z.string() }))

// arktype - works directly
import { type } from 'arktype'
c.input(type({ name: 'string' }))
```

**Valibot** requires a wrapper (to keep core bundle small):

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

const s = toStandardJsonSchema
c.input(s(v.object({ name: v.string() })))
```

## Handlers in Separate Files

When handlers are split across multiple files, use `typeof app.Handlers` to get type-safe handlers. Handler types support **both nested and dot-notation access**:

```typescript
// cli.ts
import { c, cli, group } from 'argc'

const schema = {
  user: group({ description: 'User management' }, {
    get: c.meta({ ... }).input(...),
    create: c.meta({ ... }).input(...),
  }),
  deploy: group({ description: 'Deployment' }, {
    aws: group({ description: 'AWS' }, {
      lambda: c.meta({ ... }).input(...),
    }),
  }),
}

export const app = cli(schema, {
  name: 'myapp',
  version: '1.0.0',
  context: (globals) => ({
    db: createDbConnection(),
    log: console.log,
  }),
})

// Handler types support both nested and dot-notation access
export type AppHandlers = typeof app.Handlers
```

```typescript
// commands/user-get.ts
import type { AppHandlers } from '../cli'

// Dot-notation for single handlers
export const runUserGet: AppHandlers['user.get'] = async ({ input, context }) => {
  context.log(input.key)  // fully typed
}

// Nested access for handler groups
export const userHandlers: AppHandlers['user'] = {
  get: async ({ input, context }) => { ... },
  create: async ({ input, context }) => { ... },
}

// Works for deeply nested commands too
export const runLambda: AppHandlers['deploy.aws.lambda'] = async ({ input, context }) => {
  // ...
}
```

For input types only, use `InferInput` with the same dot-notation:

```typescript
import type { InferInput } from 'argc'

type UserCreateInput = InferInput<typeof schema, 'user.create'>
type LambdaInput = InferInput<typeof schema, 'deploy.aws.lambda'>
```

## Complete Example

See full working example: [examples/demo.ts](./examples/demo.ts)

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as v from 'valibot'

import { c, cli, group } from 'argc'
import * as tables from './db/schema'

const s = toStandardJsonSchema

const schema = {
	user: group(
		{ description: 'User management' },
		{
			list: c.meta({ description: 'List users', aliases: ['ls'] }).input(
				s(
					v.object({
						format: v.optional(v.picklist(['json', 'table']), 'table'),
					}),
				),
			),

			create: c
				.meta({
					description: 'Create user',
					examples: ['myapp user create --name john --email john@example.com'],
				})
				.input(
					s(
						v.object({
							name: v.pipe(v.string(), v.minLength(3)),
							email: v.optional(v.pipe(v.string(), v.email())),
						}),
					),
				),
		},
	),

	db: group(
		{ description: 'Database operations' },
		{
			seed: c
				.meta({ description: 'Seed from JSON file' })
				.args('file')
				.input(
					s(
						v.object({
							file: v.pipe(
								v.string(),
								v.endsWith('.json'),
								v.transform((path) => Bun.file(path).json()),
							),
						}),
					),
				),
		},
	),
}

// Create app with context (type inferred from return value)
const app = cli(schema, {
	name: 'myapp',
	version: '1.0.0',
	globals: s(
		v.object({
			verbose: v.optional(v.boolean(), false),
		}),
	),
	context: (globals) => ({
		db: drizzle(postgres(process.env.DATABASE_URL!)),
		log: globals.verbose ? console.log : () => {},
	}),
})

// Handler types include context
export type AppHandlers = typeof app.Handlers

// Run with handlers only
app.run({
	handlers: {
		user: {
			list: async ({ input, context }) => {
				context.log('Listing users...')
				const users = await context.db.select().from(tables.users)
				console.log(input.format === 'json' ? JSON.stringify(users) : users)
			},
			create: async ({ input, context }) => {
				context.log('Creating user...')
				await context.db.insert(tables.users).values({
					name: input.name,
					email: input.email,
				})
				console.log('Created:', input.name)
			},
		},
		db: {
			seed: async ({ input, context }) => {
				const data = await input.file
				context.log('Seeding database...')
				await context.db.insert(tables.users).values(data.users)
				console.log('Seeded:', data.users.length, 'users')
			},
		},
	},
})
```

## License

MIT
