---
type: Proposal
title: argc 7.8 — @skill builtin, the skill ships inside the binary
status: accepted
version: 1.0
generated: { by: claude_code/fable-5, at: 2026-08-17T00:00:00Z }
description: >
  Embed the agent-facing skill (SKILL.md + references) into the CLI binary at
  build time via a Bun macro, and serve it through a new @skill builtin. The
  harness-visible skill becomes a one-line stub whose only job is trigger
  selection. Every mechanism claim in §3 was verified empirically on Bun 1.3.14
  before this document was written; do not re-litigate them, build on them.
---

# Proposal 7.8: `@skill` builtin — the skill ships inside the binary

Baseline: argc 7.7.1 (`main`). This proposal is **additive**: one new builtin,
one new `CLIOptions` field, one new package export, scaffold template updates.
No existing behavior changes.

## 1. Problem

Today a tool's skill lives in the harness skill directory as a full document.
That copy drifts from the installed CLI version, and its full body is loaded
into agent context even when one `@schema` call would have answered.

New model — the binary is the source of truth:

- The harness-visible skill (`skills/<name>/SKILL.md` in the tool repo,
  installed into the harness skill dir) becomes a **stub**: frontmatter for
  trigger selection plus a one-line body — `Run <name> @skill now`. It is
  hand-maintained and almost never changes.
- The full skill body and its reference files are **embedded into the binary
  at build time** and served by a new `@skill` builtin. The skill can never be
  newer or older than the binary that serves it.

## 2. Frozen decisions

These were decided with the author; do not reopen them.

1. **Skill files live in `src/`, next to the code**: `src/SKILL.md`,
   `src/references/*.md`, optionally `src/types/*.d.ts` when the project wants
   to expose type definitions to agents. VFS keys are paths relative to
   `src/`, posix separators (`SKILL.md`, `references/foo.md`).
2. **The embedded `SKILL.md` carries no frontmatter.** `@skill` prints it
   verbatim; there is no frontmatter parsing or stripping anywhere in argc.
3. **Command surface is exactly two forms** — no `--list`, no `--path` flag
   (positional, consistent with `@schema <selector>`):
   ```
   <name> @skill                    # SKILL.md body + trailing files block
   <name> @skill references/foo.md  # print one embedded file verbatim
   ```
4. **Bare `@skill` output shape** (the trailing block makes one call
   self-navigating, the same move `@schema` makes with its frontmatter nav):

   ```
   { SKILL.md content, verbatim }

   ---

   files:
   references/foo.md
   types/api.d.ts

   read: <name> @skill <path>
   ```

   `SKILL.md` itself is excluded from the files list; the list is sorted
   lexicographically. When the VFS contains only `SKILL.md`, omit the entire
   trailing block (separator included) — an empty `files:` is noise.

5. **The stub is hand-maintained.** No stub generation command. (Considered
   and rejected: generating the stub from source frontmatter — decision 2
   removes the frontmatter it would need.)
6. **Embedding mechanism is a Bun macro** (`with { type: 'macro' }`) calling a
   glob-based picker exported from a new `argc/skill` subpath. The include
   list lives in a project-local 5-line macro file — see §3 for why this
   cannot be collapsed into a single lib call.

## 3. Verified mechanism facts (Bun 1.3.14)

All verified by prototype before writing this spec:

| Fact                                                                                                                                                                                          | Status   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Macro executes at transpile time under bare `bun run`, at bundle time under `bun build` / `--compile`                                                                                         | verified |
| Macro return value is inlined as an object literal; the picker's `node:fs` code does not reach the bundle                                                                                     | verified |
| `bun build --compile` bakes content into the binary (source dir removed, binary still serves it)                                                                                              | verified |
| Escaping round-trips exactly — backticks, `${}`, quotes, backslashes in markdown all `===` disk content                                                                                       | verified |
| Editing `SKILL.md` in dev is picked up on next bare run, even with a >50 KB importing file (no transpiler-cache staleness)                                                                    | verified |
| `Bun.Glob(...).scanSync({ cwd })` works inside macro execution                                                                                                                                | verified |
| tsc 7 accepts `with { type: 'macro' }` under argc's tsconfig                                                                                                                                  | verified |
| **Macro arguments must be syntactic literals** — `import.meta.dir` at the call site fails with "Cannot convert argument type to JS"; relative paths resolve against **cwd**, not the importer | verified |
| Macro failure surface is garbled — an ENOENT inside a macro surfaces as `cannot coerce Exception (Cell) to Bun's AST` with no cause                                                           | verified |

