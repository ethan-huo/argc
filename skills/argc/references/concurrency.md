# Concurrent & Interactive Commands

For commands that fan out work across many targets, or ask a human to pick from
a list. A single-target query command needs none of this — it does one thing and
returns one value. Two rules dominate everything below:

1. **Progress and prompts go to stderr.** stdout stays the clean result an agent
   reads. (Same rule as `references/output.md`, it just gets harder to honor when
   work is concurrent and interactive.)
2. **Concurrency must still produce deterministic stdout.** Agents diff and grep
   your output across runs; completion order is not an acceptable order.

## Bounded concurrency — use `pacer`, don't hand-roll

Do not write your own `p-limit` / `Promise.all` worker pool. **Read the `pacer`
skill** — its `AsyncQueuer` with a `concurrency` cap *is* the bounded pool, with
retry/backoff and rate-limiting in the same family. argc ships no concurrency
primitive on purpose; this is where it lives.

- Pick a small default (8 is reasonable) and expose it as a `concurrency` input
  field so an agent can tune it.
- Why bounded matters: an unbounded `Promise.all` over N targets opens N sockets
  / clones N repos at once — upstream rate-limits, file-descriptor exhaustion,
  and an unreadable interleaved log. A cap of 8 fixes all three.

## Failures are data, not exceptions

A batch over N targets must never abort on the first failure — one bad target
must not sink the other nineteen, and the agent needs to see *which* failed.

Wrap each task so it catches its own error and returns a result union; the pool
itself never rejects:

```typescript
type Outcome =
  | { kind: 'ok'; id: string; summary: string }
  | { kind: 'error'; id: string; error: unknown }

async function runOne(target: Target): Promise<Outcome> {
  try {
    return { kind: 'ok', id: target.id, summary: await doWork(target) }
  } catch (error) {
    return { kind: 'error', id: target.id, error } // failure becomes a value
  }
}
```

Then report partial success in the summary and set the exit code from the
failure count — `process.exitCode = 1` when any failed (see `references/flow.md`
exit codes). Distinguish "0 of 20 failed" from "3 of 20 failed" in the summary
line; a silent partial failure is the worst outcome.

## Stable output ordering

Concurrency surfaces results in *completion* order. This matters **more** with
`pacer` — `AsyncQueuer` hands you each result the moment it finishes — so you
must re-sort before writing stdout:

```typescript
outcomes.sort((a, b) => a.id.localeCompare(b.id)) // stable key, never finish-time
for (const o of outcomes) process.stdout.write(render(o))
```

Sort by a stable key (target name/id), not by when the work happened to finish.
Two runs over the same targets should produce byte-identical stdout.

## Live progress grid (stderr)

Multi-target work wants one row per task — a spinner plus a stage label ticking
in place — not a single spinner that hides which targets are slow. Render the
whole grid to stderr; stdout stays the summary.

Model each row as a small state machine and let tasks push transitions:

```typescript
type Stage =
  | { kind: 'queued' }
  | { kind: 'running'; label: string } // label = current phase, e.g. 'cloning'
  | { kind: 'done'; label: string }
  | { kind: 'error'; label: string }
```

Build the rendering on `argc/terminal` (see `references/terminal.md`): spinner
frames via `fmt.cyan`, `fmt.green('✓')` / `fmt.red('✗')` for terminal states,
and **`padEnd` / `visibleWidth` for column alignment** — native `String.padEnd`
miscounts color codes and CJK and will misalign the grid.

Two things the grid must get right or it produces garbage in transcripts:

- **Degrade when not interactive.** No TTY, `CI`, `NO_COLOR`, or a `--no-progress`
  flag → fall back to **one line per completion** (emit only on `done`/`error`
  transitions), so a CI log reads as a clean list instead of replaying hundreds
  of redraw frames.
- **Cursor & signal hygiene.** Hide the cursor while drawing; on stop *and* on
  SIGINT, clear the partial frame and restore the cursor before exiting `130`.
  `references/terminal.md` shows this for a single spinner — a grid is the same
  cleanup applied to N rows. Skip it and Ctrl-C leaves a half-drawn frame and an
  invisible cursor in the user's shell.

For a single long task, you don't need a custom grid — `@clack/prompts`'
`spinner()` already does stderr + cleanup. Reach for the custom grid only when
you have N concurrent rows.

## Interactive selection (clack, stderr)

argc ships no prompt UI. Use **`@clack/prompts`** — it renders to stderr by
default, which is exactly right; never route a prompt to stdout.

- **Switch UI by list size.** A plain `select` / `multiselect` for a short list
  (≲10), a searchable `autocompleteMultiselect` for a long one. Don't make a
  human arrow-key through 200 options.
- **Cancel is an abort, not a default.** Every prompt can be cancelled (Ctrl-C /
  Esc). Check `isCancel` and stop — never fall through to a default value or an
  empty selection. A cancelled "pick skills to install" must install *neither*
  nothing-silently nor everything.

```typescript
import * as p from '@clack/prompts'

const picked = await p.multiselect({ message: 'Pick skills', options })
if (p.isCancel(picked)) {
  p.cancel('Aborted.') // restores the terminal, prints a cancel notice
  process.exit(130)
}
```

*When* to prompt at all — the TTY check, the `CI` / `--non-interactive`
contract, "ask only for the smallest missing value" — lives in
`references/flow.md`. This section is only the *how*.

## See also

- `references/flow.md` — when to prompt, non-interactive contract, exit codes.
- `references/terminal.md` — `fmt`, `padEnd`/`visibleWidth`, single-spinner
  SIGINT/EPIPE hygiene.
- `references/output.md` — why stdout is reserved for the structured result.
- the `pacer` skill — the concurrency primitive itself (queue, retry, throttle).
