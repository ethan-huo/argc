---
type: Proposal
title: argc 7.1 — a quarantined human path beside the agent surface
status: draft
version: 0.4
timestamp: 2026-06-24
description: >
  Restore the pre-7.0 human-typed CLI form (positionals + --flags + schema-driven
  coercion) as a SECOND, fully-isolated dispatch path that desugars into the exact
  same input object and handler as the agent surface — without touching, and without
  being visible to, the agent surface (@schema / @run / errors / skill / docs). This
  document is an EVALUATION REQUEST: the design is plausible; the open question is
  whether the two paths can be partitioned safely and reliably. The collision matrix
  (§4) and the coercion problem (§5) are the parts Codex must adjudicate. v0.2 folds in the
  first Codex review (see the change note under the title).
---

# Proposal 7.1: a quarantined human path beside the agent surface

> **Changes in 0.2 (from Codex review v1):** added collision **L10** (leading-`--` positional);
> resolved the array-flag naming contradiction to **verbatim-only** (no singularization);
> corrected §5.2 — the public introspection is **not** parser-grade, a structured field descriptor
> is a prerequisite, not a free reuse; **locked positional to explicit `.positional()`** (was open
> Q5); added **fail-fast on unknown human flags**. Review confirmed the core dispatch is safe.
>
> **Changes in 0.3 (from Codex review v2):** `--context` / `--help` / `-h` are **control tokens**,
> handled before the dispatch split — not human flags; the `--help` / `-h` discovery path is a
> control short-circuit that reaches **no handler**; fixed the stale L8 row (verbatim `--tags`, no
> singular) and the stale §7 Q-numbering; §7 isolation now reads "no change to agent schema
> _rendering_" (`schema.ts` gains only the additive structured descriptor).
>
> **Changes in 0.4 (from Codex review v3):** removed the `--no-*` negation namespace — it collided
> with verbatim `no-`-prefixed keys (e.g. `no-cache`); boolean `false` is now the attached
> `--key=false` form (added **L11** + decided **#9**). Review greenlit on this fix.

Baseline: **argc 7.0 as shipped** (`867a9fd`) plus the 7.0 evolution CR (`12f9ecc`) and the
behavior spec (`docs/spec-7.0-behavior.md`). This proposal is **additive** — it changes no 7.0
behavior; it claims an argv branch that 7.0 currently only uses to emit `BAD_PATH`.

## 1. Problem

7.0 deleted the human-typed CLI form on principle (proposal-v2 §2.1 kill-list: flag parsing,
positional args, `coerce.ts`, `naming.ts`). For an **agent** reader that was correct — one
encoding, isomorphic across `<path> "{obj}"` / `@run` / `@schema`.

But some commands are typed by **humans and agents both**, especially simple ones. The motivating
case is real and frequent:

```
claw read docs/spec-7.0-behavior.md --toc        # what a human wants to type
claw read "{ file: 'docs/spec-7.0-behavior.md', toc: true }"   # what 7.0 forces
```

Forcing the second form on a human at the terminal is the regression. We do **not** want to undo
7.0 to fix it.

## 2. The invariant we must not break

7.0's real asset is **not** "globally one syntax." It is the narrower, load-bearing invariant:

> The **agent** sees exactly one input encoding, and `<path> "{obj}"`, `@run`, and `@schema`
> are isomorphic projections of one object shape.

"One thing, one way" (cr-7.0 §guiding-principle) was a rule for the **agent reader** — fewer
surfaces to learn, fewer to hallucinate. A human form does **not** violate it **iff the human
form is invisible to the agent**: never rendered by `@schema`, never valid in `@run`, never
embedded in an error `$schema` slice, never documented in the skill. The human form is a fourth
door, for humans only; it is not one of the three isomorphic agent forms and is not claimed to be.

**Decided premise (not under evaluation):** the human path lives **in core**, and all
schema-bearing surfaces remain agent-only. For the human it is _hidden knowledge_ — rediscovered
via habit and `--help`, never pushed into agent-facing material.

What Codex evaluates is **only §4 (is the partition safe?)** and **§5 (is coercion reliable?)**.

## 3. Design

### 3.1 Two paths, one handler

After the path token resolves to a command, argc reads what follows. **Control tokens are handled
first and are NOT part of the dispatch split:**

- `--context <obj>` — the surviving cross-cutting slot, processed wherever it appears (7.0
  behavior, `cli.ts:361`). It is **not** a human flag, even though it starts with `--`; an
  `omitted-input + --context` call like `cli cache.clear --context "{…}"` must keep working.
- `--help` / `-h` — the human discovery path (§3.4); a **control short-circuit** that renders the
  usage view and exits, reaching no handler and no input pipeline.

Everything else is the **input slot**, whose first token selects the dispatch path — and the two
token sets are **disjoint by construction**:

| First input-slot token | Path      | Form                                  |
| ---------------------- | --------- | ------------------------------------- |
| _(absent)_             | agent     | `{}`                                  |
| starts with `{`        | agent     | JSON5 object literal (7.0, unchanged) |
| starts with `@`        | agent     | `@file` input (7.0, unchanged)        |
| exactly `-`            | agent     | stdin (7.0, unchanged)                |
| any other `--flag`     | **human** | a flag → schema-driven desugar        |
| any other bare word    | **human** | a positional → schema-driven desugar  |

(The control tokens above are excluded from this table by definition — "any other" means after
`--context` / `--help` / `-h` are accounted for.)

The human branch is the one 7.0 currently spends only to throw `BAD_PATH` (`cli.ts:380-391`,
the "space path" rejection). The change is surgical: that branch hands off to a human parser
instead of erroring.

Both **dispatch** paths converge on the **same** validated input object and the **same** handler
(the `--help` / `-h` discovery path is a control short-circuit, §3.4, and reaches no handler). The
human parser is a one-way projection `argv → input object`; there is no reverse, and nothing
downstream can tell which door was used.

### 3.2 What the human parser produces

It reads the resolved command's input JSON Schema (`readJsonSchema(schema, 'input')`,
`schema.ts:156`) and parses argv **schema-aware, in a single pass**:

- **positionals** → declared positional fields, in order (§3.3);
- **`--flag`** on a boolean field → `true`; **`--flag=false`** → `false` — the **attached `=` form
  only**, because a boolean never consumes the _next_ token (L4); there is **no** `--no-*` namespace
  (L11 / §5.3);
- **`--key value`** / **`--key=value`** → that field, value coerced by declared type (§5);
- **repeatable** `--tags a --tags b` on an array field → `['a','b']` — the flag is the **schema
  key verbatim** (`tags`), never singularized; singularization is `naming.ts` by another name (§5.3);
- **deep/complex nesting is not supported via flags** — the human falls back to the object form
  for those commands (the `{...}` escape hatch always exists). Whether shallow one-level dotted
  (`--user.name`, feat `859b65e`) is worth keeping is an open question (§6 Q4).

The result is fed to the **existing** validation and rendering pipeline unchanged — same
`INVALID_INPUT` envelope, same success YAML.

### 3.3 Positional declaration

Flags can be derived automatically from the schema (flag name = schema key, verbatim — §5.3).
Positional _order_, however, is not in the schema, so a command opts in:

```ts
command({ input: ReadInput }).positional('file') // file → positional[0]
```

A command with no `.positional(...)` is flag-only on the human path. (Builder shape is
illustrative; Codex may propose a better surface.)

### 3.4 Discovery: one pull-based human surface

`@schema` stays agent-only and object-only. The human gets a separate, **pull-based** view:

- `claw <path> --help` / `claw <path> -h` → a usage block (positionals, flags, types,
  descriptions) regenerated from the schema. This is the _only_ place the human form is visible.
  It is a **control short-circuit after the path resolves**: it renders and exits, never entering
  the handler or the input pipeline (§3.1).

It is not advertised in `SKILL.md`, the README agent sections, or `@schema` output.

