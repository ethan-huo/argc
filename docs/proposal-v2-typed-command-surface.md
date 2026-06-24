---
type: Proposal
title: argc v2 — typed command surface for agents
status: draft
version: 0.4
timestamp: 2026-06-24
description: >
  Redesign argc from a flag-based CLI framework into a typed command surface for
  agents: path + one quoted object input, @run code mode, @schema typed API, and
  argc-owned output. Results and errors render as block YAML (yaml lib); errors
  are a stable-code envelope embedding normalized Standard-Schema issues. Clean
  break; supersedes proposal-at-commands-and-print-mode (a subset).
---

# Proposal v2: argc as a typed command surface for agents

Status: Draft
Supersedes: `docs/proposal-at-commands-and-print-mode.md` (its `@`-commands + print-mode are
now a subset of this design).
Scope: argc core + the downstream tool family (ghd / ctx / slack / calque / mcpx).
Compatibility: **clean break / new major.** These tools are agent-primary and serve us only.
No shims; old paths deleted.

## 1. Thesis

argc stops being a _CLI framework optimized for humans typing flags_ and becomes a **typed
command surface for agents that happens to be shell-invocable**. The schema (a TS type) is the
single source of truth; every form is a projection of it.

Why: in practice these tools are never hand-invoked — they are called by agents. The flag layer
(camelCase↔snake, repeat-for-array, dot-for-nested, positional args, `--input`) was built well,
but for an agent reader it is _loose, redundant encoding_ that adds rules to learn and surfaces
to hallucinate on. The ideal call is a single typed object literal.

### 1.1 The whole surface, in three forms

All three share **one object shape**, isomorphic to what `@schema` prints:

```
cli @schema .g1.c2                →  c2(input: { name: string })
cli g1.c2 "{ name: 'x' }"          →  the same call (no code, auditable, no code-exec needed)
cli @run "await g1.c2({ name: 'x' })"  →  the same call, composable
```

Read the type → write the object. One mental model.

### 1.2 Agent workflow (this is what the rendering is shaped for)

- **No skill (cold start):** `--help` → `@schema` → call.
  `--help` orients ("how do I call this, what context exists"); `@schema` is the working
  reference; the **error output is the correction loop**.
- **With a skill:** `@schema` → call. The skill carries the _workflow_; the commands no longer
  need prose explanation — the type and the errors describe themselves.

This is why §4 invests in three render targets — `--help`, `@schema`, and **errors** — over
everything else.

## 2. Call contract

```
cli <path> [<input>] [--context <ctx>]
cli @run '<code>' [--json] [-- <args>...]
cli @schema [.selector]
cli @completions [shell]
cli --help | --version
cli                       # == cli --help
```

- **`<path>`** one dotted command path token (`g1.c2`). Keys **must be valid JS
  identifiers** (§2.3.1) so the _same_ key works as a path segment, an `@schema` method name, and
  a bare `@run` property (`g1.c2(...)`).
- **`<input>`** exactly **one argv token**: a JSON5 object, or `@file` / `-` (stdin). Omitted =
  `{}`. Keys are **verbatim** schema keys (no case conversion). The object **must be a single
  shell token — quote it**:

  ```
  cli user.create "{ name: 'alice', tags: ['admin'] }"   # JSON5 single-quotes nest in shell ""
  cli db.seed @payload.json                                # large/complex → file
  cli db.seed -                                            # or stdin
  ```

  argc does **not** reassemble brace-split tokens: once a shell word-splits `{ name: 'alice' }`,
  string quoting is irrecoverable (`'alice'` vs bare `alice`), so reassembly would be lossy and
  is rejected. Parse errors locate within the single token (§4.5). Two bare objects is an error —
  context goes via `--context`.

- **`--context <ctx>`** the one surviving flag: a single object-valued, order-free slot for
  cross-cutting config. Default comes from `ARGC_CTX` env; `--context` overrides per call.
  It is _not_ the per-field flag layer we deleted — zero per-field machinery.
