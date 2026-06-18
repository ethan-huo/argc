#!/usr/bin/env bash
set -euo pipefail

# Scaffold a new argc-based CLI tool from this skill's templates.
# Substitutes myapp/MYAPP placeholders, pins argc to its latest release tag,
# then runs install + check + build so the result is verified, not just copied.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/../templates"

NAME=""
DIR=""
REPO=""
SKIP_CHECK=false

usage() {
  cat <<'USAGE'
Usage: argc-start.sh --name NAME [--dir DIR] [--repo OWNER/REPO] [--skip-check]

Scaffold a new argc CLI project.

Options:
  --name NAME       Tool name (required). Lowercase letters, digits, hyphens.
  --dir DIR         Target directory. Default: ./NAME
  --repo OWNER/REPO GitHub repo slug, substituted into install.sh and the
                    tool's SKILL.md. Default: owner/NAME (fix later).
  --skip-check      Skip bun install + check + build verification.
  -h, --help        Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="${2:?Missing value for --name}"; shift 2 ;;
    --dir) DIR="${2:?Missing value for --dir}"; shift 2 ;;
    --repo) REPO="${2:?Missing value for --repo}"; shift 2 ;;
    --skip-check) SKIP_CHECK=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$NAME" ]]; then
  echo "--name is required" >&2
  usage >&2
  exit 1
fi
if ! [[ "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Invalid name: $NAME (expected lowercase letters, digits, hyphens)" >&2
  exit 1
fi

DIR="${DIR:-./$NAME}"
REPO="${REPO:-owner/$NAME}"
# Env-var prefix for install.sh: my-tool -> MY_TOOL
UPPER="$(printf '%s' "$NAME" | tr 'a-z-' 'A-Z_')"

if [[ -e "$DIR" ]]; then
  echo "Target already exists: $DIR" >&2
  exit 1
fi

mkdir -p "$DIR/src" "$DIR/.github/workflows" "$DIR/skills/$NAME" "$DIR/.agents/skills/release"

# render SRC DEST: copy a template, substituting {{...}} placeholders
render() {
  sed -e "s|{{REPO}}|$REPO|g" \
    -e "s|{{APP_NAME_UPPER}}|$UPPER|g" \
    -e "s|{{APP_NAME}}|$NAME|g" \
    "$TEMPLATES_DIR/$1" > "$DIR/$2"
}

render main.ts src/main.ts
render main.test.ts src/main.test.ts
render package.json package.json
render tsconfig.json tsconfig.json
render ci.yml .github/workflows/ci.yml
render release.yml .github/workflows/release.yml
render install.sh install.sh
render .agents/skills/release/SKILL.md .agents/skills/release/SKILL.md
render tool-skill.md "skills/$NAME/SKILL.md"
render AGENTS.md AGENTS.md
chmod +x "$DIR/install.sh"

# CLAUDE.md is the same dev guide under the name Claude Code auto-loads.
ln -s AGENTS.md "$DIR/CLAUDE.md"

cat > "$DIR/README.md" <<EOF
# $NAME

Describe what $NAME does in one line.

## Install

Public repo:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash
\`\`\`

Private repo (requires an authenticated \`gh\` session; the script falls back
to \`gh release download\` automatically):

\`\`\`bash
gh api repos/$REPO/contents/install.sh --jq .content | base64 -d | bash
\`\`\`

From source:

\`\`\`bash
bun install
bun src/main.ts --help
\`\`\`

## Develop

\`\`\`bash
bun run check
bun run build
\`\`\`

## Release

Bump \`version\` in package.json and push to main. The release workflow tags
vX.Y.Z and attaches the bundle automatically.

## Agent Skill

\`\`\`text
skills/$NAME/SKILL.md
\`\`\`
EOF

cat > "$DIR/.gitignore" <<'EOF'
node_modules/
dist/
EOF

# Pin argc to its latest release tag. argc publishes git tags, not GitHub
# Releases, so query tags directly; keep the template's pin on failure.
latest_tag="$(git ls-remote --tags --refs https://github.com/ethan-huo/argc.git 'v*' 2>/dev/null \
  | awk -F/ '{print $NF}' | sort -V | tail -1 || true)"
if [[ "$latest_tag" =~ ^v[0-9] ]]; then
  sed -e "s|github:ethan-huo/argc#v[0-9][^\"]*|github:ethan-huo/argc#$latest_tag|" \
    "$DIR/package.json" > "$DIR/package.json.tmp"
  mv "$DIR/package.json.tmp" "$DIR/package.json"
  echo "Pinned argc to $latest_tag"
else
  echo "Warning: could not resolve latest argc tag via gh; kept the template pin." >&2
fi

git init -q "$DIR"

if [[ "$SKIP_CHECK" != "true" ]]; then
  # fmt before check: placeholder substitution shifts markdown table widths,
  # so the rendered files need one oxfmt pass to satisfy fmt:check.
  (cd "$DIR" && bun install && bun run fmt && bun run check && bun run build)
  echo
  echo "Verified: check + build pass. Try: $DIR/dist/$NAME --schema"
fi

cat <<EOF

Scaffolded $NAME at $DIR

Next steps:
  1. Implement your schema and handlers in src/main.ts
  2. Fill in skills/$NAME/SKILL.md (the tool's agent skill)
  3. Create the GitHub repo ($REPO) and push — release.yml handles releases
  4. Use .agents/skills/release/SKILL.md when cutting future releases
EOF
