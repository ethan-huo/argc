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
console.error(fmt.info('Connecting…'))   // stderr: human progress
console.error(fmt.success('Connected'))  // stderr
console.log(JSON.stringify(result))      // stdout: the agent's payload
```

## `printTable` — aligned tables with color and wide chars

`console.table` miscounts columns when cells contain ANSI codes or CJK
characters. `printTable` measures *visible* width, so colored and full-width
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
  agent-facing command, prefer machine output (JSON) and reserve tables for a
  `--format table` human mode.

## `visibleWidth` / `padEnd` — alignment primitives

For custom layouts (columns, right-aligned numbers, progress lines):

```typescript
visibleWidth('你好')        // 4  — CJK counts as 2; ANSI codes count as 0
visibleWidth(fmt.red('hi')) // 2  — escape codes excluded
padEnd('id', 8)             // 'id      ' — pad to visible width 8
padEnd(fmt.green('ok'), 8)  // pads by visible width, color preserved
```

Wide-char detection covers CJK ideographs, Hangul, Hiragana/Katakana, fullwidth
forms, and CJK symbols/punctuation. Use these instead of `String.prototype.padEnd`
whenever cells may contain color codes or non-Latin text — the native method
counts bytes/code units and will misalign.
