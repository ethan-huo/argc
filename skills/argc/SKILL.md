---
name: argc
description: >-
  Build agent-native CLI tools with the argc framework for Bun. Activate when
  scaffolding a new CLI tool, adding commands to an argc-based CLI, designing
  agent-friendly command schemas, or setting up the build/release pipeline
  (bun build bundle + GitHub Actions release) for a Bun CLI.
---

# argc

Schema-first CLI framework for Bun. The schema IS the CLI definition: it drives
parsing, validation, help text, shell completions, and — critically — the
`--schema` output that AI agents read instead of `--help`. You define commands
once with a Standard Schema library (valibot/zod/arktype) and get type-safe
handlers plus an agent-readable TypeScript-like spec for free.

This skill covers two jobs:

1. **Developing a CLI with argc** — scaffold, schema design, handlers.
2. **Shipping it** — bun single-file bundle + GitHub Actions auto-release.

## Scaffold a New CLI

Run this skill's scaffold script — it renders `templates/`, substitutes the
tool name, pins argc to its latest release tag, runs `git init`, and verifies
the result with install + check + build:

```bash
scripts/argc-start.sh --name acme --repo owner/acme
# → ./acme with src/, README.md, skills/acme/SKILL.md, .github/workflows/, install.sh
```

`--dir` overrides the target directory; `--skip-check` skips the bun
install/check/build verification pass. If the script reports a failure, fix
the scaffold before writing any feature code.

The rendered layout (for manual copying, substitute every `myapp`/`MYAPP`):

```
templates/main.ts       → src/main.ts        # entry: schema + cli() + handlers
templates/main.test.ts  → src/main.test.ts   # smoke test (bun test fails on zero test files)
templates/package.json  → package.json       # scripts contract + pinned deps
templates/tsconfig.json → tsconfig.json
templates/ci.yml        → .github/workflows/ci.yml
templates/release.yml   → .github/workflows/release.yml
templates/install.sh    → install.sh         # end-user install from GH release
templates/tool-skill.md → skills/<name>/SKILL.md   # the tool's own agent skill
```

After scaffolding:

- [ ] `bun run src/main.ts --schema` reads well — this is the agent's UI
- [ ] Fill in `skills/<name>/SKILL.md` for the finished tool (see template)
- [ ] Create the GitHub repo, push — release.yml takes over from there

Never pin argc to `#main` — main does not commit `dist/*.d.ts`; only release
tags resolve types. Latest tag: `git ls-remote --tags --refs
https://github.com/ethan-huo/argc.git 'v*' | awk -F/ '{print $NF}' | sort -V | tail -1`
(argc ships git tags, not GitHub Releases — `gh release list` returns nothing).

Use `oxfmt` for formatting and `tsgo` (TypeScript native preview) for
typechecking, as in the templates. Do not introduce eslint/prettier/tsc.

## Designing for Agents

The primary consumer of these CLIs is an AI agent. Design rules:

- **Flags over positionals.** `--schema` renders flags as named, typed
  parameters. Positionals are always required and carry less self-description.
  Use `.args()` only when it clearly helps humans (`myapp env KEY VALUE`).
- **`meta.description` and `meta.examples` are the agent's documentation.**
  Every command gets a description; non-obvious commands get an example.
- **stdout is the result; stderr is diagnostics.** An agent pipes stdout into
  its context. Progress bars, warnings, and logs go to stderr. Never mix. For
  colored/iconized status and tables, use `argc/terminal` (see
  `references/terminal.md`) — its color auto-disables when piped, so captured
  stdout stays clean without per-call guards.
- **Summarize to stdout; persist the bulk.** stdout is the agent's context
  budget, not a data dump. If a command produces more than a screenful — or
  output the agent will want to slice — write the bytes to a hidden state dir
  (`cwd/.<tool>/`) and let stdout carry only a summary plus the path to re-read.
  This is the stateful-tool pattern; stateless tools just emit their summary.
- **YAML for stdout summaries; `--json` for machine pipes.** A YAML KV block is
  the most readable disclosure for agent and human alike, and every agent parses
  it natively. Serialize with the `yaml` library (`import { stringify } from
'yaml'`), not `Bun.YAML` — the latter can't emit `|` block scalars. Add `--json`
  on data commands so the agent can `jq` the raw form. Avoid bare-JSON-as-default
  and TOON for CLI output — see `references/output.md`.
