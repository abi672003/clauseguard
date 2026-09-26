"""Background analysis jobs.

Analysis is CPU-bound and takes tens of seconds, so it never runs inside a
request. Jobs run on a small bounded thread pool - bounded because two
transformer models on an 8GB box will not tolerate unbounded concurrency - and
report progress through the hub.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from app.db.models import Contract, ContractStatus
from app.db.session import SessionLocal
from app.pipeline.orchestrator import analyze_contract
from app.services.progress import hub

log = logging.getLogger(__name__)

# Two transformer models resident per worker; more than two workers on a
# typical 8GB deployment starts swapping.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="clauseguard-job")
_inflight: set[str] = set()
_lock = threading.Lock()


def is_running(contract_id: str) -> bool:
    with _lock:
        return contract_id in _inflight


def running_count() -> int:
    with _lock:
        return len(_inflight)


def _run(contract_id: str, verifier_enabled: bool | None,
         use_agent: bool | None, max_clauses: int | None) -> None:
    db = SessionLocal()
    try:
        contract = db.get(Contract, contract_id)
        if contract is None:
            log.warning("job for missing contract %s", contract_id)
            return

        def emit(stage: str, message: str, pct: float, payload: dict) -> None:
            hub.publish(contract_id, {
                "contract_id": contract_id, "stage": stage,
                "message": message, "pct": round(pct, 4), "payload": payload,
            })

        analyze_contract(
            db, contract,
            verifier_enabled=verifier_enabled, use_agent=use_agent,
            max_clauses=max_clauses, on_progress=emit,
        )
    except Exception:
        log.exception("analysis job crashed for %s", contract_id)
        try:
            contract = db.get(Contract, contract_id)
            if contract and contract.status == ContractStatus.processing.value:
                contract.status = ContractStatus.failed.value
                db.commit()
        except Exception:
            log.exception("could not mark contract %s failed", contract_id)
    finally:
        db.close()
        with _lock:
            _inflight.discard(contract_id)


def submit(contract_id: str, *, verifier_enabled: bool | None = None,
           use_agent: bool | None = None, max_clauses: int | None = None) -> bool:
    """Queue an analysis. Returns False if one is already in flight."""
    with _lock:
        if contract_id in _inflight:
            return False
        _inflight.add(contract_id)
    hub.clear(contract_id)
    hub.publish(contract_id, {
        "contract_id": contract_id, "stage": "queued",
        "message": "Queued for analysis", "pct": 0.0, "payload": {},
    })
    _executor.submit(_run, contract_id, verifier_enabled, use_agent, max_clauses)
    return True


def shutdown() -> None:
    _executor.shutdown(wait=False, cancel_futures=True)
