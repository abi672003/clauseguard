# ClauseGuard - single container serving the API and the built React client.
#
# Models and datasets are baked in at build time, so a running container makes
# no Hugging Face network call and starts deterministically.

# ---------- stage 1: build the frontend ----------
FROM node:20-bookworm-slim AS web

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build


# ---------- stage 2: python runtime ----------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=4

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch keeps the image ~2GB instead of ~6GB with the CUDA wheels.
RUN pip install --no-cache-dir torch==2.5.1 \
        --index-url https://download.pytorch.org/whl/cpu

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY scripts/ /app/scripts/
COPY docs/ /app/docs/

# Bake the datasets (CUAD for the demo corpus, ContractNLI for calibration and
# the ablation) and both frozen checkpoints into the image.
RUN python /app/scripts/download_data.py && \
    rm -f /app/data/raw/contract_nli/contract-nli.zip && \
    python /app/scripts/download_models.py

# Prototype bank + calibration are committed artefacts; rebuild only if absent.
RUN test -f /app/backend/artifacts/prototypes.npz || \
    python /app/scripts/build_prototypes.py

COPY --from=web /build/dist /app/frontend/dist

# Hugging Face Spaces runs containers as uid 1000.
RUN useradd -m -u 1000 appuser && \
    mkdir -p /app/data/chroma /app/data/uploads /app/backend/artifacts && \
    chown -R appuser:appuser /app
USER appuser

ENV CLAUSEGUARD_ENV=prod \
    CLAUSEGUARD_DEVICE=cpu \
    PORT=7860
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/api/v1/health || exit 1

WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1 --timeout-keep-alive 75"]
