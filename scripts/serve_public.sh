#!/usr/bin/env bash
# Bring ClauseGuard up and expose it on a public HTTPS URL.
#
#   ./scripts/serve_public.sh
#
# Starts the container (API + built UI on one port) and opens a Cloudflare quick
# tunnel to it. No Cloudflare account, no card, no router config - cloudflared
# dials out, so it works from behind NAT.
#
# The URL is live only while this script runs and your machine is awake, and a
# quick tunnel gets a new random hostname each time. For a permanent address you
# need a host that is always on - see docs/DEPLOY.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-7860}"
cd "$ROOT"

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker info >/dev/null 2>&1 || {
  echo "The Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
}
command -v cloudflared >/dev/null || {
  echo "cloudflared is missing. Install it with:  brew install cloudflared" >&2
  exit 1
}

echo "==> starting ClauseGuard"
docker compose up -d

printf "==> waiting for the API to report healthy"
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  printf "."
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1; then
  echo
  echo "The API never came up. Logs:" >&2
  docker compose logs --tail 40 >&2
  exit 1
fi

LOG="$(mktemp)"
echo "==> opening the public tunnel"
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

URL=""
for _ in $(seq 1 45); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 2
done

if [[ -z "$URL" ]]; then
  echo "Could not obtain a tunnel URL. cloudflared said:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

cat <<EOF

  ClauseGuard is live at:

      $URL

  Local:  http://localhost:${PORT}
  Health: $URL/api/v1/health
  API:    $URL/api/docs

  The database persists in a Docker volume between restarts. If it is empty,
  open Contracts and click "Load real CUAD contracts".

  Press Ctrl-C to close the tunnel. The container keeps running; stop it with
  'docker compose down'.

EOF

wait "$TUNNEL_PID"