- **`@`-prefix** is reserved for framework commands at the **first token** (`cli @run`,
  `cli @schema`); enforced at `cli()` construction, non-overridable by default. An `@file` or
  `-` in the **input slot** (after the resolved path) is a file/stdin input, _not_ a built-in —
  position disambiguates (app command keys are identifiers, never `@`-led).
- **`run: false`** in `cli()` options disables `@run` (arbitrary code-exec gate); `@schema` /
  `@completions` stay available.

### 2.1 What is deleted (the kill list)

flags-as-input-encoding · camelCase↔snake (`naming.ts`/`normalizeFlagsForFields`) ·
`--input` (subsumed by the bare object) · positional args (`.args()`) · CLI string→value
coercion (`coerce.ts` — JSON5 carries types) · command **aliases** (anti-signal: one command,
one name) · prose `--help` per command · the verbose git-style did-you-mean block · the
`@schema` "CLI Syntax: flags/arrays/objects" preamble.

Kept: **schema transforms** (`string → Date / Bun.file / URL` — value enrichment, orthogonal to
parsing); hook events (`emit`); selector grammar; completions (path-level).

### 2.2 Context API — decided: no transform

This gates the parser, help rendering, handler `context` type, and `@run` context, and has been
deferred twice. Default is now taken to unblock: **drop the v1 `context: (globals) => …`
transform.**

- App declares a context schema: `cli(schema, { context: v.object({ env: …, verbose: … }) })`.
- The caller object is validated and passed to handlers **verbatim** as `context` — no
  derivation layer. A handler wanting `log()` derives it from `context.verbose` itself.
- Flag is **`--context <obj>`**; ambient default is **`ARGC_CTX`** (parsed as JSON5, same
  validation).
- In `@run`, `argc.context` is the same validated object.

Veto only if a real caller→handler derivation need exists; then keep the transform and rename the
caller-side flag to `--ctx`. Absent that, verbatim wins (one less layer).

### 2.3 v1 → v2 delta (so reviewers don't match the old spec)

Every v1 behavior below is **removed or changed**. Treat the v1 implementation as the _before_,
not the contract — this table is the demolition plan Codex's first pass was missing.

