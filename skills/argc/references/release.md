# Build & Release Pipeline

The scaffold wires this up for you. The template files **are** the pipeline and
carry their own header comments — read them as the source of truth, not this page:

- `templates/release.yml` → `.github/workflows/release.yml` — version-bump detection, tag, GitHub Release
- `templates/install.sh` → `install.sh` — end-user install, public + private fallback
- `templates/package.json` → the `build` / `check` scripts the workflow runs

This page covers only what those files can't say inline: the contract and the
non-obvious edges.

## The contract: version bump _is_ the release trigger

```
bump package.json "version" → push to main
  → release.yml detects the change
  → bun run check && bun run build
  → tags vX.Y.Z, creates a GitHub Release with dist/<name> attached
```

There is no manual tagging step. To cut a release, edit `version` in
`package.json` and push. Pushing without a version change runs CI only.

`version` flows from `package.json` into the CLI via
`import packageJson from '../package.json' with { type: 'json' }` — never hardcode
it, or the release tag and `--version` drift apart.

## Bundle

```bash
bun build src/main.ts --outfile=dist/<name> --target=bun --minify
```

A single executable JS file. `--target=bun` injects the `#!/usr/bin/env bun`
shebang; the `build` script still appends `chmod +x` (see `package.json`).

## End-user install

The scaffold README carries both forms:

```bash
# public repo
curl -fsSL https://raw.githubusercontent.com/<owner>/<name>/main/install.sh | bash
# private repo (install.sh itself needs gh to fetch)
gh api repos/<owner>/<name>/contents/install.sh --jq .content | base64 -d | bash
```

`install.sh` curls the bare `dist/<name>` from the release URL into
`~/.local/bin`; on a 404 (private repo) it falls back to `gh release download`
with the user's GitHub auth — the logic is commented in the file itself.

## Native binary instead of a JS bundle

Use `bun build --compile` only when the user explicitly wants a no-Bun-required
binary — it is ~50MB+ per platform and needs a target matrix. The default JS
bundle assumes `bun` is on PATH (`install.sh` checks for it).

## Edge: how version-bump detection actually works

`release.yml` compares the new `version` against `github.event.before`, so
squash-merging several bumps in one push still releases only the final version.
A force-push with a zero `before` SHA falls back to tag-existence checking — if
the tag for the current version already exists, it won't re-release.
