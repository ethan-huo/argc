---
type: Spec
title: argc 7.0 behavior spec (BDD)
status: accepted
version: 0.3
timestamp: 2026-06-24
description: >
  Exhaustive Given/When/Then behavior spec for argc 7.0 — the source of truth for
  tests and for fixing code. Covers construction validation, path routing, input,
  context, output rendering, @schema (incl. selector grammar + fold), @run, and the
  error envelope. All decisions resolved (see Decisions §); this is the fix list.
---

# argc 7.0 behavior spec

Conventions:

- **Stream**: success → stdout, error → stderr; error exit code is non-zero.
- **Output grammar**: results & errors render as block YAML; `@schema` is an OKF
  envelope (`--- frontmatter --- body`); errors are a stable-code YAML envelope.
- A scenario tagged `[NEEDS-DECISION]` describes proposed behavior the code does not
  yet implement (or implements wrongly); confirm before fixing.
- `⟹` = expected stdout/stderr; `exit` = expected exit code.

The current error-code set: `BAD_INPUT_JSON`, `BAD_PATH`, `INVALID_INPUT`,
`NOT_A_COMMAND`, `RUN_DISABLED`, `RUNTIME_ERROR`, `TWO_INPUTS`, `UNKNOWN_COMMAND`.
This spec proposes adding `BAD_SELECTOR` (§6) and possibly `INVALID_CONTEXT` (§4).

---

## Feature 1 — Construction-time validation

```
Scenario: reject a command/group key that starts with `@`
  Given a schema with a key "@foo"
  When cli() is constructed
  Then it throws  "Invalid command key: @foo"  (not at runtime — at construction)

Scenario: reject a non-identifier command/group key
  Given a schema with a key "alert-create"
  When cli() is constructed
  Then it throws  "Invalid command key: alert-create"

Scenario: accept identifier keys (incl. reserved words as property names)
  Given keys like "list", "delete", "export", "core_v2"
  Then construction succeeds
```

Note: input-object field keys are NOT identifier-constrained (they mirror real
payloads, e.g. `content-type`); only command/group keys are.

---

## Feature 2 — Path & routing

Path is a single dotted token of identifier segments: `g1.c2.c3`.

```
Scenario: a top-level command
  When `cli greet "{ name: 'x' }"`
  Then the greet handler runs

Scenario: a nested command
  When `cli user.create "{ name: 'x' }"`
  Then the user.create handler runs

Scenario: space-separated path is rejected (no two spellings)
  When `cli user create "{...}"`
  ⟹ error: BAD_PATH
     got: user create
     $hint: paths are dotted — cli user.create "{ ... }"
  exit: non-zero
  Note: BAD_PATH's certain mistake is the separator, so it carries the dotted
  rewrite as `$hint` and NO `$schema`. If the dotted path is itself wrong, that
  resurfaces downstream as UNKNOWN_COMMAND (which embeds the slice).

Scenario: unknown command
  When `cli user.creat "{...}"`
  ⟹ error: UNKNOWN_COMMAND
     got: user.creat
     $schema: <slice of nearest resolved ancestor (outline when large)>
  exit: non-zero

Scenario: path stops at a namespace (incomplete)
  When `cli user`
  ⟹ error: NOT_A_COMMAND
     got: user
     $schema: <slice of the user namespace (outline when large)>
  exit: non-zero
```

`[DECIDED 2a]` UNKNOWN_COMMAND and NOT_A_COMMAND embed the nearest-ancestor `$schema`
slice (rendered as an outline when it exceeds the fold threshold) so the agent
self-corrects without a second call. BAD_PATH is the exception: it carries the
corrective dotted rewrite as `$hint` and no `$schema` — its mistake is the separator,
not the structure.

---

## Feature 3 — Input

Exactly one input slot after the path: one quoted JSON5 object, `@file`, `-`
(stdin), or omitted.