Consequences the design absorbs:

- The path anchor **must** live inside a macro-invoked file in the user's
  project (its own `import.meta.dir`); a macro living in `node_modules/argc`
  would anchor to the wrong directory. Hence the scaffolded
  `src/skill.embed.ts` — it is template by necessity, not by choice.
- Because macro errors are illegible, the picker must `console.error` a
  legible one-line diagnosis before throwing (missing root, non-UTF-8 file).
  That stderr line is the only readable channel a build failure has.

## 4. Changes — argc core

### 4.1 `src/builtins.ts`

Add `'@skill'` to `BUILTIN_COMMANDS`. This alone reserves the key at the root
of user schemas (`assertValidCommandKeys`) and adds it to shell completion
candidates (`complete.ts` consumes `BUILTIN_COMMANDS`). `@skill` appearing in
completions for a tool that embeds no skill is acceptable — same status quo as
`@run` with `run: false`.

### 4.2 `src/types.ts`

```ts
export type CLIOptions<...> = {
	...
	/** Embedded skill VFS: src-relative posix path → file content. */
	skill?: Record<string, string>
}
```

### 4.3 `src/render.ts`

Extend `FrameworkErrorCode` (closed union) with:

- `'NO_SKILL'` — `@skill` invoked but the CLI embeds no skill.
- `'UNKNOWN_SKILL_FILE'` — `@skill <path>` where `<path>` is not a VFS key.

### 4.4 `src/cli.ts` — dispatch in `runBuiltin`

Mirror the existing `@run` / `@schema` branches:

- No `options.skill` → `ArgcError { error: 'NO_SKILL', $hint: 'this tool embeds no skill' }`
  (shape mirrors `RUN_DISABLED`, `src/cli.ts:182`).
- More than one argument → error, mirroring `@schema`'s "at most one selector"
  (reuse `RUNTIME_ERROR` with a detail, as `@completions` does — this is a
  usage slip, not a domain state).
- Bare `@skill` → print per §2.4. Missing `SKILL.md` key in the VFS is a
  configuration bug: `RUNTIME_ERROR` with detail naming the missing key.
- `@skill <path>` → print `vfs[path]` verbatim (ensure trailing newline).
  Unknown path → envelope that lets the agent fix it in one shot, the same
  philosophy as `BAD_SELECTOR` embedding the outline:

  ```
  error: UNKNOWN_SKILL_FILE
  got: <path>
  did_you_mean: <suggestSimilar hit, omit when none>
  files: <sorted VFS keys, SKILL.md included>
  ```

Output is raw text via `process.stdout.write` — no OKF envelope, no
colorization (it is markdown for an agent, not a schema). Rendering logic may
live in a small pure helper (suggest `src/skill.ts`) so it is unit-testable
without a `CLI` instance.

### 4.5 `src/skill.ts` — the build-time picker

Public surface (this is the entire export of the `argc/skill` subpath):

```ts
export function pickFiles(
	root: string,
	include: string[],
): Record<string, string>
```

Behavior:

- `root` missing → `console.error` a legible `[argc/skill] ...` line, then
  throw (see §3 on why the console.error is load-bearing).
- For each pattern in order: `new Bun.Glob(pattern).scanSync({ cwd: root })`,
  **sort matches** (scan order is nondeterministic → non-reproducible
  binaries), normalize keys to posix separators, insert into one record
  (overlapping patterns dedupe via keys).
- **UTF-8 validation**: read each file as a `Buffer`; if
  `Buffer.from(buf.toString('utf8'), 'utf8')` does not byte-equal the
  original, `console.error` the offending path and throw. A silent
  utf8-corrupted binary embed is the failure mode this buys out.
- Imports restricted to `node:fs` / `node:path` / Bun globals — the module is
  executed by the bundler during macro expansion; keep the import graph
  dependency-free and do not re-export it from `src/index.ts`.

### 4.6 `package.json`

- Add the subpath export, mirroring `./terminal`:
  ```json
  "./skill": {
  	"types": "./dist/skill.d.ts",
  	"import": "./src/skill.ts",
  	"default": "./src/skill.ts"
  }
  ```
- Version → `7.8.0`.

### 4.7 `src/help.ts`