| v1 behavior (file)                                                                                               | v2                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Handler` returns `void`; `CLI.run()` discards the result (`types.ts:104`, `cli.ts:505`)                         | **changed**: handlers return a value; argc serializes it to stdout (§3). `Handler`, `RunConfig`, and `findHandler` (`router.ts:11`) return types change. |
| command/group keys may be any string incl. dashed `alert-create` (`schema.ts:311`, `schema-explorer.test.ts:25`) | **removed**: keys must be valid JS identifiers (§2.3.1), rejected at construction.                                                                       |
| command aliases: routing in `extractCommand()` (`cli.ts:578`) + alias completion (`complete.ts:180`)             | **removed**: one command, one name. Touches routing, "unknown command" errors, and completion candidates.                                                |
| flag parsing / camelCase↔snake (`naming.ts`, `normalizeFlagsForFields`)                                          | **removed**                                                                                                                                              |
| positional args `.args()`                                                                                        | **removed** (object subsumes)                                                                                                                            |
| `--input` flag + `input`-field collision handling (`cli.ts:401`)                                                 | **removed** (the bare object _is_ the input)                                                                                                             |
| CLI string→value coercion (`coerce.ts`)                                                                          | **removed** (JSON5 carries types; schema transforms stay)                                                                                                |
| `context: (globals) => …` transform                                                                              | **removed** (§2.2)                                                                                                                                       |
| `@schema` CLI-syntax / case-conversion preamble                                                                  | **removed** (§4.2)                                                                                                                                       |
| per-command prose `--help`                                                                                       | **removed** (→ `@schema`)                                                                                                                                |
| verbose git-style did-you-mean block                                                                             | **changed** → terse structured suggestion (§4.5)                                                                                                         |

#### 2.3.1 Command keys: identifiers only

A command/group key must match `/^[A-Za-z_$][A-Za-z0-9_$]*$/`. One rule then holds across all
three forms — path `cli g1 c2`, `@schema` method `c2(input)` (no quoting ever needed),
and `@run` `g1.c2(...)`. Enforced at `cli()` construction next to the `@`-key rejection.
Downstream tools using dashed command names must rename — inventory before release.

---

## 3. Output model (the contract behind all rendering)

**argc now owns result serialization.** This is a deliberate reversal of v1 ("stdout is
application-owned"). For a typed command surface, output must be a contract:

- A handler's **return value** is serialized to stdout. `cli g c "{…}"` and
  `@run "await g.c({…})"` therefore produce **identical** output.
- **argc owns fd 1.** During handler / `@run` execution, `process.stdout` writes (incl.
  `console.log`) are **rerouted to stderr**, so the _only_ bytes on stdout are the serialized
  return value. This keeps the result contract — and `@run --json` parseability — uncorrupted,
  while debug output still survives on stderr.
- `emit()` remains the side-channel for structured progress / telemetry (hook events).
- A handler that needs raw text output **returns a string** (strings render raw, §4.4).

Serialization is one shared pipeline (direct calls and `@run`): **normalize → render**.

1. **normalize** non-plain JS types (shared by YAML and `--json`): bigint→string, Map→object,
   Set→array, Date→ISO, function/`undefined`→omitted.
2. **render**:

| Return value  | stdout                                                          |
| ------------- | --------------------------------------------------------------- |
| `undefined`   | empty (pure side-effect)                                        |
| `string`      | **raw, verbatim** — emitted _before_ YAML, never quoted/escaped |
| anything else | **block-style YAML** (`yaml` lib, `lineWidth: 0`)               |

Default output is **block YAML**, not `Bun.inspect` and not a flow dump: it is structured _and_
readable — clean KV, real block scalars (`|`) for multiline — without the looseness of
concatenated prose. (`Bun.YAML.stringify` is flow-only and mangles multiline, so we depend on the
`yaml` lib.) The `string` case is **load-bearing and bypasses YAML** (YAML would quote/fold it): a
handler returning YAML / CSV / NDJSON / any custom text passes through **untouched**; the YAML
renderer only ever sees non-strings. Success → stdout, error → stderr (§4.5), exit code matches.

**`--json` is a `@run`-only flag — direct calls have no `--json`.** Default YAML is already
readable _and_ parseable; `--json` is the strict-JSON consume path. This encodes a
**read-vs-consume** split:

- **Direct call** (`cli g c "{…}"`) — the _handler_ owns the representation: `return` a string for
  a custom format, or a value for the YAML view. The caller does not re-format.
- **`@run … --json`** — the _caller_ owns the final value (they wrote the expression), so they may
  ask for strict JSON (`normalize` + `JSON.stringify`) — for `jq` / chaining a stricter parser.

Wanting strict-JSON output of one call is itself the atomic→composition boundary: escalate to
`@run "await g.c({…})" --json`. A `run: false` tool has no `--json`; YAML output is already
parseable, and a handler can `return` a JSON/YAML **string** for an exact representation.

---

## 4. Rendering design ← primary review focus

### 4.0 Principles

1. The type is the source of truth; every screen projects from it.
2. No human-CLI scaffolding (no flag syntax notes, no case-conversion notes, no prose tutorials).
3. High signal / low noise. Where it is data, it is machine-shaped.
4. **Errors speak the schema's vocabulary and teach the type** — they are the correction loop.
5. **One output grammar: block YAML.** Command results _and_ error envelopes (§4.5) are YAML —
   structured KV an agent parses, never loose prose. Tool-meta keys take a `$`-prefix (`$hint`).
   Help (§4.1) and `@schema` (§4.2) are the exception: YAML orientation and a TS type.

### 4.1 `cli` and `cli --help`

`cli` with no args == `cli --help`. Not per-command help — a YAML orientation block: how to
call, the context type, and examples shared with `@schema`.

```yaml
program: mcpx — media pipeline control
help: >-
  Call:  <path> "<json5>"   (input = one quoted JSON5 object, or @file / -).
  Code:  @run "<code>".   Types:  @schema [.selector].