## 4. Collision matrix — **the safety evaluation**

The partition in §3.1 is only safe if every leak is closed or consciously accepted. Reviewed once
(Codex v1); the verdicts below stand, with **L10 added** — the fourth-class overlap review caught.

| #   | Case                                                          | Risk                                                                      | Proposed verdict                                                                                                                                                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | positional value is exactly `-`                               | collides with stdin                                                       | `-` is reserved for stdin; a literal `-` positional must go through a flag or object form. Accept.                                                                                            |
| L2  | positional value starts with `@` (`@scope/pkg`)               | collides with `@file`                                                     | `@`-leading positional = `@file`. Literal `@…` value → use `--flag @…` or object form. Accept.                                                                                                |
| L3  | positional value starts with `{`                              | collides with object literal                                              | `{`-leading = object form. Literal brace value → flag or object form. Accept.                                                                                                                 |
| L4  | `--bool nextword` (boolean flag before a positional)          | old schema-blind lexer ate the positional                                 | **single-pass schema-aware parse**: a boolean field never consumes a value (§5.1). Must verify.                                                                                               |
| L5  | a field literally named `context`                             | collides with the surviving `--context` slot                              | `--context` is always the cross-cutting slot; field `context` is reachable only via object form.                                                                                              |
| L6  | mixing forms: `<path> "{…}" --toc`                            | reintroduces object⊕flag merge (cf. `070e5e5`)                            | **forbidden.** Object form takes only `--context`; flag form takes no `{…}`. One door per call.                                                                                               |
| L7  | reserved flag names `--help`/`-h`/`--context`                 | a same-named field is unreachable by flag                                 | reserved; same-named fields reachable only via object form. Document in `--help`.                                                                                                             |
| L8  | array arity / `--tag` vs `--tags`                             | the bug class behind `0e26bb2`                                            | **decided:** array field → repeatable flag at the **verbatim** key (`--tags`); no singularization (§5.3).                                                                                     |
| L9  | human typo (`--tocc`) error shape                             | should it be human text or the agent YAML envelope?                       | **open** (§6 Q3). Default: reuse the YAML envelope to avoid doubling machinery.                                                                                                               |
| L10 | positional value starts with `--` (`--weird.md`, `--help`)    | routed as a flag / help, never a positional                               | **decided:** no positional may start with `--`; such a value uses a named flag or the object form. (A `--` terminator is the heavier alternative if a real need appears.)                     |
| L11 | `--no-cache` when the schema has a `no-cache` (or `no-*`) key | a `--no-*` negation namespace collides with a verbatim `no-`-prefixed key | **decided:** there is **no** `--no-*` namespace. `false` is `--key=false`. So every `no-`-prefixed key stays verbatim and unambiguous (`--no-cache` sets key `no-cache`, not `cache: false`). |

**The central safety claim:** because a JSON5 object always starts with `{`, file input with `@`,
and stdin is exactly `-`, the agent token set `{ {…}, @…, -, absent }` and the human token set
`{ --flag, bareword }` are **disjoint at the first input-slot token**. The only overlaps are on
the _value_ of a positional — L1–L3 (`-` / `@` / `{`) and L10 (`--`) — all closeable by "such a
value uses a named flag or the object form." Review (Codex v1) confirmed no fifth case, and that
the architecture is safe **provided** the human parser is entered only after the path resolves to
a command (`cli.ts:330-353`), leaving agent dispatch byte-identical.

## 5. Coercion — **the reliability crux** (`--b 1` → `1`, not `"1"`)

This is the problem the user named, and the one with the longest scar history.

### 5.1 The mechanism (single-pass, schema-driven)

argv lexing yields strings. With `input: { a: string; b: number }`, `--b 1` lexes `b = "1"`. The
field's declared type drives coercion:

