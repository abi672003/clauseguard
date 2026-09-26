"""ClauseGuard API.

One process serves both the JSON API and the built React client, so the whole
product deploys as a single container behind a single URL.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select

from app.api import analytics, contracts, obligations, review, ws
from app.core.config import ROOT_DIR, settings
from app.db.models import Contract
from app.db.session import SessionLocal, init_db
from app.ml.registry import registry
from app.pipeline.extract import extractor
from app.schemas import HealthOut
from app.services import jobs
from app.services.progress import hub

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("clauseguard")

FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"


def _warm_models() -> None:
    try:
        registry.warmup()
        if extractor.ready:
            extractor._ensure()  # noqa: SLF001
        log.info("models warm")
    except Exception:
        log.exception("model warm-up failed; models will load on first request")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_dirs()
    init_db()
    hub.bind_loop(asyncio.get_running_loop())
    # Warm in the background so the container reports healthy immediately.
    threading.Thread(target=_warm_models, daemon=True, name="warmup").start()
    log.info("%s %s ready (env=%s, device=%s)", settings.app_name, settings.version,
             settings.env, registry.device)
    yield
    jobs.shutdown()


app = FastAPI(
    title="ClauseGuard",
    version=settings.version,
    description=(
        "Contract obligation extraction with entailment-based verification. "
        "Every obligation is checked against its own source clause before it is tracked."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500,
                        content={"detail": "internal error", "error": str(exc)[:400]})


# ------------------------------------------------------------------ health
@app.get(f"{settings.api_prefix}/health", response_model=HealthOut, tags=["meta"])
def health() -> HealthOut:
    db = SessionLocal()
    try:
        n = db.scalar(select(func.count(Contract.id))) or 0
    except Exception:
        n = 0
    finally:
        db.close()
    status = registry.status()
    return HealthOut(
        status="ok",
        version=settings.version,
        env=settings.env,
        models_loaded={**status, "prototype_bank": extractor.ready},
        llm_agent=settings.has_llm,
        verifier_enabled=settings.verifier_enabled,
        entailment_threshold=settings.entailment_threshold,
        device=str(registry.device),
        db_contracts=int(n),
    )


@app.get(f"{settings.api_prefix}/meta", tags=["meta"])
def meta() -> dict:
    """Provenance: exactly which models and datasets this instance runs on."""
    proto = extractor.meta if extractor.ready else {}
    return {
        "app": settings.app_name,
        "version": settings.version,
        "models": {
            "extractor": {
                "checkpoint": settings.extractor_model,
                "role": "frozen encoder for clause embedding",
                "adaptation": "nearest-centroid prototypes over CUAD gold spans",
                "trained": False,
                "prototypes": proto.get("n_prototypes"),
                "categories": len(proto.get("categories", [])),
                "held_out_test": proto.get("test"),
            },
            "verifier": {
                "checkpoint": settings.verifier_model,
                "base": "microsoft/deberta-v3-base",
                "role": "entailment check of claim against source clause",
                "trained": False,
                "adaptation": "decision threshold calibrated on ContractNLI dev",
            },
            "agent": {
                "model": settings.agent_model if settings.has_llm else None,
                "mode": "llm" if settings.has_llm else "deterministic policy engine",
            },
        },
        "datasets": {
            "CUAD": {"contracts": 510, "license": "CC BY 4.0",
                     "use": "clause category prototypes + held-out demo corpus"},
            "ContractNLI": {"documents": 607, "license": "CC BY 4.0",
                            "use": "verifier threshold calibration + ablation"},
        },
        "jobs_running": jobs.running_count(),
    }


# ------------------------------------------------------------------ routers
for r in (contracts.router, obligations.router, review.router,
          analytics.router, ws.router):
    app.include_router(r, prefix=settings.api_prefix)


# ------------------------------------------------- static SPA (single-URL deploy)
if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    # response_model=None: the union return type is a Response, not a schema,
    # and FastAPI would otherwise try to build a pydantic model from it.
    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    async def spa(full_path: str) -> FileResponse | JSONResponse:
        if full_path.startswith(("api/", "assets/")):
            return JSONResponse(status_code=404, content={"detail": "not found"})
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "app": settings.app_name,
            "version": settings.version,
            "docs": "/api/docs",
            "note": "Frontend not built. Run: cd frontend && npm run build",
        }
