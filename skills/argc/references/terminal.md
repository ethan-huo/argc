# Terminal Output (`argc/terminal`)

A subexport with color, semantic status output, and an ANSI/CJK-aware table.
Not documented in the README. Import from the `argc/terminal` entry:

```typescript
import { fmt, printTable, visibleWidth, padEnd } from 'argc/terminal'
```

## The one rule that matters for agents

**Color auto-disables when stdout is not a TTY.** When an agent captures your
CLI's stdout, `fmt.green('ok')` returns the bare string `'ok'` — no escape
codes to pollute the agent's context. At a human terminal it returns the
colored string. You write one code path; both consumers get the right output.

```typescript
fmt.isColorSupported // false when piped/redirected, true at a TTY
```

Detection order (see `isColorSupported`): disabled by `NO_COLOR` or
`--no-color`; forced on by `FORCE_COLOR` or `--color`; otherwise on for Windows,
a TTY with a non-`dumb` `TERM`, or CI. **Corollary:** don't hand-roll your own
`\x1b[...m` codes — they bypass this detection and will leak into agent stdout.

## `fmt` — colors, styles, semantic status

Every value is a `(s: string) => string` formatter that no-ops when color is off.

```typescript
// Colors
fmt.black fmt.red fmt.green fmt.yellow fmt.blue fmt.magenta fmt.cyan fmt.white fmt.gray
// Styles
fmt.bold fmt.dim fmt.italic fmt.underline fmt.inverse fmt.strikethrough

fmt.red('danger')        // red text (or 'danger' when piped)
fmt.bold(fmt.cyan('hi')) // composable

// Semantic status — prepends a Unicode icon, colors it, leaves your text plain
fmt.success('Deployed')  // ✓ Deployed   (green ✓)
fmt.error('Build failed')// ✗ Build failed (red ✗)
fmt.warn('Deprecated')   // ⚠ Deprecated  (yellow ⚠)
fmt.info('Skipping')     // ▶ Skipping    (cyan ▶)

// Semantic aliases for help/usage text
fmt.command('deploy')    // = fmt.cyan
fmt.arg('<file>')        // = fmt.yellow
fmt.option('--verbose')  // = fmt.green
```

**Status output goes to stderr, not stdout** — it's progress/diagnostics for a
human, not the result an agent reads:

```typescript
import { stringify } from 'yaml'
console.error(fmt.info('Connecting…')) // stderr: human progress
console.error(fmt.success('Connected')) // stderr
process.stdout.write(stringify(result)) // stdout: the agent's summary
```

## `printTable` — aligned tables with color and wide chars

`console.table` miscounts columns when cells contain ANSI codes or CJK
characters. `printTable` measures _visible_ width, so colored and full-width
text align correctly.

```typescript
printTable(
	[
		{ key: 'name', label: 'NAME' },
		{ key: 'status', label: 'STATUS' },
	],
	[
		{ name: 'alice', status: fmt.green('ok') },
		{ name: '王小明', status: fmt.red('down') }, // CJK aligns
	],
)
```

```
NAME    STATUS
──────────────
alice   ok
王小明  down
```

- `TableColumn` = `{ key: string; label: string; width?: number }`. `width` caps
  a column (content is not truncated; the cap just limits padding math).
- `TableRow` = `Record<string, string>`. Pre-format cells with `fmt.*`; missing
  keys render empty.
- Header and separator are dimmed; it writes via `console.log` (stdout). For an
  agent-facing command, prefer a YAML summary (or `--json` for raw data) and
  reserve tables for a `--format table` human mode — see `references/output.md`.

## `visibleWidth` / `padEnd` — alignment primitives

For custom layouts (columns, right-aligned numbers, progress lines):

```typescript
visibleWidth('你好') // 4  — CJK counts as 2; ANSI codes count as 0
visibleWidth(fmt.red('hi')) // 2  — escape codes excluded
padEnd('id', 8) // 'id      ' — pad to visible width 8
padEnd(fmt.green('ok'), 8) // pads by visible width, color preserved
```

Wide-char detection covers CJK ideographs, Hangul, Hiragana/Katakana, fullwidth
forms, and CJK symbols/punctuation. Use these instead of `String.prototype.padEnd`
whenever cells may contain color codes or non-Latin text — the native method
counts bytes/code units and will misalign.

## Pipe and signal hygiene

Two boring failure modes that produce ugly stack traces in agent transcripts.
Handle them once at the top of the entry file:

**EPIPE — closed downstream pipe.** `mytool fetch | head -1` closes stdout
after the first line. The next `process.stdout.write` throws `EPIPE` and Node
exits with a stack trace. Silence it:

```typescript
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EPIPE') process.exit(0)
	throw err
})
```

This is the right behavior — pipe consumers that take what they want are a
core CLI idiom; your tool should exit `0` and quietly.

**SIGINT — Ctrl-C during long work.** A spinner on stderr leaves a half-drawn
line and a hidden cursor when the process is killed mid-frame. Clear before
you exit, and tell the user whether anything is still running remotely:

```typescript
process.on('SIGINT', () => {
	spinner?.stop()                 // clear ANSI, restore cursor
	console.error(fmt.warn('Interrupted. Remote job may still be running — check with `myapp status`.'))
	process.exit(130)               // 128 + SIGINT
})
```

If the command is purely local, the second line is unnecessary; just stop the
spinner and exit.

## Warnings: gutter glyph, not label

`fmt.warn('…')` produces `⚠ <message>` — that's the right surface for a
nonfatal notice. Don't print `WARNING:` or `WARNING!` as a leading label;
the glyph carries the same meaning with less noise, and `fmt.warn` already
colors it yellow when the terminal supports it.

Same goes for errors: `fmt.error('…')` (`✗`) is the surface, not a hand-written
`ERROR:` prefix.

## Error voice

When you write an error message, follow the 3-part structure from
`references/flow.md` (what failed → why → how to fix). On the wording itself:

- `Failed to …` for system/network/upstream failures.
- `Couldn't …` / `Can't …` for user-state and validation failures.
- Don't write `Unable to …`, `An error occurred`, or `Something went wrong`.
- Don't say `successfully` — name the action: `Created project acme/web`,
  not `Successfully created project`.
