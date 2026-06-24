---
type: Change Request
title: argc 7.0 evolution — dotted paths, YAML help, schema-embedded errors
status: draft
version: 0.1
timestamp: 2026-06-24
description: >
  Post-implementation change request against shipped argc 7.0 (commit 867a9fd).
  Five deltas: dotted-ONLY path addressing (drop space), YAML --help,
  @schema header tutorial + a real `type Context`, and errors that embed the
  relevant @schema slice instead of pointing at it.
---

# CR: argc 7.0 evolution

Baseline: **argc 7.0 as implemented** (commit `867a9fd`). Parent spec:
[proposal-v2-typed-command-surface.md](./proposal-v2-typed-command-surface.md). This CR
**supersedes** that doc's §2 (path) and §4.1 / §4.2 / §4.5 (rendering). Clean break — the 7.0
surface just shipped and has no external consumers; no compat shims.

Guiding principle this CR enforces: **one thing, one way.** If a single action has two spellings,
that is not our philosophy.

---

## CR-1 — Path addressing: dotted only (remove space syntax)

The path is a JS member path, identical to how it reads in `@run` and to the flattened `@schema`
type. The space-separated form is **removed** — two spellings for one path is exactly the
redundancy we reject.

The only accepted spelling is:

```bash
large storage.bucket.list "{ region: 'us' }"
```

Why this is clean, not a regression:

- **Isomorphic across all three forms** — `large storage.bucket.list "{…}"`,
  `@run "await storage.bucket.list({…})"`, and the `@schema` nested type flatten to the _same_
  string. Read the type → write the call, path included.
- **No bracket notation needed.** Command/group keys are already identifier-only (parent §2.3.1),
  so a path is always `ident.ident.ident` — unquoted-shell-safe (`.` is not shell-special; there
  is no `[]` to trigger globbing). Non-identifier keys exist only inside the input object, which is
  already a quoted JSON5 token. So `storage['foo-bar'].call` never arises and is not supported.

Parser:

- The first non-`@` token **is** the path; split it on `.` into identifier segments. Exactly
  **one** path token.
- A trailing bare word (the old space form) is an error, not a silent misparse — it teaches the
  dotted form (see CR-5 error shape):

  A legacy space-form invocation returns `BAD_PATH` with a dotted-path hint and an embedded
  `$schema` slice.

- `@schema`'s **selector** keeps its own `.x.y` grammar (leading dot = from-root). That is selector
  syntax, distinct from path addressing; unchanged.

Touches: `src/parser.ts` (single dotted path token; reject trailing bare words), `@schema` example
comments (CR-3), README / skill / examples / `src/v7.test.ts`.

---

## CR-2 — `--help` → YAML

The 7.0 help is a free-form aligned card — the loose, hard-to-parse shape we reject everywhere
else. Make help **YAML**. The top-level KV structure is right; what was wrong is treating each
value as a one-line tag. **`help`, `examples`, and `context` are content sections — YAML block
scalars (`|-`)**, so each is multi-line, readable, and carries enough to call without escaping
noise. The selectors are a line **inside** the `help` block, not a floating `$selectors` key.

```yaml
program: large — Large schema demo
help: |-
  Call a command by its dotted path with one quoted JSON5 object as input:
    <path> "<json5>"
  Input may also be @file or - (stdin), or omitted for {}.
  Config:   --context "<json5>"   (or ARGC_CTX env)
  Code:     @run "<code>"          run TypeScript against the typed API
  Schema:   @schema [.selector]    print the typed API
              selectors:  .name  ."key"  .*  .{a,b}  ..name
examples: |-
  large compute.alpha.list "{ region: 'us' }"
  large @run "await compute.alpha.list({ region: 'us' })" --json
  large @schema .compute
context: |-
  type Context = { env?: "dev" | "prod" }
  pass via  --context "<json5>"  or  ARGC_CTX
```

Why block scalars: a YAML seq of example strings escapes the inner quotes
(`- "large x \"{...}\""`) — ugly and noisy. A `|-` block keeps them **verbatim**. `examples`
is `buildSurfaceExamples(...).join('\n')` (one string → one block); `help` is static grammar;
`context` is the rendered type + how to pass it.

`cli` with no args still == `cli --help`. **Implemented** in `src/help.ts` (this is a
non-programmatic display change — done by hand, not Codex).

---

## CR-3 — `@schema` header carries a concise tutorial

So a schema-first agent (the "with skill: `@schema` → call" path) learns to call without reading
`--help`. The body stays **valid TS**, so the tutorial is TS comments.

```ts
// large — Large schema demo
//
// Call:  <path> "<json5>"   ·   @run "<code>"   ·   @schema [.selector]
//   large storage.bucket.list "{ region: 'us' }"
//   large user.create "{ name: 'alice' }" --context "{ env: 'prod' }"

type Context = { env?: 'dev' | 'prod' } // --context / ARGC_CTX

type Large = {
	storage: {
		bucket: {
			/** List buckets */
			list(input: { region?: string })
			/** Get a bucket */
			get(input: { id: string })
		}
	}
}
```