examples:
  - mcpx user.create "{ name: 'alice', tags: ['admin'] }"
  - mcpx user.create "{ name: 'alice' }" --context "{ env: 'prod' }"
  - mcpx @run "await user.create({ name: 'alice' })" --json
  - mcpx @schema .user
context: 'type Context = { env: "prod" | "dev"; verbose?: boolean }'
$selectors: .name  ."key"  .*  .{a,b}  ..name
```

Design notes: example-driven, not prose. The Context type is rendered inline (it is the one
cross-cutting thing an agent sets). The selector mini-grammar lives here so the agent can drive
`@schema` without a second lookup.

### 4.2 `cli @schema` — the typed API

Valid, parseable TypeScript. Descriptions become JSDoc; one object-form example per command.
The v1 flag/array/object syntax preamble and all case-conversion notes are **removed**.

```ts
// mcpx — media pipeline control
//
// Call:  <path> "<json5>"   ·   @run "<code>"   ·   @schema [.selector]
//   mcpx user.create "{ name: 'alice', email: 'a@x.com' }"

type Context = { env: 'prod' | 'dev'; verbose?: boolean } // --context / ARGC_CTX

type App = {
	user: {
		/** Create a user. */
		// mcpx user.create "{ name: 'alice', email: 'a@x.com' }"
		create(input: { name: string; email?: string })

		/** List users. */
		list(input: { format?: 'json' | 'table' })
	}

	db: {
		/** Seed the database from a JSON file. */
		seed(input: { file: string })
	}
}
```

- Commands render as **method signatures** so the shape matches both the direct call and
  `@run`. No-input commands render `name()`.
- **No return type — by design.** In a call→observe loop a declared output type is dead weight;
  and since argc validates _input only_ and never checks handler returns, any declared output
  type would be an **unverified claim that can drift from the real return** — worse than nothing.
  Method signatures render without a return annotation (valid TS, implicit `any`); the agent
  reads the actual shape from the output it gets back.
- Keys are verbatim. A `'json' | 'table'` literal union renders as-is — the agent sees exactly
  what is accepted.
- Command keys are identifiers (§2.3.1), so method names render **unquoted**.
- **Input field keys are _not_ identifier-constrained** (they mirror real payloads, e.g.
  `content-type`). The renderer **quotes non-identifier property names** so the output stays valid
  TS: `create(input: { "content-type"?: string; name: string })`. (Command keys = our naming,
  identifiers; input keys = domain data, quoted-when-needed.)

### 4.3 `cli @schema .selector` and outline mode

**Reuse the existing schema explorer as-is** (`createDefaultSchemaExplorer`:
`outline` / `select` / `hint` / `maxLines`, `schema-explorer.ts`). Selector narrowing, the
large-schema compact outline with its line/command counts, the `next:` hints, and the
empty-match **failure** (exit non-zero so a typo never reads as an empty API) are all fine and
stay. **Do not reinvent the outline format.**

The only deltas to the explorer are the ones already in §4.2 — emit valid TS, drop the
CLI-syntax / case-conversion preamble — plus swapping the hint invocation from `--schema=.x` to
`@schema .x`.

### 4.4 Command success output

The handler's return value, serialized per §3 — **block YAML** for structured values. A direct
call has no `--json`; the `@run … --json` path is strict JSON.

```
$ mcpx user.list "{ format: 'table' }"     # array of objects → block YAML (read view)
- id: 1
  name: alice
  role: admin
- id: 2
  name: bob
  role: user

$ mcpx job.status "{ id: 42 }"             # object → YAML; multiline value → block scalar
id: 42
state: failed
log: |-
  step 1 ok
  step 2 failed: timeout

$ mcpx config.export "{ format: 'yaml' }"  # handler returns a YAML string → raw, untouched
env: prod
replicas: 3

$ mcpx cache.clear "{ all: true }"         # returns undefined → empty output, exit 0

