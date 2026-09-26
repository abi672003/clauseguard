"""Dashboard aggregates, calibration, and the ablation study."""
from __future__ import annotations

import logging
import threading
from datetime import UTC

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import AblationResult
from app.db.session import get_db, session_scope
from app.eval import ablation as ablation_mod
from app.services.analytics import ablation_reports, calibration_report, dashboard

log = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"])

_ablation_lock = threading.Lock()
_ablation_state: dict = {"running": False, "progress": 0.0, "stage": "", "error": None}


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)) -> dict:
    return dashboard(db)


@router.get("/calibration")
def get_calibration() -> dict:
    return calibration_report()


@router.get("/ablation")
def get_ablation(db: Session = Depends(get_db)) -> list[dict]:
    return ablation_reports(db)


@router.get("/ablation/status")
def ablation_status() -> dict:
    return dict(_ablation_state)


def _run_ablation(mode: str, n_samples: int, run_label: str) -> None:
    def progress(stage: str, pct: float) -> None:
        _ablation_state["stage"] = stage
        _ablation_state["progress"] = round(pct, 3)

    try:
        if mode == "pipeline":
            arms, meta = ablation_mod.run_pipeline(
                n_contracts=max(2, n_samples // 40), on_progress=progress
            )
        else:
            arms, meta = ablation_mod.run_contractnli(
                n_samples=n_samples, on_progress=progress
            )
        with session_scope() as db:
            for arm in arms:
                db.add(AblationResult(
                    run_label=run_label, arm=arm.arm, dataset=meta["dataset"],
                    n_samples=arm.n_samples, metrics=arm.metrics,
                    notes=meta.get("note") or
                          f"base rate grounded={meta.get('base_rate_grounded')}; "
                          f"verifier={meta.get('verifier_model')}",
                ))
        _ablation_state["error"] = None
        log.info("ablation %s complete: %s", run_label, ablation_mod.delta(arms))
    except Exception as exc:
        log.exception("ablation failed")
        _ablation_state["error"] = str(exc)
    finally:
        _ablation_state["running"] = False
        _ablation_state["progress"] = 1.0
        _ablation_state["stage"] = "complete"


@router.post("/ablation/run", status_code=202)
def run_ablation(
    n_samples: int = Body(600, embed=True),
    run_label: str | None = Body(None, embed=True),
    mode: str = Body("contractnli", embed=True),
) -> dict:
    if mode not in {"contractnli", "pipeline"}:
        raise HTTPException(422, "mode must be 'contractnli' or 'pipeline'")
    with _ablation_lock:
        if _ablation_state["running"]:
            raise HTTPException(409, "an ablation run is already in progress")
        _ablation_state.update({"running": True, "progress": 0.0,
                                "stage": "starting", "error": None})

    from datetime import datetime
    label = run_label or f"{mode}-{datetime.now(UTC):%Y%m%d-%H%M%S}"
    threading.Thread(target=_run_ablation, args=(mode, n_samples, label),
                     daemon=True, name="ablation").start()
    return {"started": True, "run_label": label, "mode": mode, "n_samples": n_samples}
