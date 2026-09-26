"""Dashboard aggregates and the research read-outs."""
from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    AblationResult,
    Clause,
    Contract,
    ContractStatus,
    Obligation,
    ObligationStatus,
    ReviewTask,
    Verification,
)
from app.pipeline.verify import CALIBRATION_PATH


def dashboard(db: Session) -> dict:
    today = date.today()
    horizon = today + timedelta(days=30)

    contracts = db.scalar(select(func.count(Contract.id))) or 0
    processed = db.scalar(
        select(func.count(Contract.id)).where(Contract.status == ContractStatus.complete.value)
    ) or 0
    clauses = db.scalar(select(func.count(Clause.id))) or 0
    candidates = db.scalar(
        select(func.count(Clause.id)).where(Clause.is_candidate.is_(True))
    ) or 0

    status_counts = dict(
        db.execute(select(Obligation.status, func.count(Obligation.id))
                   .group_by(Obligation.status)).all()
    )
    verdict_counts = dict(
        db.execute(select(Verification.verdict, func.count(Verification.id))
                   .group_by(Verification.verdict)).all()
    )
    obligations = sum(status_counts.values())

    grounded = int(verdict_counts.get("grounded", 0))
    ungrounded = int(verdict_counts.get("ungrounded", 0))
    uncertain = int(verdict_counts.get("uncertain", 0))
    verified = grounded + ungrounded + uncertain

    # The headline product metric: of everything extraction proposed, how much
    # did the verifier stop from being silently tracked?
    blocked_rate = round((ungrounded + uncertain) / verified, 4) if verified else 0.0
    mean_entail = db.scalar(select(func.avg(Verification.entailment))) or 0.0

    tracked_states = (ObligationStatus.auto_tracked.value, ObligationStatus.approved.value)
    upcoming = db.scalar(
        select(func.count(Obligation.id)).where(
            Obligation.due_date.is_not(None),
            Obligation.due_date >= today, Obligation.due_date <= horizon,
            Obligation.status.in_(tracked_states),
        )
    ) or 0
    overdue = db.scalar(
        select(func.count(Obligation.id)).where(
            Obligation.due_date.is_not(None), Obligation.due_date < today,
            Obligation.status.in_(tracked_states),
        )
    ) or 0

    by_type = dict(
        db.execute(select(Obligation.obligation_type, func.count(Obligation.id))
                   .group_by(Obligation.obligation_type)).all()
    )
    by_severity = dict(
        db.execute(select(Obligation.severity, func.count(Obligation.id))
                   .group_by(Obligation.severity)).all()
    )

    # due dates bucketed by month, tracked vs under review
    month_rows = db.execute(
        select(Obligation.due_date, Obligation.status)
        .where(Obligation.due_date.is_not(None))
    ).all()
    buckets: dict[str, Counter] = {}
    for due, status in month_rows:
        key = f"{due.year:04d}-{due.month:02d}"
        buckets.setdefault(key, Counter())[status] += 1
    by_month = [
        {
            "month": k,
            "total": sum(v.values()),
            "auto_tracked": v.get(ObligationStatus.auto_tracked.value, 0),
            "pending_review": v.get(ObligationStatus.pending_review.value, 0),
            "approved": v.get(ObligationStatus.approved.value, 0),
            "rejected": v.get(ObligationStatus.rejected.value, 0),
        }
        for k, v in sorted(buckets.items())
    ]

    # points for the 3D obligation constellation
    scatter_rows = db.execute(
        select(
            Obligation.id, Obligation.title, Obligation.severity,
            Obligation.obligation_type, Obligation.due_date, Obligation.status,
            Verification.entailment, Verification.verdict,
        )
        .join(Verification, Verification.obligation_id == Obligation.id, isouter=True)
        .limit(1200)
    ).all()
    scatter = [
        {
            "id": r.id, "title": r.title, "severity": r.severity,
            "type": r.obligation_type, "status": r.status,
            "entailment": round(float(r.entailment), 4) if r.entailment is not None else None,
            "verdict": r.verdict,
            "days_until_due": (r.due_date - today).days if r.due_date else None,
        }
        for r in scatter_rows
    ]

    return {
        "contracts": int(contracts),
        "contracts_processed": int(processed),
        "clauses": int(clauses),
        "candidate_clauses": int(candidates),
        "obligations": int(obligations),
        "auto_tracked": int(status_counts.get(ObligationStatus.auto_tracked.value, 0)),
        "pending_review": int(status_counts.get(ObligationStatus.pending_review.value, 0)),
        "approved": int(status_counts.get(ObligationStatus.approved.value, 0)),
        "rejected": int(status_counts.get(ObligationStatus.rejected.value, 0)),
        "grounded": grounded,
        "ungrounded": ungrounded,
        "uncertain": uncertain,
        "hallucination_rate_blocked": blocked_rate,
        "mean_entailment": round(float(mean_entail), 4),
        "upcoming_30d": int(upcoming),
        "overdue": int(overdue),
        "by_type": {k: int(v) for k, v in by_type.items()},
        "by_severity": {k: int(v) for k, v in by_severity.items()},
        "by_month": by_month,
        "verdict_scatter": scatter,
    }