The help (`examples:`) and the `@schema` header examples must share **one source** — do not let the
two drift. Touches: `src/schema.ts` / `src/schema-explorer.ts`, tests.

---

## CR-4 — Context as a real `type Context` in `@schema`

7.0 prints context as a comment (`// Context: { … }`). Emit a real **`type Context = { … }`**
declaration (as in CR-3) so it is parseable TS, not a comment. Touches: `src/schema.ts` /
`src/schema-explorer.ts`, tests.

---

## CR-5 — Errors embed the `@schema` slice (stop pointing, start showing)

7.0 errors point at the schema (`$hint: large @schema .storage`), forcing a second round-trip.
Instead **embed the relevant `@schema` slice inline** as `$schema:`, so the error self-corrects in
one shot.

- Render the slice via the existing schema-explorer (`render` + `select` + the **size-guard**, so a
  huge namespace embeds the compact outline, not a 1000-line dump).
- Block scalar is **`|-`** (literal — preserves the TS newlines); never `>` (folding joins lines and
  breaks the type).
- When `$schema` is embedded, **drop the now-redundant `$hint`**. Errors with no schema target
  (`RUN_DISABLED`, `TWO_INPUTS`, `BAD_INPUT_JSON`) keep `$hint`.

Mapping: `NOT_A_COMMAND` → the namespace slice; `UNKNOWN_COMMAND` / `BAD_PATH` → the nearest
resolved-prefix slice; `INVALID_INPUT` → the command signature.

```
$ large storage
error: NOT_A_COMMAND
got: storage
$schema: |-
  storage: {
    bucket: { list(input: { region?: string }); get(input: { id: string }); create(input: { name: string; region: string }) }
    object: { … }
  }
```

```
$ large storage.bucket.lst "{}"
error: UNKNOWN_COMMAND
got: storage.bucket.lst
$schema: |-
  bucket: {
    list(input: { region?: string })
    get(input: { id: string })
    create(input: { name: string; region: string })
  }
```

```
$ large user.create "{ name: 'al', emial: 'x' }"
error: INVALID_INPUT
command: user.create
issues:
  - at: name
    message: "Invalid length: Expected >=3 but received 2"
  - at: emial
    message: unknown key
$schema: |-
  create(input: { name: string; email?: string })
```

Touches: `src/render.ts` (error envelope), `src/cli.ts` (error construction), tests.

---

## Files & verification

| CR  | Files                                                                             |
| --- | --------------------------------------------------------------------------------- |
| 1   | `parser.ts`; `@schema` example comments; README / skill / examples / `v7.test.ts` |
| 2   | `help.ts`                                                                         |
| 3   | `schema.ts` / `schema-explorer.ts` (header tutorial; shared example source)       |
| 4   | `schema.ts` / `schema-explorer.ts` (real `type Context`)                          |
| 5   | `render.ts`, `cli.ts` (embed `$schema`, reuse explorer size-guard)                |

Verification (independently re-run, not trusted from report): `bun run typecheck`,
`bun run fmt:check`, `bun test`, `bun run build`, plus smoke:

```
large @schema .storage
large storage.bucket.list "{ region: 'us' }"
large storage                                  # NOT_A_COMMAND + embedded $schema
large user.create "{ name: 'al', emial: 'x' }" # INVALID_INPUT + issues + $schema
legacy space-form invocation                   # BAD_PATH smoke for dotted-only rejection
large @run "await user.create({ name: 'alice' })" --json
```

## Migration sweep (no compat shim)

There is **no compatibility layer** — the 7.0 surface is replaced, so every artifact written
against it must be swept in this CR, not just `src/`:

- **Space-path → dotted** everywhere it appears: `README.md`, `skills/argc/**` (SKILL.md,
  references, templates, scaffold), `examples/*.ts`, `docs/*`, and all tests. Grep for the old
  form (e.g. `bun examples/large.ts <word> <word>` invocations, `create`, `list` as separate
  path tokens) and convert to `a.b.c`.
- **Old `--help` card** copied into any doc/README → replace with the YAML form (CR-2).
- **Old `@schema` output** (comment-`Context`, no header tutorial) shown in docs → update to CR-3/4.
- **Old error shape** (`$hint`-only) in docs/tests → update to the `$schema`-embedded form (CR-5).
- Tests: `src/v7.test.ts` and any doc-snapshot must assert the **new** path/help/schema/error
  shapes; delete assertions on the space path and the card.

Acceptance: `rg` finds **zero** space-form path invocations and zero aligned-card help blocks in
the repo after the sweep.

## Out of scope / unchanged

The 7.0 contract otherwise stands: input = one quoted JSON5 object (`@file` / `-` / omitted=`{}`),
`--context` + `ARGC_CTX`, handler-return serialized as block YAML, stdout→stderr reroute, `@run`
print mode, identifier-only keys, unknown-key precheck, `run: false`. No new deps.