```
Scenario: inline JSON5 object
  When `cli user.create "{ name: 'alice' }"`
  Then input = { name: "alice" }

Scenario: from file
  When `cli db.seed @payload.json`
  Then input = parsed contents of payload.json

Scenario: from stdin
  When `echo '{ "n": 1 }' | cli x.y -`
  Then input = { n: 1 }

Scenario: omitted → {}
  When `cli cache.clear`
  Then input = {}

Scenario: two bare objects rejected
  When `cli user.create "{...}" "{ env: 'prod' }"`
  ⟹ error: TWO_INPUTS
     $hint: a command takes one input object; pass context via --context: ...
  exit: non-zero

Scenario: malformed JSON5
  When `cli user.create "{ name: 'al"`
  ⟹ error: BAD_INPUT_JSON
     detail: <parser message>
  exit: non-zero

Scenario: unknown input key (precheck, before schema strips it)
  When `cli user.create "{ name: 'alice', emial: 'x' }"`
  ⟹ error: INVALID_INPUT
     command: user.create
     issues:
       - at: emial
         message: unknown key
     $schema: create(input: { name: string; email?: string })
  exit: non-zero

Scenario: schema validation failure
  When `cli user.create "{ name: 'al' }"`   # too short
  ⟹ error: INVALID_INPUT
     command: user.create
     issues:
       - at: name
         message: "Invalid length: Expected >=3 but received 2"
     $schema: create(input: { name: string; email?: string })
  exit: non-zero
```

Issues embed the **normalized Standard-Schema list** (`at` = dotted path, `message`
verbatim), portable across zod/arktype/valibot. Not raw lib issues.

`[DECIDED 3a]` INVALID_INPUT embeds `$schema` = the command signature, and drops
`$hint` (general rule: `$schema` present ⟹ no `$hint`).

---

## Feature 4 — Context

```
Scenario: explicit per-call context
  When `cli x.y "{...}" --context "{ env: 'prod' }"`
  Then handler receives context = { env: "prod" } (validated, verbatim — no transform)

Scenario: ambient context from env
  Given ARGC_CTX="{ env: 'dev' }"
  When `cli x.y "{...}"`
  Then handler receives context = { env: "dev" }

Scenario: --context overrides ARGC_CTX
  Given ARGC_CTX="{ env: 'dev' }"
  When `cli x.y "{...}" --context "{ env: 'prod' }"`
  Then context = { env: "prod" }

Scenario: omitted context
  When neither --context nor ARGC_CTX
  Then context = validated {} (schema defaults apply)
```

`[DECIDED 4a]` Context that fails validation → `INVALID_CONTEXT` with the issues shape

- `$schema` = the Context type.

```
Scenario: context fails validation
  Given a context schema { env: 'dev' | 'prod' }
  When `cli x.y "{...}" --context "{ env: 'staging' }"`
  ⟹ error: INVALID_CONTEXT
     issues:
       - at: env
         message: <invalid enum value>
     $schema: type Context = { env: "dev" | "prod" }
  exit: non-zero

Scenario: context is malformed JSON5
  When `cli x.y "{...}" --context "{ env: "`
  ⟹ error: BAD_INPUT_JSON
     source: context
     detail: <parser message>
     $schema: type Context = { env: "dev" | "prod" }
  exit: non-zero
```

`[DECIDED 4b]` Malformed `--context`/`ARGC_CTX` JSON5 → `BAD_INPUT_JSON` with
`source: context` + the Context `$schema`. One JSON5-error code; `source` (input |
context) distinguishes the slot.

---

## Feature 5 — Output (success)

argc owns fd 1; handler return value is serialized.

```
Scenario: object/array → block YAML
  Given a handler returning { id: 1, name: "alice" }
  ⟹ (stdout)
     id: 1
     name: alice

Scenario: string → raw, verbatim
  Given a handler returning "env: prod\nreplicas: 3"   # YAML/CSV/any text
  ⟹ that text, unquoted, unescaped

Scenario: undefined → empty
  Given a handler returning undefined
  ⟹ (nothing); exit 0

Scenario: multiline string field → block scalar
  Given a handler returning { log: "a\nb" }
  ⟹ log: |-
       a
       b

Scenario: handler stdout writes do not pollute the result
  Given a handler that console.log("debug") then returns { ok: true }
  Then stdout = "ok: true\n"   (the console.log went to stderr)
```

---

## Feature 6 — `@schema`

Always an OKF envelope: `--- <frontmatter> --- <body>`. Frontmatter carries only
fields with a reason to exist (no `program` label). Body is the TS-shaped type, or
the compact outline when folded. Guidance is **dynamic** (matches state).

