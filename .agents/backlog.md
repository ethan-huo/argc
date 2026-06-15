- 2026-06-11 install.sh template: private-repo path end-to-end verified against celados/calque (curl 404 → private detect → gh fallback → install OK). Public direct-curl path untested — no public repo with a bare release asset yet; verify on first public tool release.

## schema --schema status line lies on depth-sliced output (B2)

When `--schema=.group` collapses sub-groups to empty `{}` (depth=1 slice), the
header still prints "Schema status: fully output; no drill-down query is needed."
Fix: drive the status line + drill-down syntax block off "did rendering emit a
zero-child group?" (folded boolean computed in generateSchema), not off line count.
Identified 2026-06-15 while adding nested/asymmetric set selectors; not in scope
for that change.
