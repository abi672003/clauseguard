# ClauseGuard

Agentic system that extracts contractual obligations and verifies each one
against its source clause before tracking or alerting on it.

## What's real, what's pending

Every dataset here is real (see `docs/DATA_PROVENANCE.md`) and every
pipeline stage is implemented and tested against real data. Two fine-tuned
checkpoints are missing — they must be trained in Google Colab (this
project can't reach Hugging Face from the eventual deployment laptop, and
this session can't run multi-hour Colab training itself; see constraint 0.3
in the project brief).

**To finish setup:**
1. Open `notebooks/finetune_legalbert_cuad.ipynb` in Colab (GPU runtime),
   upload `data/raw/cuad/CUAD_v1.json`, run all cells. Unzip the result
   into `models/clauseguard-extractor/`.
2. Open `notebooks/finetune_deberta_contractnli.ipynb`, upload `train.json`
   / `dev.json` / `test.json` from `data/raw/contractnli/contract-nli/`,
   run all cells. Unzip the result into `models/clauseguard-verifier/`.
3. `git add models/clauseguard-extractor models/clauseguard-verifier && git commit`.
4. Copy `.env.example` to `.env` and add your `ANTHROPIC_API_KEY` (the
   agentic auto-track/escalate layer in `src/clauseguard/agent/`).

See `docs/DOMAIN_TRANSFER.md` for a real limitation to keep in view: the
verifier is trained on NDA-specific ContractNLI hypotheses, so its
confidence on non-NDA CUAD contract types is a generalization test, not a
validated result.

## Running it

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# one-time data layer build (already done once — only needed after a fresh clone)
python3 scripts/build_sqlite.py

# backend
python3 -m uvicorn clauseguard.api.main:app --app-dir src --port 8011

# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5174. The annotated document view works immediately
using real CUAD ground-truth clause spans; verification shows a clear
"checkpoint not found" message until step 2 above is done.

## Layout

- `docs/DATA_PROVENANCE.md` — where every dataset actually came from and how it was verified
- `docs/DOMAIN_TRANSFER.md` — the NDA-specific-verifier limitation
- `src/clauseguard/` — extraction, deadline mapping, verification, agent, API
- `scripts/run_ablation.py` — verifier-on vs. verifier-off false-obligation rate, run once the verifier checkpoint is in place
- `tests/` — `pytest tests/`
