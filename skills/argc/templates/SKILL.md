# {{APP_NAME}}

One paragraph: what the tool is, what it is for, and any hard boundary on what
it should NOT be used for.

## Discover Capabilities First

This skill is a recipe guide, not a complete command list. The CLI schema is
the source of truth:

```bash
{{APP_NAME}} @schema              # full typed spec
{{APP_NAME}} @schema .subcommand  # drill into one command group
```

## Core Workflow

<!-- The main recipe: numbered steps with real commands an agent can copy.
     One happy path with a clear default beats a menu of options. -->

```bash
{{APP_NAME}} hello "{ name: 'world' }"
```

## Anti-Patterns

<!-- The highest-value section. Each row is a mistake an agent actually made
     or will plausibly make. Grow this list from real usage friction. -->

| Don't do this                                   | Do this instead                                            | Why                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Pipe full output into context to find one field | Re-read the persisted file with `jq`/`rg`, or use `--json` | stdout is a summary; the bulk lives in `.{{APP_NAME}}/` |
| ...                                             | ...                                                        | ...                                                     |
