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
  its context. Progress bars, warnings, and logs go to stderr. Never mix.
- **`emit()` is for the runtime, not the agent.** Structured telemetry
  (progress, artifact metadata, IDs) goes through hook events; do not encode
  it into stdout.
- **Keep stdout budget-conscious.** If a command can dump unbounded content,
  add paging/limit flags and a summary mode, like `ctx` structural summaries.
- **Complex input → `--input`.** Commands accept full JSON/JSON5 via
  `--input '{...}'`, `--input @file.json`, or `--input @-` (stdin). Free with
  argc; mention it in the tool's skill for long payloads.

## Core API in 30 Lines

```typescript
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'
import { c, cli, group } from 'argc'
import packageJson from '../package.json' with { type: 'json' }

const s = toStandardJsonSchema  // valibot needs this wrapper; zod/arktype do not

const schema = {
	user: group({ description: 'User management' }, {
		create: c
			.meta({
				description: 'Create a user',
				examples: ['myapp user create --name john'],
			})
			.input(s(v.object({
				name: v.pipe(v.string(), v.minLength(2)),
				tags: v.optional(v.array(v.string())),        // --tags a --tags b
			}))),
	}),
}

const app = cli(schema, {
	name: 'myapp',
	version: packageJson.version,  // single source of truth: package.json
	description: 'One-line tool description.',
})

await app.run({
	handlers: {
		'user.create': ({ input }) => {                  // flat or nested keys
			console.log(`created ${input.name}`)
		},
	},
})
```

When the tool grows, split into `src/schema.ts` + `src/handlers/*.ts` and type
handlers with `typeof app.Handlers` (supports `AppHandlers['user.create']`
dot-notation).

## Full API Reference

After `bun install`, the complete reference is local — read sections of
`node_modules/argc/README.md` on demand:

| Need                                      | README section                 |
| ----------------------------------------- | ------------------------------ |
| string → File/Date/URL coercion           | Transform: Schema Superpowers  |
| global flags → typed handler context      | Global Options → Context       |
| handlers split across files               | Handlers in Separate Files     |
| `--schema` selectors, custom explorer     | AI Agent Integration           |
| hook events for agent runtimes            | Hook Events for Agent Runtimes |
| scripting mode (`--run`)                  | Scripting Mode                 |

## Build & Release Pipeline

The pipeline (from `templates/`):

```
bump package.json version → push to main
  → release.yml detects the version change
  → bun run check && bun run build
  → tags vX.Y.Z, creates GitHub Release with dist/<name> attached
```

There is no manual tagging step. To cut a release, edit `version` in
`package.json` and push. Pushing without a version change runs CI only.

- **Bundle:** `bun build src/main.ts --outfile=dist/<name> --target=bun
  --minify` produces a single executable JS file. `--target=bun` injects the
  `#!/usr/bin/env bun` shebang; the build script still needs `chmod +x`.
- **Artifact:** the release attaches the bare `dist/<name>` bundle.
  `install.sh` curls it from the release URL and installs to `~/.local/bin`;
  when the direct download 404s (private repo), it falls back to
  `gh release download` with the user's GitHub auth.
- **End-user install** (the scaffold README carries both):

```bash
# public repo
curl -fsSL https://raw.githubusercontent.com/<owner>/<name>/main/install.sh | bash
# private repo (install.sh itself needs gh to fetch)
gh api repos/<owner>/<name>/contents/install.sh --jq .content | base64 -d | bash
```

For a compiled native binary instead of a JS bundle, use
`bun build --compile`; only do this when the user explicitly wants a
no-Bun-required binary — it is ~50MB+ per platform and needs a target matrix.

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
- **release.yml compares against `github.event.before`** to detect version
  bumps, so squash-merging several bumps in one push still releases only the
  final version; force-pushes with a zero `before` SHA fall back to
  tag-existence checking.
- **Ship the tool's own skill.** Every sibling tool (ghd/ctx/slack/calque)
  exposes `skills/<name>/SKILL.md` teaching agents how to *use* it. A CLI
  without one is unfinished. Start from `templates/tool-skill.md`.

## Self-Improvement

When argc itself fights you — a parsing behavior that contradicts the README,
a `--schema` output that confuses agents, a missing capability that forces a
workaround — file a GitHub issue against `ethan-huo/argc` instead of silently
working around it.
