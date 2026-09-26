#!/usr/bin/env bash
# One-shot local setup: dependencies, data, models, fitted artefacts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> python environment"
[[ -d .venv ]] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r backend/requirements-dev.txt

echo "==> datasets (CUAD + ContractNLI, ~110MB)"
.venv/bin/python scripts/download_data.py

echo "==> checkpoints (~1.1GB)"
.venv/bin/python scripts/download_models.py

if [[ ! -f backend/artifacts/prototypes.npz ]]; then
  echo "==> fitting the extractor prototype bank (no training; ~15 min on CPU)"
  .venv/bin/python scripts/build_prototypes.py
fi

if [[ ! -f backend/artifacts/calibration.json ]]; then
  echo "==> calibrating the verifier threshold on ContractNLI dev (~10 min on CPU)"
  .venv/bin/python scripts/calibrate.py
fi

echo "==> frontend"
cd frontend && npm install --no-audit --no-fund && cd ..

cat <<'EOF'

Setup complete.

  backend :  cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000
  frontend:  cd frontend && npm run dev
  tests   :  cd backend && ../.venv/bin/python -m pytest -q

EOF