$ mcpx @run 'await user.list({ format: "json" })' --json   # consume view: strict JSON
[
  { "id": 1, "name": "alice", "role": "admin" },
  { "id": 2, "name": "bob", "role": "user" }
]
```

### 4.5 Error output ← the correction loop, design carefully

Every error is a **YAML envelope on stderr** (non-zero exit), with the same skeleton:

```
error: <STABLE_CODE>     # SCREAMING_SNAKE — machine-branchable
<code-specific fields>
$hint: <how to recover>  # $-prefixed tool-meta
```

Codes are a small stable enum: `INVALID_INPUT`, `UNKNOWN_COMMAND`, `NOT_A_COMMAND`,
`BAD_INPUT_JSON`, `TWO_INPUTS`, `RUN_DISABLED`, `RUNTIME_ERROR`. Success vs error is told by the
**stream** (stdout vs stderr), not by the `error:` key — a handler may legitimately return data
with an `error` field on stdout.

**Invalid input** — the most important one. `issues` is the **normalized Standard-Schema issue
list, embedded as-is** (per-issue `at` = dotted path, `message` = verbatim) — no bespoke error
vocabulary, and portable across zod/arktype/valibot. Raw lib issues are _not_ embedded (valibot's
path segments echo the whole input object and carry lib-specific fields). argc's own unknown-key
precheck (§5) contributes issues in the same shape.

```
$ mcpx user.create "{ name: 'al', emial: 'a@x.com' }"
error: INVALID_INPUT
command: user.create
issues:
  - at: name
    message: "Invalid length: Expected >=3 but received 2"
  - at: email
    message: required
  - at: emial
    message: unknown key
$schema: |-
  create(input: { name: string; email?: string })
```

**Unknown command / typo** — terse suggestion, not the old prose block:

```
$ mcpx user.creat "{ name: 'alice' }"
error: UNKNOWN_COMMAND
got: user.creat
did_you_mean: user.create
$schema: |-
  user: { create(input: { name: string }) }
```

**Path stops at a namespace** — list the namespace's commands:

```
$ mcpx user
error: NOT_A_COMMAND
namespace: user
commands:
  - user.create
  - user.list
$schema: |-
  user: { create(input: { name: string }); list(input: { format?: string }) }