```
Scenario: full output (under fold threshold)
  When `cli @schema`
  ⟹ ---
     context: '{ env?: "dev" | "prod" }'        # only if the app declares context
     status: fully shown — no further selector needed
     call: cli <path> "<json5>"  ·  cli @run "<code>"
     ---
     type App = { ... }                          # method sigs, no return type, quoted non-id keys
  exit: 0
  And NO `next`/`selectors` keys (nothing to drill).

Scenario: folded output (over threshold)
  When `cli @schema`  on a large schema
  ⟹ ---
     status: compact outline — full schema is N lines across M commands; narrow with a selector
     next: cli @schema .<deep.path>
     selectors: |-
       .name            a child
       ."key"           a child whose name needs quoting
       .["key"]         a child by bracket key
       .*               all children
       .{a.{x,y},b.z}   a set: each branch a full sub-selector, any depth, nestable
       ..name           recursive search anywhere below
     call: cli <path> "<json5>"  ·  cli @run "<code>"
     ---
     ns1{svc{cmd,cmd},...}                        # flat name{children} outline (NOT a tree)
     ns2{...}
  exit: 0
```

### Selector grammar

```
Scenario: child key            .user                → the user subtree
Scenario: nested path          .user.create         → that command
Scenario: wildcard             .user.*              → all children of user
Scenario: set                  .user.{create,list}  → those children
Scenario: nested/composed set  .{a.{x,y},b.z.w}     → branches at different depths, unioned
Scenario: quoted key           ."weird key"         → child by quoted name
Scenario: bracket key          .["weird key"]       → child by bracket name
Scenario: recursive            ..create             → every `create` anywhere below
Scenario: whitespace tolerated .{a, b , c}          → same as .{a,b,c}
Scenario: a small selected subtree → full envelope (status: fully shown)
Scenario: a large selected subtree → folded envelope (status: compact outline ...)
```

### Selector errors `[NEEDS-DECISION 6a / 6b]`

