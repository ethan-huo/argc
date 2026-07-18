---
type: Change Request
title: argc 7.3 — consolidate @schema command docs into one JSDoc block, heredoc @run example, color the block
status: accepted
version: 0.2
timestamp: 2026-06-25
description: >
  Three @schema/example rendering changes. CR-1: a command currently emits a `/** desc */`
  JSDoc line AND a separate `// example` line — two comment syntaxes stacked. Consolidate
  into ONE JSDoc block using the standard `@example` tag. CR-2: the long single-line
  `@run "await Promise.all([...])"` surface example becomes a multi-line heredoc
  (`@run - <<'JS' … JS`), which is the idiomatic way to pass multi-line code to a CLI.
  CR-3: extend the 7.2 `colorizeSchema` TTY styler to dim the JSDoc block (not just `//`)
  and accent the `@example` tag. Display-only; no dispatch/parser/validation change. Stays
  within the frozen 7.2 Q3 decision (comments + type name only — no full TS highlighter).
---

# CR 7.3: @schema doc blocks, heredoc example, block color

> **Status:** accepted — shipped in **v7.3.0** (`05287c3`, baseline v7.2.1 `1f35e3f`).
> **0.2:** CR-1 example source later became **authored `meta.examples` only** (v7.6.0
> `f5b89ec`); degradation table and out-of-scope below match that current rule. CR-2/CR-3
> still hold as shipped.

Baseline: v7.2.1 (`1f35e3f`). Renderer lives in `src/schema.ts` (the typed body) and
`src/markup.ts` (`colorizeSchema`, TTY color). All three changes are in those two files plus tests.

## CR-1 — one JSDoc block per command (drop the stacked `// example`)

### Problem

`generateCommandSchema` emits the description as a `/** … */` line via `pushDoc`, then a
**separate** `// <app> <path> "<input>"` example line. Two comment syntaxes stacked reads as
noise:

```ts
/** Append a message to the top of the inbox feed; auto-rolls overflow to the dated archive */
// hq inbox.send "{ source: 'value', type: 'value', summary: 'value', body: 'value', id: 'value' }"
send(input: { source: string; type: string; summary: string; body?: unknown; id?: string })
```

### Change

Collect description + example into **one JSDoc block**, using the standard `@example` tag:

```ts
/**
 * Append a message to the top of the inbox feed; auto-rolls overflow to the dated archive
 *
 * @example
 * hq inbox.send "{ source: 'value', type: 'value', summary: 'value', body: 'value', id: 'value' }"
 */
send(input: { source: string; type: string; summary: string; body?: unknown; id?: string })
```

Degradation (the rule: one line ⇒ inline, more ⇒ block). **Examples are authored only**
(`meta.examples`) — no synthesized `{ name: 'value' }` samples (v7.6.0; v7.3 originally
used `exampleInput`):

- description only, no examples → single-line `/** description */` (unchanged shape).
- description + one or more examples → block with one `@example` tag over the whole list.
- examples only (no `meta.description`) → block with just the `@example` part (no
  description line, no blank line).
- no description and no examples → no comment.
- **Groups keep `pushDoc`** — single-line `/** description */`. This CR only changes commands.

Reference shape (command branch of `generateCommandSchema`; current code takes
`meta.examples ?? []`):

```ts
pushCommandDoc(lines, indent, meta.description, meta.examples ?? [])
lines.push(
	params.length > 0
		? `${indent}${name}(input: { ${formatParams(params)} })`
		: `${indent}${name}()`,
)

// helper (sits beside pushDoc):
function pushCommandDoc(
	lines: string[],
	indent: string,
	description: string | undefined,
	examples: readonly string[],
): void {
	const desc = description?.replaceAll('*/', '* /')
	const samples = examples.map((e) => e.replaceAll('*/', '* /'))
	if (!desc && samples.length === 0) return
	if (desc && samples.length === 0) {
		lines.push(`${indent}/** ${desc} */`)
		return
	}
	lines.push(`${indent}/**`)
	if (desc) {
		lines.push(`${indent} * ${desc}`)
		lines.push(`${indent} *`)
	}
	// One @example tag over the whole list — alternative invocations of one command.
	lines.push(`${indent} * @example`)
	for (const sample of samples) {
		for (const line of sample.split('\n')) {
			lines.push(line ? `${indent} * ${line}` : `${indent} *`)
		}
	}
	lines.push(`${indent} */`)
}
```

