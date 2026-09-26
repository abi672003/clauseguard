#!/usr/bin/env bash
# Deploy ClauseGuard to a Hugging Face Docker Space.
#
#   ./scripts/deploy_hf.sh <hf-username> [space-name]
#
# Prerequisites (one time):
#   pip install -U "huggingface_hub[cli]"
#   hf auth login --add-to-git-credential      # --add-to-git-credential matters:
#                                              # the git push below authenticates
#                                              # with the same token.
#
# The Space builds this repo's Dockerfile and serves the API and the built React
# client on a single URL. The first build takes 10-15 minutes because it installs
# torch and bakes in both checkpoints and both datasets.
set -euo pipefail

USER="${1:-}"
SPACE="${2:-clauseguard}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$USER" ]]; then
  echo "usage: $0 <hf-username> [space-name]" >&2
  exit 1
fi

# Prefer the project venv's CLI, fall back to whatever is on PATH.
HF="$ROOT/.venv/bin/hf"
[[ -x "$HF" ]] || HF="$(command -v hf || true)"
if [[ -z "$HF" ]]; then
  echo "The huggingface CLI is missing. Install it with:" >&2
  echo "  pip install -U 'huggingface_hub[cli]'" >&2
  exit 1
fi

if ! "$HF" auth whoami >/dev/null 2>&1; then
  echo "Not logged in to Hugging Face. Run:" >&2
  echo "  $HF auth login --add-to-git-credential" >&2
  exit 1
fi

REPO="$USER/$SPACE"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> creating Space $REPO (ok if it already exists)"
"$HF" repo create "$REPO" --repo-type space --space_sdk docker --exist-ok

echo "==> cloning the Space"
git clone "https://huggingface.co/spaces/$REPO" "$WORK/space"

echo "==> syncing source"
rsync -a --delete \
  --exclude '.git/' --exclude '.venv/' --exclude 'node_modules/' \
  --exclude 'frontend/dist/' --exclude 'data/raw/' --exclude 'data/chroma/' \
  --exclude 'data/uploads/' --exclude 'backend/models_cache/' \
  --exclude '__pycache__/' --exclude '*.sqlite3*' --exclude '.env' \
  "$ROOT/" "$WORK/space/"

# A Space is configured by YAML frontmatter in its own README.
cp "$ROOT/deploy/huggingface/README.md" "$WORK/space/README.md"

cd "$WORK/space"
git lfs install --local
git add -A
if git diff --cached --quiet; then
  echo "nothing to deploy - the Space already matches this working tree"
  exit 0
fi
git commit -m "Deploy ClauseGuard"
git push

cat <<EOF

==> pushed. The Space is building now (first build: 10-15 min).
    https://huggingface.co/spaces/$REPO

    Optional: add ANTHROPIC_API_KEY as a Space secret named
    CLAUSEGUARD_ANTHROPIC_API_KEY to enable the Claude Haiku agent.
    Without it the deterministic policy engine runs and the product is
    fully functional.
EOF
