---
name: '{{APP_NAME}}'
description: >-
  One sentence: what the tool does and the agent tasks that should trigger it.
  Write trigger phrases the way users actually ask ("send a message to...",
  "capture a screenshot of...", "look up docs for...").
---

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

## Command Reference

<!-- A table works well when commands differ in context cost or usage timing.
     Borrow the ghd skill's columns: Command / What it does / Context cost /
     When to use. Delete this section if a plain command list is enough. -->

| Command              | What it does | When to use |
| -------------------- | ------------ | ----------- |
| `{{APP_NAME}} hello` | ...          | ...         |

## Core Workflow

<!-- The main recipe: numbered steps with real commands an agent can copy.
     One happy path with a clear default beats a menu of options. -->

```bash
{{APP_NAME}} hello "{ name: 'world' }"
```

## Long or Structured Input

Pass one quoted JSON5 input object, or hand off a file for larger payloads:

```bash
{{APP_NAME}} cmd "{ name: 'alice' }"
{{APP_NAME}} cmd @payload.json
```

## Anti-Patterns

<!-- The highest-value section. Each row is a mistake an agent actually made
     or will plausibly make. Grow this list from real usage friction. -->

| Don't do this                                   | Do this instead                                            | Why                                                     |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| Pipe full output into context to find one field | Re-read the persisted file with `jq`/`rg`, or use `--json` | stdout is a summary; the bulk lives in `.{{APP_NAME}}/` |
| ...                                             | ...                                                        | ...                                                     |

## Self-Improvement

When you encounter friction — a command that doesn't behave as documented, a
misleading instruction in this skill, or confusing output — file a GitHub
issue against `{{REPO}}` instead of silently working around it.