The body stays **valid TypeScript** — a `/** … @example … */` JSDoc comment is valid TS, so the
"@schema is parseable TS" invariant holds.

## CR-2 — heredoc for the long `@run` surface example

### Problem

`buildSurfaceExamples` emits the composition example as one long line:

```
hq @run "await Promise.all([inbox.send({ … }), inbox.send({ … })])" --json
```

### Change

Render it as a **heredoc** — the idiomatic way to feed multi-line code to a CLI (`@run -` reads the
snippet from stdin; verified working, incl. trailing `--json`):

```
hq @run - --json <<'JS'
await Promise.all([
  inbox.send({ source: 'value', type: 'value', summary: 'value', body: 'value', id: 'value' }),
  inbox.send({ source: 'value', type: 'value', summary: 'value', body: 'value', id: 'value' }),
])
JS
```

Two load-bearing details (do not drop):

- **`@run -`** (the `-` source token) — `@run` without `-` expects an inline source; the heredoc
  feeds stdin, which only `-` reads.
- **quoted delimiter `<<'JS'`** — single-quoting the heredoc word stops the shell from expanding
  `$`/backticks inside the JS snippet.

Reference implementation (replace the `@run` push):

```ts
examples.push(
	[
		`${options.name} @run - --json <<'JS'`,
		`await Promise.all([`,
		`  ${dottedPath}(${input}),`,
		`  ${dottedPath}(${input}),`,
		`])`,
		`JS`,
	].join('\n'),
)
```

Scope: **only the `@run` composition example** becomes multi-line. The direct call and the
`@schema .selector` examples stay single-line — only the long one earns a heredoc. The multi-line
string flows through `help.ts`'s `buildSurfaceExamples(...).join('\n')` and the `## Examples` body
unchanged (it is just more lines).

## CR-3 — color the JSDoc block in `@schema` (TTY)

### Problem

`colorizeSchema` dims `//` lines and bolds the `type X =` name. After CR-1, the per-command
comment is a JSDoc **block** (`/**`, ` * …`, ` */`), which the current rule does not recognize,
so the block renders un-dimmed.

### Change

Extend the comment rule to JSDoc block lines, and **accent the `@example` tag** so it stands out.
This stays within the frozen 7.2 Q3 decision (comments + type name only — **not** a full TS
highlighter); it only widens "comment" from `//` to "`//` or JSDoc block line".

Reference (inside `colorizeSchema`'s per-line map, before the `type X =` replace). Current code
accents only the `@example` token (prefix/suffix stay dim) rather than the whole line:

```ts
const trimmed = line.trimStart()
if (
	trimmed.startsWith('//') ||
	trimmed.startsWith('/**') ||
	trimmed.startsWith('*') // ` * text`, ` * @example`, ` */`
) {
	const exampleMatch = /^(\s*\*\s*)(@example)(\s*)$/.exec(line)
	if (exampleMatch) {
		const [, prefix, tag, suffix] = exampleMatch
		return `${dim(prefix!, enabled)}${cyan(tag!, enabled)}${
			suffix ? dim(suffix, enabled) : ''
		}`
	}
	return dim(line, enabled)
}
```

Unchanged: non-TTY path still returns `source` verbatim (`if (!enabled) return source`), so captured
`@schema` stays **byte-plain, zero ANSI**.

## Verification

- `@schema` body parses as valid TS (JSDoc `@example` blocks are valid comments).
- Update `v7.test.ts` `@schema` assertions: expect the consolidated
  `/**\n * … \n * @example\n * …\n */` block; assert **no** stray `// <app> <path>` example line
  remains; assert the heredoc example (`@run - --json <<'JS'`) appears in surface examples.
- Re-assert the 7.2 contract guard: with stdout **not a TTY**, `@schema` output contains **zero**
  ANSI (`\x1b[`) — CR-3 must not leak color when captured.
- TTY snapshot (FORCE-enabled pty or faked `isTTY`): JSDoc block dimmed, `@example` tag
  accented, `type X =` name still bold.
- Smoke the heredoc end-to-end: `tool @run - --json <<'JS' … JS` returns the composed value.

## Out of scope

No change to dispatch, the human parser, error envelopes, `--help` prose, or the vocabulary.
Command `@example` lines come from authored `meta.examples` only — no synthesized sampling
(v7.6.0; original v7.3 text reused `exampleInput`).
