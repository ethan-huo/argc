---
name: release
description: Release this CLI by bumping package.json and letting the main-branch workflow tag, build, and publish
---

# Release

Use this when the user asks to publish, ship, or release a new version of this CLI.

## Contract

The release trigger is the `package.json` version on `main`.

```
bump package.json version -> validate locally -> commit -> push main
  -> .github/workflows/release.yml tags vX.Y.Z
  -> workflow runs check/build and uploads dist/{{APP_NAME}} to the GitHub Release
```

Do not create the tag manually unless the workflow is broken and the user explicitly accepts a manual recovery path.

## Steps

1. Inspect the worktree and understand the change being released.
2. Run the local gate:

```bash
bun run check
bun run build
```

3. Bump `package.json` with the smallest correct SemVer change.
4. Rerun `bun run check` after the version bump.
5. Commit only the intended files.
6. Push `main`.
7. Watch the Release workflow to completion.
8. Verify the remote tag and release asset:

```bash
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
gh release view vX.Y.Z
```

## Rules

- `package.json` is the version source of truth; do not hardcode versions in source.
- A pushed commit is not a finished release. Finish only after the workflow is green and the release exists.
- If the workflow fails, fix the cause and push a follow-up commit. Do not rerun a broken workflow blindly.
- Keep staging explicit when the worktree contains unrelated changes.
