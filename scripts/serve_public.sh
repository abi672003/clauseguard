#!/usr/bin/env bash
# Run ClauseGuard and expose it on a public HTTPS URL. No Docker required.
#
#   ./scripts/serve_public.sh
#
# uvicorn serves the JSON API *and* the built React client on one port, so a
# single tunnel exposes the whole product. cloudflared dials outbound, so this
# works from behind NAT with no account, card or router configuration.
#
# The URL lives only while this script runs and the machine is awake, and a
# quick tunnel gets a new random hostname each time. For a permanent address you
# need an always-on host - see docs/DEPLOY.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7860}"
VENV="$ROOT/.venv"
cd "$ROOT"

[[ -x "$VENV/bin/uvicorn" ]] || {
  echo "No virtualenv at $VENV. Run ./scripts/bootstrap.sh first." >&2
  exit 1
}
[[ -f "$ROOT/frontend/dist/index.html" ]] || {
  echo "The frontend is not built. Run:  cd frontend && npm run build" >&2
  exit 1
}
[[ -f "$ROOT/backend/artifacts/prototypes.npz" ]] || {
  echo "The extractor prototype bank is missing. Run:" >&2
  echo "  $VENV/bin/python scripts/build_prototypes.py" >&2
  exit 1
}
command -v cloudflared >/dev/null || {
  echo "cloudflared is missing. Install it with:  brew install cloudflared" >&2
  exit 1
}

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Set PORT=xxxx to use another." >&2
  exit 1
fi

echo "==> starting ClauseGuard (native, no container)"
cd "$ROOT/backend"
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 TOKENIZERS_PARALLELISM=false \
ANONYMIZED_TELEMETRY=False \
  "$VENV/bin/uvicorn" app.main:app --host 127.0.0.1 --port "$PORT" \
  >"$ROOT/clauseguard-server.log" 2>&1 &
SERVER_PID=$!
cd "$ROOT"

LOG="$(mktemp)"
cleanup() {
  kill "${TUNNEL_PID:-0}" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

printf "==> waiting for the API"
for _ in $(seq 1 90); do
  curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 && { echo " ok"; break; }
  kill -0 "$SERVER_PID" 2>/dev/null || {
    echo; echo "The server exited. Last lines:" >&2
    tail -20 "$ROOT/clauseguard-server.log" >&2
    exit 1
  }
  printf "."
  sleep 2
done

echo "==> opening the public tunnel"
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >"$LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 45); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 2
done
[[ -n "$URL" ]] || { echo "No tunnel URL. cloudflared said:" >&2; tail -20 "$LOG" >&2; exit 1; }

cat <<EOF

  ClauseGuard is live at:

      $URL

  Local:  http://localhost:${PORT}
  Health: $URL/api/v1/health
  API:    $URL/api/docs
  Logs:   $ROOT/clauseguard-server.log

  If the database is empty, open Contracts and click
  "Load real CUAD contracts".

  Ctrl-C stops both the tunnel and the server.

EOF

wait "$TUNNEL_PID"
