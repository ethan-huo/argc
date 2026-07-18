- 2026-06-11 install.sh template: private-repo path end-to-end verified against celados/calque (curl 404 → private detect → gh fallback → install OK). Public direct-curl path untested — no public repo with a bare release asset yet; verify on first public tool release.

## schema --schema status line lies on depth-sliced output (B2)

When `--schema=.group` collapses sub-groups to empty `{}` (depth=1 slice), the
header still prints "Schema status: fully output; no drill-down query is needed."
Fix: drive the status line + drill-down syntax block off "did rendering emit a
zero-child group?" (folded boolean computed in generateSchema), not off line count.
Identified 2026-06-15 while adding nested/asymmetric set selectors; not in scope
for that change.

## argc 7.1 / 7.2 deferred tail (2026-06-25)

Accepted during the 7.1 human-path + 7.2 OKF-rendering arc; none blocking, all verified
present at v7.2.1.

- **Error meta dual-audience drift.** Human-path `INVALID_INPUT` now carries both
  `$hint` (→ `<cmd> --help`, for the human) and `$schema` (TS slice, for the agent) —
  mild drift from spec-7.0 §3a ("`$schema` present ⟹ no `$hint`"), and the TS dump is
  noise for a human typo. Clean fix: per-audience split in `cli.ts finalizeEnvelope` —
  human-parser errors keep `$hint` only, object/`@run` errors keep `$schema` only.
  Needs the envelope to know which door it came through.
- **Non-boolean flag eats the next token unconditionally** (`human.ts:174`). `read a --depth
--toc` consumes `--toc` as depth's value → misleading "Expected number but received
  '--toc'" instead of "missing flag value for --depth". Old parser guarded
  `!next.startsWith('-')`; add that guard.
- **Dead branch** (`human.ts:97`): `addPositional` checks `value.startsWith('--')`, but the
  flag branch upstream already intercepts all `--`-leading tokens, so it is unreachable.
  Remove or document.
- **Per-command help descriptions fall back to `value`** when input fields lack `.describe()`
  (`## Arguments`/`## Options` in `help.ts`). Not a bug; encourage downstream tools to add
  field descriptions so the human help carries real signal.
- **Doc hygiene:** `docs/proposal-7.1-human-path.md` is still `status: draft` though 7.1 shipped
  in v7.1.0 — set it to `accepted` to match `proposal-7.2` (already accepted).

## meta.examples fix tail (2026-07-15)

Found while diagnosing why `hq @schema` rendered `{ name: 'value' }` boilerplate over
hand-written examples. Fixed in v7.6.0 (`f5b89ec`); these are the leftovers.

- **Nothing runs `bun run check` except a release.** `release.yml` triggers only on
  `paths: package.json`, so a commit that touches src/docs/skills is never checked. Drift
  accumulates invisibly and lands as a _blocked release_ on whoever bumps the version next:
  `4f58eea` left `skills/argc/references/{concurrency,flow}.md` failing `fmt:check`, which
  would have failed the v7.6.0 tag job had it not been cleaned first. Add a push/PR CI job
  running `bun run check` — the release job then only ever confirms what CI already knew.
