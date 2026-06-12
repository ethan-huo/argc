---
name: myapp
description: >-
  One sentence: what the tool does and the agent tasks that should trigger it.
  Write trigger phrases the way users actually ask ("send a message to...",
  "capture a screenshot of...", "look up docs for...").
---

# myapp

One paragraph: what the tool is, what it is for, and any hard boundary on what
it should NOT be used for.

## Discover Capabilities First

This skill is a recipe guide, not a complete command list. The CLI schema is
the source of truth:

```bash
myapp --schema              # full typed spec
myapp --schema=.subcommand  # drill into one command group
```

## Command Reference

<!-- A table works well when commands differ in context cost or usage timing.
     Borrow the ghd skill's columns: Command / What it does / Context cost /
     When to use. Delete this section if a plain command list is enough. -->

| Command       | What it does | When to use |
| ------------- | ------------ | ----------- |
| `myapp hello` | ...          | ...         |

## Core Workflow

<!-- The main recipe: numbered steps with real commands an agent can copy.
     One happy path with a clear default beats a menu of options. -->

```bash
myapp hello --name world
```

## Long or Structured Input

Pass full JSON/JSON5 input instead of many flags:

```bash
myapp cmd --input '{ name: "alice" }'
myapp cmd --input @payload.json
```

## Anti-Patterns

<!-- The highest-value section. Each row is a mistake an agent actually made
     or will plausibly make. Grow this list from real usage friction. -->

| Don't do this                                   | Do this instead                                            | Why                                              |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Pipe full output into context to find one field | Re-read the persisted file with `jq`/`rg`, or use `--json` | stdout is a summary; the bulk lives in `.myapp/` |
| ...                                             | ...                                                        | ...                                              |

## Self-Improvement

When you encounter friction — a command that doesn't behave as documented, a
misleading instruction in this skill, or confusing output — file a GitHub
issue against `owner/myapp` instead of silently working around it.
