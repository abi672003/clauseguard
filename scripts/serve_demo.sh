#!/usr/bin/env bash
# Serve ClauseGuard for a remote demo from this machine.
#
#   ./scripts/serve_demo.sh
#
# Does three things a plain tunnel does not:
#   1. keeps the Mac awake, so the link does not die when the lid-open machine
#      idles (caffeinate);
#   2. publishes the current public URL to a GitHub Gist, so you can look it up
#      from any browser - a Cloudflare quick tunnel gets a NEW random hostname
#      every restart and you would otherwise have no way to find it;
#   3. restarts the tunnel automatically if it drops, republishing the new URL.
#
# Requires: gh (authenticated), cloudflared, and a bootstrapped checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7860}"
VENV="$ROOT/.venv"
GIST_FILE="clauseguard-live-url.md"
STATE="$ROOT/.demo-gist-id"
cd "$ROOT"

for tool in cloudflared gh; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed." >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Run: gh auth login" >&2; exit 1; }
[[ -x "$VENV/bin/uvicorn" ]] || { echo "Run ./scripts/bootstrap.sh first." >&2; exit 1; }
[[ -f "$ROOT/frontend/dist/index.html" ]] || {
  echo "Frontend not built. Run: cd frontend && npm run build" >&2; exit 1; }

SERVER_PID=""; TUNNEL_PID=""; CAFF_PID=""
cleanup() {
  for pid in "$TUNNEL_PID" "$SERVER_PID" "$CAFF_PID"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# --- keep the machine awake for the whole session -------------------------
caffeinate -dimsu & CAFF_PID=$!
echo "==> this Mac will stay awake until you press Ctrl-C"

# --- start the app --------------------------------------------------------
if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
  echo "==> reusing the server already listening on ${PORT}"
else
  echo "==> starting ClauseGuard"
  ( cd "$ROOT/backend" && \
    HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 TOKENIZERS_PARALLELISM=false \
    ANONYMIZED_TELEMETRY=False \
    "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$PORT" \
      >"$ROOT/clauseguard-server.log" 2>&1 ) & SERVER_PID=$!
  printf "==> waiting for the API"
  for _ in $(seq 1 90); do
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 && { echo " ok"; break; }
    printf "."; sleep 2
  done
fi

publish_url() {
  local url="$1" body
  body=$(cat <<EOF
# ClauseGuard - live demo link

## $url

Last updated: $(date '+%Y-%m-%d %H:%M %Z')

This link is served from a laptop over a Cloudflare tunnel, so it is live only
while that machine is awake and running \`scripts/serve_demo.sh\`. The hostname
changes every time the tunnel restarts; this page always shows the current one.

- Dashboard: $url/dashboard
- Research (the ablation): $url/research
- API docs: $url/api/docs
- Health: $url/api/v1/health
EOF
)
  if [[ -f "$STATE" ]]; then
    local id; id="$(cat "$STATE")"
    printf '%s' "$body" > "/tmp/$GIST_FILE"
    if gh gist edit "$id" -f "$GIST_FILE" "/tmp/$GIST_FILE" >/dev/null 2>&1; then
      echo "==> updated gist: https://gist.github.com/$id"
      return
    fi
    echo "   (previous gist unavailable, creating a new one)"
  fi
  printf '%s' "$body" > "/tmp/$GIST_FILE"
  local out; out="$(gh gist create "/tmp/$GIST_FILE" --public \
      --desc "ClauseGuard live demo link" 2>/dev/null | tail -1)"
  echo "${out##*/}" > "$STATE"
  echo "==> gist created: $out"
}

# --- tunnel, with automatic restart ---------------------------------------
while true; do
  LOG="$(mktemp)"
  cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >"$LOG" 2>&1 &
  TUNNEL_PID=$!

  URL=""
  for _ in $(seq 1 45); do
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
    [[ -n "$URL" ]] && break
    sleep 2
  done

  if [[ -z "$URL" ]]; then
    echo "tunnel failed to start; retrying in 10s" >&2
    tail -5 "$LOG" >&2; kill "$TUNNEL_PID" 2>/dev/null || true
    rm -f "$LOG"; sleep 10; continue
  fi

  publish_url "$URL"
  cat <<EOF

  ================================================================
    LIVE:  $URL
  ================================================================

  Look this up from any browser via the gist above - bookmark the
  gist, not the tunnel URL, because the tunnel URL changes.

  Ctrl-C stops everything and lets this Mac sleep again.

EOF

  wait "$TUNNEL_PID" || true
  echo "!! tunnel dropped - restarting and republishing" >&2
  rm -f "$LOG"
  sleep 5
done
