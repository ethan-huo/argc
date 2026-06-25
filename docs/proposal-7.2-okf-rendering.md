---
type: Proposal
title: argc 7.2 — converge every display surface to OKF, with TTY-gated color
status: accepted
version: 0.3
timestamp: 2026-06-25
description: >
  One display grammar for the whole framework: --help, <cmd> --help, and @schema become OKF
  (YAML frontmatter + a structural body); the error envelope stays the stable YAML envelope.
  Help bodies are
  natural-language markdown (no terse git-style cards). On an interactive terminal the
  four surfaces gain light, role-based color (markdown headers, inline code, the error
  code) — strictly TTY-gated so piped/captured output stays byte-plain and the agent
  contract is untouched. Separately, the user-facing input vocabulary converges from
  "JSON5" to "object literal" (parser unchanged), and surface examples become
  representative per-form. This is an EVALUATION REQUEST; §3 (color vs the output
  contract) is the part Codex must adjudicate.
---

# Proposal 7.2: one OKF display grammar, TTY-gated color

> **0.2 (Codex review v1):** errors are explicitly **not** OKF — three _document_ surfaces are,
> the error envelope stays YAML; the color gate is frozen to `stream.isTTY && !NO_COLOR` with **no**
> force-enable path; the styler takes an explicit `enabled` boolean (no fake reuse of
> `fmt.isColorSupported`); verification drops the false "byte-identical" claim for "non-TTY zero
> ANSI + structural contract unchanged"; all open questions frozen.
>
> **0.3:** dropped the `--no-color` _flag_ (redundant with the `NO_COLOR` env standard, and removing
> it deletes the 7.1 human-parser control-token seam — there is no flag to strip); color disable is
> now **`NO_COLOR` env only**.

Baseline: argc 7.0 (`867a9fd`) + 7.1 human path (`56013fd`). This proposal is **display-only**
plus a **vocabulary** rename; it changes no dispatch, no parser, no validation, no error codes.

## 1. Thesis

argc already has the right envelope in one place — `@schema` is an **OKF** document
(`--- frontmatter --- body`, spec-7.0 §6). Everything else drifted: `--help` is loose YAML with a
terse, backtick-dense `help:` block; `<cmd> --help` (7.1) is ad-hoc YAML; errors are a YAML
envelope. This proposal makes the **three document surfaces** (`--help`, `<cmd> --help`, `@schema`)
share OKF, keeps the **error envelope as the stable YAML** it already is, and adds the human
affordance the 7.0 clean break dropped: **color**, but only where it cannot corrupt the contract.

Two independent threads ride along because they touch the same surfaces:

- **Vocabulary (§7):** the input is described as a **JS object literal**, not "JSON5".
- **Examples (§8):** each surface example shows the form's _strength_, not a restatement.

## 2. The OKF shapes

OKF = YAML frontmatter + a structural body. The **body language varies by surface**: markdown
for help, TypeScript for `@schema`. That is fine — OKF constrains the envelope, not the body
dialect.

### 2.1 `--help` (top-level) — markdown body

```
---
program: inbox — Ingress for the workspace message feed
version: 0.9.11
context: 'type Context = { env?: "dev" | "prod" }'
---
## Usage

Call any command by its dotted path, passing one quoted object literal — the same
`{ … }` you would write inside `@run`:

inbox send "{ source: 'web', type: 'alert', summary: 'disk full' }"

Values must be literals; to compute or compose inputs, use `@run`. Input may also come from
a file (`@payload.json`), from stdin (`-`), or be omitted (it defaults to `{}`). Cross-cutting
config goes through `--context "<object>"` or the `ARGC_CTX` environment variable.

## Schema

`inbox @schema` prints the typed API — every command and the exact shape of its input.
Append a selector to focus on one area, e.g. `inbox @schema .send`.

## Examples

inbox send "{ source: 'web', type: 'alert', summary: 'disk full' }"
inbox @run "await Promise.all([send({ source: 'web' }), send({ source: 'cron' })])" --json
inbox @schema .send
```

Notes:

- **Prose, not a card.** Full sentences. The rejected shape (cr-7.0 §2) was a _column-aligned
  card_; structured markdown under `##` headings is not that — the frontmatter stays machine-clean,
  the body is real documentation.
- **Top-level help stays agent-oriented.** It does **not** teach the human flag form; that lives in
  `<cmd> --help` (decided in 7.1: the human path is discoverable, not advertised). No positional
  example appears here — a bareword positional value reads like the removed space-path (§8.1).
- **Command/example lines are flush-left**, no indentation and no code fences. Under `## Examples`
  every line is a command; the styler (§4) needs no per-line code detection.

### 2.2 `<cmd> --help` (per-command) — the human surface, markdown body

```
---
command: inbox send
summary: Publish a message into the feed
---
## Usage

inbox send <source> [options]

## Arguments

- `source` — where the message originates

## Options

- `--type <value>` — message kind
- `--summary <value>` — one-line description
- `--tags <value>` — repeatable; pass once per tag
- `--urgent[=true|false]` — boolean; bare `--urgent` is true, `--urgent=false` is false

You can also pass the whole input as one object literal:

inbox send "{ source: 'web', type: 'alert' }"
```