```
Scenario: selector matches nothing            <-- currently WRONG (UNKNOWN_COMMAND got: <selector>)
  When `cli @schema .nope`
  ⟹ error: BAD_SELECTOR
     selector: .nope
     reason: matched nothing
     $schema: <slice of the search root (outline when large), so the structure is visible>
  exit: non-zero
  Rationale: @schema IS the command; the selector is its argument. A no-match is a
  bad selector, not an unknown command. Embedding the outline lets the agent see it
  is e.g. `compute.core.list`, not `compute.list` — fixing the exact mistake that
  motivated this spec.

Scenario: malformed selector                  <-- currently WRONG (RUNTIME_ERROR: Selector set cannot be empty)
  When `cli @schema .compute.{`
  ⟹ error: BAD_SELECTOR
     selector: .compute.{
     reason: <parse error, located>
  exit: non-zero

Scenario: more than one selector token
  When `cli @schema .a .b`
  ⟹ error: BAD_SELECTOR (or RUNTIME_ERROR) — @schema takes at most one selector
```

`[DECIDED 6a]` `BAD_SELECTOR` handles both no-match and malformed selectors (a `reason`
field distinguishes), replacing the current UNKNOWN_COMMAND/RUNTIME_ERROR.
`[DECIDED 6b]` `BAD_SELECTOR` (and bad path) embed the relevant outline `$schema`.

---

## Feature 7 — `@run`

```
Scenario: inline, last expression is the output
  When `cli @run "await user.list({})"`
  Then the value of the last expression is serialized (YAML)

Scenario: --json → strict JSON
  When `cli @run "await user.list({})" --json`
  ⟹ JSON.stringify of the (normalized) value

Scenario: file module
  When `cli @run @batch.ts`
  Then the return value of its default/main export is serialized; it receives `argc` only

Scenario: stdin code
  When `echo "1 + 1" | cli @run -`
  Then ⟹ 2

Scenario: args passthrough
  When `cli @run "argc.args" -- a b`
  Then argc.args = ["a","b"]

Scenario: disabled
  Given cli built with { run: false }
  When `cli @run "..."`
  ⟹ error: RUN_DISABLED
     $hint: this tool was built with { run: false }
  exit: non-zero

Scenario: a called handler's validation error keeps its envelope
  When `cli @run "await user.create({ name: 'al' })"`
  ⟹ error: INVALID_INPUT (the command's issues)
  exit: non-zero

Scenario: a thrown non-argc error
  When the snippet throws Error("boom")
  ⟹ error: RUNTIME_ERROR
     detail: boom
  exit: non-zero

Scenario: console.log inside @run is rerouted to stderr (stdout = the serialized value only)
```

`[DECIDED 7a]` `--json` is trailing-only: `@run <source> [--json] [-- args]`. One
spelling — `--json` after the code, never before (`@run --json "code"` is an error).

---

## Feature 8 — Built-ins & dispatch

```
Scenario: bare invocation = help
  When `cli`            ⟹ same as `cli --help`

Scenario: --help is YAML (program / help markdown / examples / context)
  When `cli --help`
  ⟹ program: ...
     help: |-
       <markdown: discovery-first — run @schema; how to call; @run; selectors>
     examples: |-
       <verbatim concrete invocations from the schema>
     context: |-
       type Context = ...

Scenario: --version
  When `cli --version`  ⟹ the version string

Scenario: @completions
  When `cli @completions [bash|zsh|fish]`  ⟹ completion script (path-level only)

Scenario: @-prefix dispatch is position-aware
  `cli @run ...`    → first token @x = built-in
  `cli x.y @f.json` → @f.json in the input slot = file input, NOT a built-in
```

---

## Feature 9 — Error envelope (cross-cutting)

```
Scenario: every error is a YAML envelope on stderr
  ⟹ error: <STABLE_CODE>
     <code-specific fields>
     [$schema: <embedded slice>]   when a schema slice aids correction
     [$hint: <recovery>]           when there is advice but no schema target
  exit: non-zero

Rules:
  - Success vs error is told by the STREAM, not the `error:` key (a handler may
    return data containing an `error` field on stdout).
  - When `$schema` is embedded, drop the redundant `$hint`.
  - `$schema` slices reuse the schema-explorer size-guard (huge slice → outline).
  - Block scalars are `|-` (literal), never `>` (folding breaks types).
```

Codes & when:

| code              | when                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `BAD_PATH`        | space/malformed command path ($hint = dotted rewrite; no $schema)   |
| `UNKNOWN_COMMAND` | a command path segment does not exist                               |
| `NOT_A_COMMAND`   | path resolves to a namespace, not a command                         |
| `BAD_INPUT_JSON`  | input object is not valid JSON5                                     |
| `TWO_INPUTS`      | more than one bare input object                                     |
| `INVALID_INPUT`   | unknown key or schema validation failure (embeds command `$schema`) |
| `INVALID_CONTEXT` | context fails validation (embeds Context `$schema`)                 |
| `BAD_SELECTOR`    | `@schema` selector malformed or matches nothing (embeds root slice) |
| `RUN_DISABLED`    | `@run` used when `{ run: false }`                                   |
| `RUNTIME_ERROR`   | uncaught handler/snippet error, or other internal failure           |

---

## Decisions (resolved — this is the fix list)

1. **$schema on path/selector errors → embed the relevant slice** (rendered as an
   outline when it exceeds the fold threshold; full typed slice when small —
   more useful, fewer round-trips). `UNKNOWN_COMMAND`, `NOT_A_COMMAND`, and
   `BAD_SELECTOR` carry `$schema` = the nearest-ancestor / search-root slice.
   `BAD_PATH` is the exception: corrective dotted rewrite as `$hint`, no `$schema`
   (the mistake is the separator). General rule: no `$hint` when `$schema` is present.
2. **Add `BAD_SELECTOR`.** Both a malformed selector and a no-match route to it
   (a `reason` field distinguishes), replacing the old UNKNOWN_COMMAND/RUNTIME_ERROR
   for `@schema` selector failures. It embeds the search-root slice (outline when large).
3. **Add `INVALID_CONTEXT`** for context that fails schema validation: `issues` +
   `$schema` = the Context type.
4. **Malformed `--context`/`ARGC_CTX` JSON5 → `BAD_INPUT_JSON` with `source: context`**
   - `$schema` = the Context type. No second JSON5-error code (one way — §-principle);
     `source` distinguishes input vs context.
5. **`INVALID_INPUT` embeds `$schema`** (the command signature) and drops `$hint`.
   General rule: when `$schema` is present, omit `$hint`.
6. **`@run --json` is trailing-only**: `@run <source> [--json] [-- args]`. One spelling;
   `--json` after the code, never before. (Already enforced — source is the first token.)

This spec is now the test matrix (`src/v7.test.ts`) and the implementation fix list.
