#!/usr/bin/env bash
# Deploy ClauseGuard to a Hugging Face Docker Space.
#
#   ./scripts/deploy_hf.sh <hf-username> [space-name]
#
# Requires: huggingface_hub CLI, and `hf auth login` (or HF_TOKEN in the env).
# The Space builds the repo's Dockerfile and serves the whole product on one URL.
set -euo pipefail

USER="${1:-}"
SPACE="${2:-clauseguard}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$USER" ]]; then
  echo "usage: $0 <hf-username> [space-name]" >&2
  exit 1
fi

command -v hf >/dev/null 2>&1 || {
  echo "The huggingface CLI is missing. Install it with:" >&2
  echo "  pip install -U 'huggingface_hub[cli]'" >&2
  exit 1
}

REPO="$USER/$SPACE"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> creating Space $REPO (no-op if it exists)"
hf repo create "$SPACE" --repo-type space --space_sdk docker -y 2>/dev/null || true

echo "==> cloning the Space"
git clone "https://huggingface.co/spaces/$REPO" "$WORK/space"

echo "==> syncing source"
rsync -a --delete \
  --exclude '.git/' --exclude '.venv/' --exclude 'node_modules/' \
  --exclude 'frontend/dist/' --exclude 'data/raw/' --exclude 'data/chroma/' \
  --exclude 'data/uploads/' --exclude 'backend/models_cache/' \
  --exclude '__pycache__/' --exclude '*.sqlite3*' --exclude '.env' \
  "$ROOT/" "$WORK/space/"

# The Space needs its own README with the YAML frontmatter that configures it.
cp "$ROOT/deploy/huggingface/README.md" "$WORK/space/README.md"

cd "$WORK/space"
git lfs install --local
git add -A
git commit -m "Deploy ClauseGuard" || { echo "nothing to deploy"; exit 0; }
git push

echo
echo "==> deployed. The Space is building (first build takes ~10-15 min:"
echo "    it installs torch, downloads both checkpoints and both datasets)."
echo "    https://huggingface.co/spaces/$REPO"