```

**Malformed input object** — surface the JSON5 parse failure verbatim:

```
$ mcpx user.create "{ name: 'al"
error: BAD_INPUT_JSON
detail: |-
  unterminated string
    { name: 'al
              ^
```

**Two bare objects** — the contract violation, with the corrected form:

```
$ mcpx user.create "{ name: 'a' }" "{ env: 'prod' }"
error: TWO_INPUTS
$hint: |-
  a command takes one input object; pass context via --context:
  mcpx user.create "{ name: 'a' }" --context "{ env: 'prod' }"
```

**`@run` runtime error** — the thrown error; an `INVALID_INPUT` thrown by a called handler keeps
its own envelope:

```
$ mcpx @run "await user.create({ name: 'al' })"
error: INVALID_INPUT
command: user.create
issues:
  - at: name
    message: "Invalid length: Expected >=3 but received 2"
```

**`@run` disabled** — deterministic:

```
$ mcpx @run "…"
error: RUN_DISABLED
$hint: this tool was built with { run: false }
```

### 4.6 Machine-readable errors — already covered

No separate JSON error mode is needed: the YAML envelope (§4.5) is **already structured and
parseable**, with a stable `error:` code and an embedded normalized `issues` list. An agent
branches on `error:` and reads `issues[].at` / `.message` directly. A strict-JSON variant
(`ARGC_ERROR=json`) is trivial to add later but is not in scope.

### 4.7 `--version`, `@completions`

`--version` → the version string, nothing else. `@completions [shell]` → completion script
(path/segment completion only; no flag completion since there are none).

---

## 5. Implementation map (logic → Codex review)

- `src/parser.ts` — **position-aware** tokenize: first token `@name`→built-in command; else walk
  path segments (identifiers) until the input slot, where `{`-leading→input object (one max, no
  brace reassembly — §2) and `@file`/`-`→file/stdin input; `--context`→consumes one object,
  order-free. `@file`/`-` in the input slot are inputs, **not** built-ins.
- `src/types.ts` — **public API changes**: `Handler` return type `void`→`R` and serialize it
  (§3); update `RunConfig` accordingly; `CLIOptions.run?: boolean`; `CLIOptions.context` = a
  context schema (no transform, §2.2); remove `.args()` from the command builder; tighten
  command-key type if feasible.
- `src/router.ts` — `findHandler` return type carries the handler's value (`router.ts:11`).
- `src/cli.ts` — drop flag/positional/coerce/`--input` pipeline incl. the `input`-field
  collision branch (`cli.ts:401`); remove **alias routing** in `extractCommand()` (`cli.ts:578`);
  route path → **unknown-key precheck on the bare object** (keep v1's check at `cli.ts:707` —
  Standard Schema libs strip unknown keys silently, and §4.5's `unknown key` error depends on it)
  → validate → reroute handler stdout→stderr (§3) → **serialize the handler return** (replaces the
  discard at `cli.ts:505`); `@`-command dispatch; parse `--context` / `ARGC_CTX`; pass `run`.
- `src/command.ts` / `cli()` constructor — reject command/group keys that start with `@` **or**
  are not valid identifiers (§2.3.1), recursively through groups.
- `src/script.ts` — `runEval`→`runPrint` (oxc-parser → wrap last expression → AsyncFunction →
  §3 serialize); inline bare-local injection; file mode serializes `default`/`main` return and
  still receives `argc` only (no bare locals — see proposal-at-commands §3.3); `--json`;
  `run:false` gate; expose `argc.context`.
- `src/complete.ts` — drop **alias completion candidates** (`complete.ts:180`); complete
  `@`-commands and path segments only.
- `src/help.ts` — rewrite to §4.1.
- `src/schema-explorer.ts` / `src/schema.ts` — **reuse** existing outline/select/hint/maxLines;
  changes limited to: emit valid TS (§4.2) — identifier command keys unquoted, **non-identifier
  input field keys quoted** (`{ "content-type"?: string }`, `schema.ts:140`); delete the
  CLI-syntax/case-conversion preamble; swap hint syntax `--schema=.x`→`@schema .x`. Do not
  reinvent the outline.
- new `src/render.ts` (suggested) — the single layer shared by direct calls and `@run`:
  **normalize → YAML/JSON** result serialization (§3), the **error envelope** with stable codes +
  embedded normalized issues (§4.5), and the **stdout→stderr interception** during execution. One
  place owns output, so direct call and `@run` stay byte-identical.
- error issues reuse argc's existing path-normalization (`cli.ts:436` — `path→dotted`, `message`
  verbatim); do **not** embed raw lib issues (valibot path segments echo the whole input + carry
  lib-specific fields).
- delete: `coerce.ts`, `naming.ts` flag-normalization, alias routing, positional handling.
- New deps: `oxc-parser` (`@run`), `yaml` (output rendering — `Bun.YAML.stringify` is flow-only).
- Tests/docs: rewrite README around the three forms; migrate `@add` and dashed-key fixtures
  (`schema-explorer.test.ts:25`); inventory downstream tools for dashed command names + aliases;
  add tests for the call contract, identifier/`@`-key rejection, handler-return serialization,
  every render target in §4, and `run:false`.

## 6. Decisions & open questions

**Frozen** (confirmed in review):

- **Command/group keys must be valid JS identifiers** (§2.3.1) — downstream dashed names rename.
- **No context transform** (§2.2) — the validated `context` object reaches handlers verbatim.
- **No output types / per-command output schemas** (§4.2) — rejected on principle: call→observe;
  a declared return is dead weight and, being unverified, can drift from the real value.

**Open** (non-blocking):

1. **Strict JSON error mode** (`ARGC_ERROR=json`, §4.6) — deferred; the YAML envelope is already
   structured and parseable.
2. `@help`/`@version` aliases for `--help`/`--version`, or skip.
3. **Downstream inventory** — confirm no family tool relies on dashed command names or aliases
   before the clean break.
