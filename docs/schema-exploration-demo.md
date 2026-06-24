# Schema Exploration Demo

This document shows argc 7 `@schema` behavior for agents.

## Root Schema

```bash
demo @schema
```

Expected shape:

```typescript
type Demo = {
  user: {
    list(input?: { all?: boolean = false })
    create(input: {
      name: string
      email?: string
      tags?: string[] = []
    })
  }
}
```

`@schema` is documentation for agents, not human help text. It shows command
paths, typed input objects, defaults, descriptions, and examples.

## Focus a Command

```bash
demo @schema .user.create
demo @schema .user.create.input
```

Command examples must show quoted object input:

```bash
demo user.create "{ name: 'john', tags: ['admin', 'dev'] }"
```

## Explore Large Trees

For large command trees, use selectors:

```bash
demo @schema .deploy
demo @schema .deploy.aws
demo @schema ..create
```

The output should stay compact enough for an agent to choose the next command
without reading unrelated branches.

## Non-Identifier Input Keys

Command and group keys are valid JavaScript identifiers. Input field keys may
come from domain data:

```typescript
type Input = {
	'content-type'?: string
}
```

The renderer quotes those property names so the generated TypeScript remains
valid.