When (and only when) the CLI embeds a skill, `showHelp` gains one line next to
the existing `@schema` guidance:
`` `<name> @skill` prints the agent usage guide. `` — `showHelp` already
receives the full `CLIOptions`, so check `options.skill` directly; no signature
change.

## 5. Changes — scaffold templates (`skills/argc/templates/`)

1. **New `src/SKILL.md` template** — body only, no frontmatter. Carry over the
   section skeleton from the current `tool-skill.md` (Discover Capabilities
   First / Core Workflow / Anti-Patterns), minus the frontmatter block.
2. **New `src/skill.embed.ts` template**:

   ```ts
   import { pickFiles } from 'argc/skill'

   // Build-time picker: which src/ files are agent-facing is an editorial
   // decision per project — keep the list explicit, not a framework convention.
   export function embedSkill(): Record<string, string> {
   	return pickFiles(import.meta.dir, ['SKILL.md', 'references/**/*.md'])
   }
   ```

3. **`main.ts` template** — add:
   ```ts
   import { embedSkill } from './skill.embed.ts' with { type: 'macro' }
   ```
   and `skill: embedSkill()` in the `cli(...)` options.
4. **`tool-skill.md` template becomes the stub** (installed as
   `skills/{{APP_NAME}}/SKILL.md`): keep the frontmatter guidance (name +
   trigger-phrase description — that description is the only thing the harness
   sees for selection), body reduced to:
   ```
   Run `{{APP_NAME}} @skill` now for the full usage guide.
   Read a referenced file with `{{APP_NAME}} @skill <path>`.
   ```
5. **`AGENTS.md` template** — the "Using this tool" bullet now points at
   `src/SKILL.md` as the source of truth and names `skills/{{APP_NAME}}/SKILL.md`
   as the stub.
6. **`skills/argc/SKILL.md`** (the argc skill itself) — add a short section
   teaching the convention: where skill files live, the macro wiring, the two
   `@skill` forms. Reference this proposal for rationale instead of restating
   it.

## 6. Tests and proof

Unit (`src/skill.test.ts` or folded into existing suites; VFS is a plain
record, so `@skill` dispatch tests need no macro):

- `@skill` unconfigured → `NO_SKILL`.
- Bare `@skill` → body + files block per §2.4; files sorted; `SKILL.md`
  excluded; block omitted when VFS has only `SKILL.md`.
- `@skill <path>` known / unknown (`UNKNOWN_SKILL_FILE` with `files` and
  `did_you_mean`) / two args → error.
- `pickFiles`: fixture dir → glob selection, deterministic sorted keys, posix
  keys, missing root throws after legible stderr, non-UTF-8 file rejected.
- Root-level user command named `@skill` → rejected by
  `assertValidCommandKeys` (should already pass via 4.1; assert it).

Integration (cheap, no `--compile` in CI): a fixture entry importing a macro
file; `Bun.spawnSync(['bun', 'build', '--target=bun', ...])`, assert the
output contains the fixture markdown inline and does not contain
`readdirSync`/`scanSync` — proving build-time inlining. Run the same fixture
with bare `bun` from a different cwd, assert identical VFS keys — proving the
`import.meta.dir` anchor.

Scaffold verification (the §5 template changes need proof too — `bun run
check` covers only argc core): scaffold a fresh project from the updated
templates, point its `argc` dependency at the local checkout (`file:` or
`bun link` — `github:...#7.8.0` does not exist yet), then run that project's
own `check` and smoke the three `@skill` forms (bare, known path, unknown
path). If the repo already has scaffold-test infrastructure (see
`templates/main.test.ts.tpl` and commit `81b72d1`), extend it rather than
building a parallel harness — inspect before adding.

Proof command: `bun run check` (fmt:check + typecheck + tests) — must pass,
alongside the scaffold verification above.

## 7. Non-goals

- No `--list` (bare `@skill` already carries the file list) and no `--path`
  flag (positional).
- No frontmatter parsing, stripping, or generation anywhere.
- No stub generation command; the stub is a hand-maintained checked-in file.
- No auto-installation into harness skill directories.
- No compression or lazy-loading of embedded content; plaintext inlining is
  the design (tens of KB against a ~50 MB compiled baseline).
- No changes to `@schema` / `@run` / `@completions` behavior.
- No migration of existing tools in this change — the slack CLI migration is
  the follow-up that validates the scaffold, not part of this proposal.