- **`$`-keys are the tool→agent channel.** A top-level `$`-prefixed key carries an
  out-of-band signal to the agent, separate from the data payload: `$hints` (what
  to do next — "records at .myapp/x.json, slice with `jq …`"), `$notification`
  (a system notice to surface, common in daemon-style tools). `$` is a plain YAML
  scalar (unlike `@`, which forces quotes). The set is open; keep them few and
  document any you coin. See `references/output.md`.
- **`emit()` is for the runtime, not the agent.** Structured telemetry
  (progress, artifact metadata, IDs) goes through hook events; do not encode
  it into stdout.
- **Complex input → `--input`.** Commands accept full JSON/JSON5 via
  `--input '{...}'`, `--input @file.json`, or `--input @-` (stdin). Free with
  argc; mention it in the tool's skill for long payloads.

## Core API in 30 Lines

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'
import { c, cli, group } from 'argc'
import packageJson from '../package.json' with { type: 'json' }

const s = toStandardJsonSchema // valibot needs this wrapper; zod/arktype do not

const schema = {
	user: group(
		{ description: 'User management' },
		{
			create: c
				.meta({
					description: 'Create a user',
					examples: ['myapp user create --name john'],
				})
				.input(
					s(
						v.object({
							name: v.pipe(v.string(), v.minLength(2)),
							tags: v.optional(v.array(v.string())), // --tags a --tags b
						}),
					),
				),
		},
	),
}

const app = cli(schema, {
	name: 'myapp',
	version: packageJson.version, // single source of truth: package.json
	description: 'One-line tool description.',
})

await app.run({
	handlers: {
		'user.create': ({ input }) => {
			// flat or nested keys
			console.log(`created ${input.name}`)
		},
	},
})
```

When the tool grows, split into `src/schema.ts` + `src/handlers/*.ts` and type
handlers with `typeof app.Handlers` (supports `AppHandlers['user.create']`
dot-notation).

## Reference Material

Load on demand — don't read these up front. Each covers a deeper slice than the
README and exists because the README either omits it or only sketches it.

| Read this skill's…              | When you are…                                                         |
| ------------------------------- | --------------------------------------------------------------------- |
| `references/output.md`          | Designing stdout — YAML summaries, hidden state dir, `--json`, $hints |
| `references/terminal.md`        | Adding color, status icons (✓/✗/⚠), or aligned tables to CLI output   |
| `references/schema-cookbook.md` | Designing command input — coercion rules, transforms, arrays, enums   |
| `references/release.md`         | Shipping it — version-bump release, bundle, install.sh, native binary |

`references/terminal.md` documents the `argc/terminal` subexport (`fmt`,
`printTable`, `visibleWidth`) — **not in the README at all**. Reach for it
whenever the tool prints anything a human will look at; its color auto-disables
when piped, so agent-captured stdout stays clean.

After `bun install`, the rest of the API lives in
`node_modules/argc/README.md` — read a section on demand:

| Need                                  | README section                 |
| ------------------------------------- | ------------------------------ |
| string → File/Date/URL coercion       | Transform: Schema Superpowers  |
| global flags → typed handler context  | Global Options → Context       |
| handlers split across files           | Handlers in Separate Files     |
| `--schema` selectors, custom explorer | AI Agent Integration           |
| hook events for agent runtimes        | Hook Events for Agent Runtimes |
| scripting mode (`--run`)              | Scripting Mode                 |

## Gotchas

- **valibot requires `toStandardJsonSchema` from `@valibot/to-json-schema`**
  around every schema passed to `.input()`/`globals`. zod and arktype work
  bare. Forgetting the wrapper fails type-level, with a confusing error.
- **Pin argc to a release tag** (`github:ethan-huo/argc#vX.Y.Z`). `#main` has
  no committed `dist/*.d.ts`, so types silently degrade to `any`.
- **Positional args are always required.** There is no optional positional;
  model optionality as a flag.
- **`--input` is exclusive** with other command flags/positionals (globals are
  still allowed). Don't design commands that need to mix both.
- **`version` comes from `package.json`** via
  `import packageJson from '../package.json' with { type: 'json' }` — never
  hardcode it, or the release tag and `--version` will drift.
- **Ship the tool's own skill.** Every sibling tool (ghd/ctx/slack/calque)
  exposes `skills/<name>/SKILL.md` teaching agents how to _use_ it. A CLI
  without one is unfinished. Start from `templates/tool-skill.md`.

## Self-Improvement

When argc itself fights you — a parsing behavior that contradicts the README,
a `--schema` output that confuses agents, a missing capability that forces a
workaround — file a GitHub issue against `ethan-huo/argc` instead of silently
working around it.