`<source>` is angle-bracketed — a placeholder, so it never reads as a path segment. Replaces the
7.1 `usage:` / `positionals:` / `flags:` YAML block with prose options.

### 2.3 `@schema` — already OKF; body unchanged

No structural change. It keeps its frontmatter and TypeScript body (spec-7.0 §6). It only gains
TTY color (§4) and the vocabulary rename in its header comments (§7).

### 2.4 errors — YAML envelope, unchanged structure

Codes, fields, and the stdout/stderr split are **frozen** (spec-7.0 §9). Errors are not converted
to OKF — they are short machine envelopes, not documents. They only gain TTY color on the
`error: <CODE>` line and keys (§4), gated on **`stderr.isTTY`** (errors go to stderr).

## 3. Color vs the output contract — **the evaluation crux**

v7's load-bearing rule: argc owns fd 1; structured output is a contract an agent parses. Color
must never reach a non-interactive reader.

### 3.1 The existing gate is too liberal for contract surfaces

`terminal.ts` exports `fmt`, gated by `isColorSupported`:

```
!(NO_COLOR || --no-color) && (FORCE_COLOR || --color || win32 || (isTTY && TERM!=dumb) || CI)
```

It enables color when **`CI` is set or on win32 even if stdout is piped**. `fmt` is fine for
_handler_ output, but using it for the framework's own help/`@schema`/errors would emit ANSI into a
**captured** stream in CI or on Windows — corrupting an agent's parse. That is a real regression
risk, not a hypothetical.

### 3.2 The contract-safe gate (decided)

Framework self-rendering (help, `@schema`, errors) colorizes **iff the destination is a real
interactive terminal**:

```
colorize(stream) = stream.isTTY && !env.NO_COLOR
```

- `--help` / `<cmd> --help` / `@schema` → `process.stdout.isTTY`.
- errors → `process.stderr.isTTY`.
- The **only** enable signal is `stream.isTTY`. There is **no force-enable path**: `--color`,
  `FORCE_COLOR`, `CI`, and win32 are all ignored, so a captured stream is always plain.
- Disable always wins: `NO_COLOR` (env) forces plain even on a TTY. There is **no `--no-color`
  flag** — it is redundant with the `NO_COLOR` standard and would otherwise need stripping before
  the 7.1 human parser; dropping it removes that seam.
- Trade-off (accepted): `<cmd> --help | less -R` is plain — fine for an agent-primary CLI; a force
  path is the exact footgun that puts ANSI into a captured stream.

This is a **separate, stricter gate** than `fmt.isColorSupported`; `fmt` is unchanged for handler
output. With color off, every surface carries **zero ANSI** and its **structural contract** (codes,
fields, `@schema` shape) is unchanged — only the OKF reshaping of `--help`/`<cmd> --help` and the
vocabulary/example edits (§7–8) alter bytes. The agent never sees color.

## 4. The markdown → ANSI styler

Light and role-based, **not** a syntax highlighter. No new dependency. It reuses the **raw ANSI
codes**, applied through formatters that take an explicit `enabled` boolean (§10) — it does **not**
call the closured `fmt.red/bold/...`, whose enablement is fixed at module load by the liberal
`fmt.isColorSupported`.

| body role              | TTY styling                 |
| ---------------------- | --------------------------- |
| `## Heading`           | `fmt.bold(fmt.cyan(...))`   |
| inline `` `code` ``    | `fmt.yellow` (or `fmt.dim`) |
| `- ` list bullet       | bullet dim, text plain      |
| frontmatter key        | `fmt.dim`                   |
| `program:` value       | `fmt.bold`                  |
| command / example line | plain (or `fmt.dim`)        |

`@schema` (TS body) is **not** markdown: style only its `//` comment lines (`fmt.dim`) and the
`type X =` name (`fmt.bold`) — a few roles, not a TS grammar. Errors: `error:` value bold + red,
keys dim. The shared primitive is "colorize lines/spans by role"; each surface passes its own small
role map. Intentionally minimal (taste: least machinery).

When color is off, the styler is the identity function — same bytes as the source OKF.

## 5. Who reads what (unchanged audience model)

- **Agent, cold start:** `--help` (parses frontmatter, reads markdown) → `@schema` → call. Sees
  plain OKF (piped). Color never appears.
- **Agent, with skill:** `@schema` → call. Unaffected.
- **Human, terminal:** `--help` / `<cmd> --help` render colorized markdown. `<cmd> --help` is the
  only place the flag form is taught (7.1).

OKF serves both because the machine bits live in frontmatter and the prose is structured markdown —
the convergence does not cost the agent anything.

## 6. (reserved)

## 7. Vocabulary: "object literal", not "JSON5"

