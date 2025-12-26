# argc

Schema-first CLI framework for Bun. Define once, get type-safe handlers + AI-readable schema.

## Features

- **Schema-first** - Your schema IS the CLI definition
- **Transform inputs** - Convert strings to rich objects (`Bun.file()`, dates, etc.)
- **Rust-style errors** - Precise error messages with `^` caret pointing to invalid fields
- **AI-friendly** - `--schema` outputs TypeScript-like type definitions
- **Command aliases** - `ls, list` style display like pnpm
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
  greet: c
    .meta({ description: 'Greet someone' })
    .args('name')
    .input(s(v.object({
      name: v.pipe(v.string(), v.minLength(2)),
      loud: v.optional(v.boolean(), false),
    }))),
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
$ hello greet world --loud
HELLO, WORLD!
```

## Transform: Schema Superpowers

The killer feature. Your schema transforms CLI strings into rich objects:

```typescript
const schema = {
  seed: c
    .meta({ description: 'Seed database from file' })
    .args('file')
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
$ myapp seed ./data.json
Seeding: { users: [...], products: [...] }
```

More transform examples:

```typescript
// String → Date
startDate: v.pipe(v.string(), v.transform((s) => new Date(s)))

// String → URL with validation
endpoint: v.pipe(v.string(), v.url(), v.transform((s) => new URL(s)))

// String → Glob patterns
pattern: v.pipe(v.string(), v.transform((p) => new Bun.Glob(p)))
```

## Arrays & Nested Objects

Define complex types in your schema - argc handles the CLI input automatically.

**Arrays** - repeat the flag:

```typescript
c.input(s(v.object({
  tags: v.array(v.string()),
})))
```

```bash
$ myapp create --tags admin --tags dev
# input.tags = ['admin', 'dev']
```

**Nested objects** - use dot notation:

```typescript
c.input(s(v.object({
  db: v.object({
    host: v.string(),
    port: v.number(),
  }),
})))
```

```bash
$ myapp connect --db.host localhost --db.port 5432
# input.db = { host: 'localhost', port: 5432 }
```

Help output shows usage hints:
```
--tags <string[]>                    (repeatable)
--db <{ host: string, port: number }>  (use --db.<key>)
```

## Rust-Style Error Messages

Precise errors that point exactly where validation failed:

```bash
$ myapp user create --name ab --email invalid
error: invalid arguments

   --name <string>
   ^ Invalid length: Expected >=3 but received 2
   --email <string>  user email
   ^ Invalid email: Received "invalid"
```

## AI Agent Integration

Run `--schema` to get a TypeScript-like type definition:

```bash
$ myapp --schema
```

```typescript
/** My CLI app */
type Myapp = {
  /** Global options available to all commands */
  $globals: { verbose?: boolean = false }

  /** User management */
  user: {
    /**
     * List all users
     */
    list(all?: boolean = false, format?: ('json' | 'table') = "table")
    /**
     * Create a new user
     * @example
     * myapp user create --name john --email john@example.com
     */
    create(name: string, email?: string)
  }
}
```

Feed this to any AI agent - it instantly understands your CLI structure.

## Command Aliases

Define aliases that display like pnpm:

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
cli(schema, {
  name: 'myapp',
  version: '1.0.0',
  globals: s(v.object({
    env: v.optional(v.picklist(['dev', 'staging', 'prod']), 'dev'),
    verbose: v.optional(v.boolean(), false),
  })),
}).run({
  // Transform globals into context
  context: (globals) => ({
    env: globals.env,
    log: globals.verbose
      ? (msg: string) => console.log(`[${globals.env}]`, msg)
      : () => {},
  }),

  handlers: {
    deploy: ({ input, context }) => {
      context.log('Starting deployment...')  // Only logs if --verbose
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
  deprecated: true,   // shows warning
  hidden: true,       // hides from help
})
.args('positional1', 'positional2')  // positional arguments (in order)
.input(schema)                        // Standard JSON Schema
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
cli(schema, {
  name: 'myapp',          // required
  version: '1.0.0',       // required (shown with -v)
  description: 'My CLI',  // optional (shown in help)
  globals: globalsSchema, // optional (global options schema)
})
```

### `.run()` - Execute

```typescript
.run({
  context: (globals) => ({ ... }),  // optional: transform globals to context
  handlers: { ... },                 // required: type-safe command handlers
})
```

## Built-in Flags

| Flag            | Scope       | Description                 |
| --------------- | ----------- | --------------------------- |
| `-h, --help`    | Everywhere  | Show help                   |
| `-v, --version` | Root only   | Show version                |
| `--schema`      | Root only   | Output schema for AI agents |

Note: `-v` and `--schema` only work at root level. Using them with subcommands shows an error (like bun's behavior).

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
  user: group({ description: 'User management' }, {
    list: c
      .meta({ description: 'List users', aliases: ['ls'] })
      .input(s(v.object({
        format: v.optional(v.picklist(['json', 'table']), 'table'),
      }))),

    create: c
      .meta({
        description: 'Create user',
        examples: ['myapp user create --name john --email john@example.com'],
      })
      .input(s(v.object({
        name: v.pipe(v.string(), v.minLength(3)),
        email: v.optional(v.pipe(v.string(), v.email())),
      }))),
  }),

  db: group({ description: 'Database operations' }, {
    seed: c
      .meta({ description: 'Seed from JSON file' })
      .args('file')
      .input(s(v.object({
        file: v.pipe(
          v.string(),
          v.endsWith('.json'),
          v.transform((path) => Bun.file(path).json()),
        ),
      }))),
  }),
}

cli(schema, {
  name: 'myapp',
  version: '1.0.0',
  globals: s(v.object({
    verbose: v.optional(v.boolean(), false),
  })),
}).run({
  context: (globals) => ({
    db: drizzle(postgres(process.env.DATABASE_URL!)),
    log: globals.verbose ? console.log : () => {},
  }),

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