| declared type        | `"1"` →                   | `"true"` →         | failure mode                                      |
| -------------------- | ------------------------- | ------------------ | ------------------------------------------------- |
| `string`             | `"1"`                     | `"true"`           | —                                                 |
| `number` / `integer` | `1`                       | _(stays `"true"`)_ | non-numeric stays string → normal `INVALID_INPUT` |
| `boolean`            | _(stays `"1"`)_           | `true`             | `--b` alone = `true`; `--no-b` = `false`          |
| `array<T>`           | `[coerce(T)]` per element |                    | repeatable flag accumulates                       |
| union / `anyOf`      | unchanged (string)        |                    | ambiguous target → leave to schema validation     |

Coercion is **best-effort and never throws**: it only narrows a string where the schema names a
single scalar type; anything it cannot narrow passes through untouched and is caught by the
**existing** Standard-Schema validation, producing the normal `INVALID_INPUT` envelope. Final
correctness is owned by validation, not by the coercer — the coercer only removes the
"everything-from-argv-is-a-string" impedance.

Crucially this must run **before/with** parsing, not after (the historical design coerced _after_
a schema-blind lex — the source of L4 and the arity bugs). Knowing `b` is `boolean` is what lets
the parser decide `--b` takes no value.

### 5.2 The infrastructure is close, but **not** directly reusable

The 7.0 clean break deleted `coerce.ts` (recoverable from `867a9fd~1:src/coerce.ts`) and kept the
raw material it stood on — but **neither public helper is parser-grade** (Codex finding 3):

- `readJsonSchema(schema, side)` (`schema.ts:156`) returns the draft-07 JSON Schema the coercer
  actually needs (`type` / `items` / `properties`), but it is **private**.
- `extractCliInputParamsDetailed` → `ParamInfo { name, type, optional }` (`schema.ts:182`) is
  **display-only**: `type` is a rendered string (`"string[]"`, `'"dev" | "prod"'`). Driving the
  parser off those strings would make the schema _renderer_ an implicit ABI — a display tweak would
  silently change parsing. Forbidden.

**Prerequisite (new work, not free reuse):** a **structured field descriptor** for the parser —
`{ name, required, kind, itemKind, enum, rawSchema }` — derived from the raw JSON schema;
`ParamInfo` stays display-only and the parser must never read it. The old `coerce.ts` (commit
`9df72f6`) is the reference for the _coercion rules_ (it read the raw schema directly), but 7.1
must expose that structure deliberately rather than lean on the private reader or the display
strings.

### 5.3 Naming: do **not** resurrect `naming.ts`