def review_stats(db: Session) -> dict:
    rows = dict(
        db.execute(select(ReviewTask.state, func.count(ReviewTask.id))
                   .group_by(ReviewTask.state)).all()
    )
    open_tasks = db.execute(
        select(ReviewTask.created_at).where(ReviewTask.state == "open")
    ).scalars().all()
    from datetime import datetime

    now = datetime.now(UTC).replace(tzinfo=None)
    ages = [(now - c).total_seconds() / 3600 for c in open_tasks if c]
    return {
        "open": int(rows.get("open", 0)),
        "approved": int(rows.get("approved", 0)),
        "rejected": int(rows.get("rejected", 0)),
        "mean_age_hours": round(sum(ages) / len(ages), 2) if ages else 0.0,
    }


def calibration_report() -> dict:
    """The threshold sweep produced by scripts/calibrate.py on ContractNLI dev."""
    if not CALIBRATION_PATH.exists():
        return {
            "available": False,
            "threshold": None,
            "curve": [],
            "note": "Run: python scripts/calibrate.py",
        }
    payload = json.loads(CALIBRATION_PATH.read_text())
    return {
        "available": True,
        "threshold": payload.get("entailment_threshold"),
        "contradiction_threshold": payload.get("contradiction_threshold"),
        "calibrated_on": payload.get("calibrated_on"),
        "held_out": payload.get("held_out"),
        "verifier_model": payload.get("verifier_model"),
        "base_model": payload.get("base_model"),
        "dev": payload.get("dev", {}),
        "test": payload.get("test", {}),
        "curve": payload.get("curve", []),
    }


def ablation_reports(db: Session) -> list[dict]:
    """Group persisted ablation rows into paired on/off reports."""
    rows = db.execute(
        select(AblationResult).order_by(AblationResult.created_at.desc())
    ).scalars().all()

    by_run: dict[str, list[AblationResult]] = {}
    for r in rows:
        by_run.setdefault(r.run_label, []).append(r)

    reports: list[dict] = []
    for label, arms in by_run.items():
        arm_map = {a.arm: a for a in arms}
        on, off = arm_map.get("verifier_on"), arm_map.get("verifier_off")
        if not (on and off):
            continue
        delta = {
            k: round(float(on.metrics.get(k, 0)) - float(off.metrics.get(k, 0)), 4)
            for k in ("precision", "recall", "f1", "false_obligation_rate")
        }
        reports.append({
            "run_label": label,
            "dataset": on.dataset,
            "created_at": on.created_at,
            "arms": [
                {"arm": "verifier_off", "n_samples": off.n_samples, "metrics": off.metrics},
                {"arm": "verifier_on", "n_samples": on.n_samples, "metrics": on.metrics},
            ],
            "delta": delta,
            "notes": on.notes,
        })
    return reports
