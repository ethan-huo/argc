# Schema Cookbook

How to model typed input for argc 7 commands. Read this when designing the
object passed as the single command input token.

## Mental Model

argc does not coerce shell flags in v7. A command receives one structured object
literal value, then the Standard Schema validator owns type checking, defaults, and
transforms.

```bash
myapp user.create "{ name: 'alice', tags: ['admin', 'dev'] }"
myapp user.create @payload.json
printf "{ name: 'alice' }" | myapp user.create -
```

Bare braces are a shell error, not an argc feature. Quote object input.

## Transforms

`v.transform` (valibot), `.transform` (zod), and equivalent Standard Schema
transforms run during validation for the executed command only.

```typescript
file: v.pipe(
	v.string(),
	v.endsWith('.json'),
	v.transform((path) => Bun.file(path).json()),
)

since: v.pipe(
	v.string(),
	v.transform((value) => new Date(value)),
)

endpoint: v.pipe(
	v.string(),
	v.url(),
	v.transform((value) => new URL(value)),
)
```

The handler receives transformed values. Async transforms produce promises; keep
that choice intentional because it leaks into handler code.

## Defaults

Use schema defaults when the tool has a sane default:

```typescript
format: v.optional(v.picklist(['yaml', 'json']), 'yaml')
limit: v.optional(v.number(), 20)
```

Defaults are visible in `@schema`, so agents can omit routine choices without
guessing.

## Closed Sets

Prefer picklists for finite choices:

```typescript
environment: v.picklist(['dev', 'staging', 'prod'])
```

Closed sets are high-signal in `@schema`; free-form strings are not.

## Arrays and Objects

Arrays and nested objects are ordinary object literals:

```typescript
tags: v.array(v.string())
db: v.object({
	host: v.string(),
	port: v.number(),
})
```

```bash
myapp deploy "{ tags: ['api', 'prod'], db: { host: 'localhost', port: 5432 } }"
```

Do not invent flag-like parallel syntax. If the payload is too large for a
single readable command, put it in a file and pass `@payload.json`.

## Non-Identifier Field Names

Command and group keys must be JavaScript identifiers. Input field names are
domain data and may be non-identifiers:

```typescript
headers: v.object({
	'content-type': v.string(),
})
```

`@schema` quotes those keys:

```typescript
type Input = {
	'content-type': string
}
```

## Schema Library Choice

argc needs Standard Schema validation plus JSON Schema introspection for
`@schema`.

- zod and arktype can usually be passed directly.
- valibot needs `toStandardJsonSchema` from `@valibot/to-json-schema` around
  every schema passed to `.input()` or `context`.

The templates use valibot + `toStandardJsonSchema` to keep argc's own runtime
small. Use the schema library the project already uses when that is clearer.