The input token is described everywhere user-facing as a **JS object literal** — the same `{ … }`
written inside `@run` — making the three forms isomorphic in _vocabulary_, not just shape. JSON5
stays the parser (an implementation detail); it accepts exactly the **literal** subset.

Elegance worth stating: **the literal/expression boundary == the path/`@run` boundary.** JSON5
rejects expressions (`1+2`, `new Date()`, spread, shorthand); those are precisely what `@run`
exists for. So the parser's limit and the design's escalation rule are the same line. Help says:
_values must be literals; to compute or compose, use `@run`_.

Touches (user-facing text only): `help.ts`, `@schema` header comments, `BAD_INPUT_JSON` `detail`
wording, README/skill. The error **code** `BAD_INPUT_JSON` stays (stable, machine-branchable);
renaming it is out of scope — the code stays `BAD_INPUT_JSON`.

## 8. Representative examples

`buildSurfaceExamples` changes from "one object line per command" to a **representative set** that
shows each form's strength:

1. a direct **literal** call — `app cmd "{ … }"`;
2. an `@run` **composition** — `app @run "await Promise.all([cmd(a), cmd(b)])" --json` (batching is
   the reason `@run` exists; a single `await cmd(...)` only restates form 1);
3. a `@schema` **selector** — `app @schema .cmd`.

### 8.1 No bareword positional examples in shared surfaces

A positional example like `app send web` is machine-valid (7.1: `send({ source: 'web' })`) but
**visually resurrects the removed space-path** — a reader cannot tell `web` from a botched
sub-command (`send.web` would be a _nested command_, a different thing entirely). Rule: a positional
example's value must obviously read as **data** (`docs/x.md`, a number, a URL), never a bare
identifier. Top-level help shows **no** human example at all; `<cmd> --help` uses the `<source>`
placeholder, which cannot be misread.

## 9. Decisions & open questions

**Decided** (overturn only with cause):

1. All four surfaces share OKF / the error envelope; help bodies are natural-language markdown.
2. Framework color enables **only** on `stream.isTTY` (stdout for help/`@schema`, stderr for
   errors), disabled by the **`NO_COLOR` env only** (no `--no-color` flag); **no** force-enable from
   `--color`/`FORCE_COLOR`/`CI`/win32 (§3.2). With color off, surfaces carry zero ANSI.
3. The styler is light & role-based, no markdown/highlight dependency (§4).
4. Top-level `--help` stays agent-oriented; the human form is taught only in `<cmd> --help` (§2.1).
5. Vocabulary → "object literal"; JSON5 stays the parser; `BAD_INPUT_JSON` code unchanged (§7).
6. Examples are representative per-form; no bareword positional examples in shared surfaces (§8).

**Resolved** (frozen in 0.3 — no open design points remain):

- **Q1 → `isTTY` is the sole enable switch.** No `--color`/`FORCE_COLOR` force-enable and no
  `--no-color` framework flag (decided #2).
- **Q2 → keep `BAD_INPUT_JSON`.** No rename.
- **Q3 → `@schema` color = `//` comment lines + the `type X =` name only.** No full TS highlight.
- **Q4 → claw round-trip via a temp file:** capture `<cmd> --help` to `/tmp/help.md`, then
  `claw read /tmp/help.md --toc` (claw reads a file path; `--toc`/`--section` are its real flags).

## 10. Implementation map & verification

- `src/help.ts` — emit OKF for `showHelp` and `showCommandHelp`; prose bodies; flush-left examples.
- `src/schema.ts` / `schema-explorer.ts` — vocabulary rename in header comments; no structural change
  to the typed body.
- `src/terminal.ts` — extract the **raw ANSI factory** (bare color codes, or `(code) => (s,
enabled) => …`) so both `fmt` (its own liberal gate, unchanged) and the new styler share codes.
- new `src/markup.ts` (suggested) — the role-based styler + the contract-safe gate
  `enabled(stream) = stream.isTTY && !process.env.NO_COLOR`; formatters take that `enabled` boolean
  explicitly. It does **not** consume `fmt.isColorSupported`, and there is **no `--no-color` flag**.
- `src/render.ts` — error envelope gains TTY color on `stderr` via the same gate; codes/fields/stream
  split unchanged.
- `src/schema.ts` `buildSurfaceExamples` — emit the representative set (§8).
- vocabulary sweep — `BAD_INPUT_JSON` detail wording, README, skill.

**Verification:**

- **Agent contract (the critical test):** for every surface, assert that with stdout/stderr **not a
  TTY** the bytes contain **zero** ANSI (`\x1b[`), including under `CI=1` and simulated win32. This
  is the regression guard for §3.
- Re-run the full `spec-7.0-behavior.md` matrix — `@schema`/error **structure** unchanged.
- Update the 7.0/7.1 `--help` and `<cmd> --help` assertions to the OKF shapes (the YAML-card
  assertions are deleted).
- TTY snapshot (with a pty) showing colored headers, for the human surfaces only.
- A `claw read` round-trip smoke: capture `<cmd> --help` to a temp `.md`, then
  `claw read <tmp> --toc` (Q4).