The pre-7.0 design carried camelCase↔kebab flag mapping (`naming.ts`, commits `b42e792`,
`7d7b60d`) — and the bugs that came with it. **Proposed: flag name = schema key, verbatim.** v7
already permits non-identifier input keys rendered quoted in `@schema` (`{ "content-type"?: … }`),
so `content-type` → `--content-type` is natural with zero mapping, and `maxDepth` → `--maxDepth`.
Removing the bidirectional map removes the entire `b42e792`/`7d7b60d` bug class. Verbatim also
forecloses a `--no-*` namespace — it would collide with `no-`-prefixed keys (L11) — so a boolean's
`false` is the attached `--key=false` form, not `--no-key` (decided #9). _Review v3 confirmed
verbatim._

### 5.4 Scar inventory — re-incurred hazards (Codex must check each is closed)

| commit    | what it fixed (then)                            | does the §5.1 single-pass design re-incur it?                                        |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `9df72f6` | schema-driven coercion (string→typed)           | reused verbatim — verify against 7.0 introspection                                   |
| `859b65e` | arrays (repeated flags) + nested (dot notation) | arrays kept; deep nesting punted to object form (§3.2)                               |
| `0e26bb2` | singular `--tag` for repeatable array flags     | **dropped** — array flag = schema key verbatim (`--tags`); no singularization (§5.3) |
| `070e5e5` | field named `input` colliding with `--input`    | `--input` is gone; check no analogous reserved-name leak beyond L5/L7                |
| `b42e792` | kebab flags respect schema field names          | obviated by §5.3 (verbatim, no mapping)                                              |
| `7d7b60d` | help flag display aligned to schema names       | re-applies to the new `--help` view (§3.4)                                           |

## 6. Decisions to lock vs. open questions

**Decided** (overturn only with cause; 6–8 added in 0.2 from Codex review v1):

1. Human path lives in core; agent surface (`@schema`/`@run`/error `$schema`/skill/README) is
   untouched and never renders the human form (§2, premise).
2. One door per call — no object⊕flag mixing (L6).
3. Flag name = schema key verbatim; no `naming.ts`, no singularization (§5.3).
4. Coercion is best-effort, schema-driven, single-pass, and never throws; validation stays the
   sole authority on correctness (§5.1).
5. Deep nesting is not a flag feature; the object form is its escape hatch (§3.2).
6. **Positional is explicit `.positional()` only — never inferred** (was Q5). Inference would let a
   schema tweak silently change the human ABI.
7. **Unknown human flags fail-fast** with an error — never silently dropped by the schema strip.
   The 7.0 unknown-key precheck (`cli.ts:659`) is the analogue; the human parser needs its own,
   **pre-coercion**.
8. **No positional may start with `--`** (L10); such a value uses a named flag or the object form.
9. **No `--no-*` negation namespace** (L11). A boolean's `false` is the attached `--key=false`
   form; `--flag` alone is `true`. This keeps every `no-`-prefixed schema key verbatim and
   reachable, adding no reserved namespace (same spirit as #3).

**Open (Codex to resolve):**

- **Q1.** _Confirmed by review:_ entering the human parser only after the path resolves to a
  command keeps agent dispatch byte-identical and reopens no space-path. Implementation must hold
  this — any first-token case that misroutes agent input into the human branch is a blocker.
- **Q2.** _Confirmed by review:_ single-pass schema-aware parse is the right shape (it is what
  closes L4 and the arity class). Confirm in implementation that it does not relocate the bug.
- **Q3.** Error shape on the human path (L9): reuse the agent YAML envelope, or emit human text?
  Trade isolation purity against machinery.
- **Q4.** Keep shallow one-level dotted flags (`--user.name`, `859b65e`), or punt all nesting to
  the object form?
- **Q5.** Completion: extend `@completions` to emit flag/positional candidates for the human path,
  or leave completion path-level only (7.0 behavior)?

## 7. Implementation sketch (orientation, not the contract)

- `src/cli.ts` — in `parseCall`, replace the bare-word `BAD_PATH` branch (`cli.ts:380-391`) with a
  hand-off to the human parser when the first input-slot token is `--`-led or a non-input bare
  word; agent branches untouched.
- `src/schema.ts` — expose a **structured field descriptor** (§5.2) for the parser; keep
  `ParamInfo` display-only and do not let the parser read it.
- new `src/human.ts` (or restore `src/parser.ts` lexer + `src/coerce.ts`) — single-pass
  schema-aware argv → input object off the structured descriptor; **unknown-flag fail-fast**
  (decided #7) before coercion.
- `src/help.ts` — add the per-command human `--help`/`-h` view (§3.4); keep `--help` top-level and
  `@schema` exactly as 7.0.
- `src/command.ts` / `types.ts` — `.positional(...)` metadata (decided #6, explicit-only).
- `src/complete.ts` — only if Q5 chooses flag completion.
- **No change** to **agent schema rendering** (`schema-explorer.ts`, and the `@schema` / outline
  output of `schema.ts`), `render.ts` agent rendering, `script.ts` (`@run`), or `SKILL.md` / README
  agent sections — isolation is verified by their _non-diff_. (`schema.ts` gains **only** the
  additive structured descriptor above; its rendering output is byte-unchanged.)

Verification beyond unit tests: re-run the full `spec-7.0-behavior.md` matrix unchanged (proves no
agent regression), then add a human-path matrix mirroring the §4/§5 rows, plus a grep proving the
human form appears in **zero** agent-facing artifacts (`@schema` output, `SKILL.md`, README agent
sections, error `$schema` slices).
