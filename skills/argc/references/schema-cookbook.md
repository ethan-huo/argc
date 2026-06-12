# Schema Cookbook

How argc turns argv into typed handler input, and copy-paste recipes for the
schema shapes that come up when building agent-facing CLIs. Read alongside the
README sections _Transform: Schema Superpowers_, _Arrays & Nested Objects_, and
_JSON Input_ (`node_modules/argc/README.md`).

## How coercion works (and why it never throws)

argc keeps argv parsing **lexical** — every flag value starts as a string. Before
validation, it adapts explicit flag values to the schema's _input_ JSON type
(`src/coerce.ts`):

| Schema input type | argv `"5"` / `"true"` becomes | Notes                                         |
| ----------------- | ----------------------------- | --------------------------------------------- |
| `string`          | unchanged                     | —                                             |
| `number`          | `5`                           | non-numeric strings pass through unchanged    |
| `integer`         | `5`                           | non-integers (`"5.5"`) pass through unchanged |
| `boolean`         | `true`                        | only `"true"`/`"false"` (case-insensitive)    |
| `array`           | each item coerced to `items`  | repeated flags: `--tag a --tag b`             |
| `object`          | each property coerced         | dot notation: `--db.port 5432`                |

**Coercion never throws.** A value that can't be coerced is passed through
untouched so the _validator_ produces the error message — you get
`expected number, received "abc"` from your schema library, not an opaque parse
crash. This is why you should let the schema own constraints (`v.minValue`,
`v.email`) rather than pre-checking in handlers.

Coercion is **type-directed and shallow per field**; it does not run transforms.

## Transforms run during validation, lazily

`v.transform` (valibot) / `.transform` (zod) run inside the standard-schema
validate step, **only for the executed command**. Coercion handles primitives;
transforms handle rich values. Rule of thumb:

- **Primitive (`number`, `boolean`, `integer`)** → declare the type, coercion
  handles it. No transform needed.
- **Rich value (`File`, `Date`, `URL`, `Glob`, parsed JSON)** → string input +
  `transform`.

```typescript
import * as v from 'valibot'

// string → parsed JSON file (async transform is fine; handler awaits input.file)
file: v.pipe(
	v.string(),
	v.endsWith('.json'),
	v.transform((p) => Bun.file(p).json()),
)

// string → Date
since: v.pipe(
	v.string(),
	v.transform((s) => new Date(s)),
)

// string → validated URL object
endpoint: v.pipe(
	v.string(),
	v.url(),
	v.transform((s) => new URL(s)),
)

// string → glob matcher
pattern: v.pipe(
	v.string(),
	v.transform((p) => new Bun.Glob(p)),
)
```

The handler receives the transformed value (a `Promise` if the transform is
async — `await input.file`). Validation/transform cost is paid only for the
command that actually runs.

## Recipes

### Optional flag with a default

```typescript
loud: v.optional(v.boolean(), false) // --loud / --no-loud, default false
format: v.optional(v.picklist(['json', 'table']), 'table')
```

`--schema` renders these as `loud?: boolean = false` — the default is visible to
the agent. Prefer defaults over required flags wherever a sane default exists.

### Enums an agent can discover

```typescript
env: v.picklist(['dev', 'staging', 'prod']) // → env: "dev" | "staging" | "prod"
```

Picklists surface every legal value in `--schema`; free-form strings don't.
Reach for a picklist whenever the input is a closed set.

### Arrays (repeat the flag)

```typescript
tags: v.array(v.string()) // --tags a --tags b → ['a','b']
ports: v.array(v.number()) // --ports 80 --ports 443 → [80, 443] (coerced)
```

### Nested objects (dot notation)

```typescript
db: v.object({ host: v.string(), port: v.number() })
// --db.host localhost --db.port 5432 → { host: 'localhost', port: 5432 }
```

Keep nesting shallow. Deep trees are awkward on the command line; for complex
payloads prefer `--input` (below).

### Constrained primitives

```typescript
name: v.pipe(v.string(), v.minLength(2))
count: v.pipe(v.number(), v.minValue(1), v.maxValue(100))
email: v.pipe(v.string(), v.email())
```

Let the schema enforce constraints — the error messages are free and the
constraint shows up in `--schema`.

## When to use `--input` instead of flags

Every command accepts a full JSON/JSON5 object via `--input` (README: _JSON
Input_). Reach for it when:

- the payload is large or generated (agents, scripts): `--input @payload.json`,
  `--input '{...}'`, or `--input @-` (stdin)
- the shape is deeply nested (dot notation gets unwieldy)

`--input` is **exclusive** with other command flags and positionals (globals are
still allowed). Don't design a command that must mix `--input` with individual
flags — pick one model per command.

## Schema library choice

argc needs both `StandardSchemaV1` (validate) and `StandardJSONSchemaV1`
(introspection for `--schema`):

- **zod**, **arktype** — work bare: `c.input(z.object({ … }))`.
- **valibot** — wrap every schema in `toStandardJsonSchema` from
  `@valibot/to-json-schema`. Forgetting the wrapper fails at the type level with
  a confusing error. The templates default to valibot + this wrapper (aliased
  `s`); the choice is to keep argc's own bundle dependency-light, not a quality
  judgment — use whichever library the project already uses.
