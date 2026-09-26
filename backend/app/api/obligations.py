"""The obligation register."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.serializers import obligation_detail
from app.db.models import AuditEvent, Contract, Obligation, ObligationStatus, Verification
from app.db.session import get_db
from app.schemas import ObligationDetail, ObligationOut

router = APIRouter(prefix="/obligations", tags=["obligations"])

_LOADED = (
    selectinload(Obligation.clause),
    selectinload(Obligation.verification),
    selectinload(Obligation.decision),
    selectinload(Obligation.contract),
)


@router.get("")
def list_obligations(
    db: Session = Depends(get_db),
    status: str | None = None,
    type: str | None = Query(None, alias="type"),
    severity: str | None = None,
    verdict: str | None = None,
    contract_id: str | None = None,
    due_before: date | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Obligation).options(*_LOADED)
    if status:
        stmt = stmt.where(Obligation.status == status)
    if type:
        stmt = stmt.where(Obligation.obligation_type == type)
    if severity:
        stmt = stmt.where(Obligation.severity == severity)
    if contract_id:
        stmt = stmt.where(Obligation.contract_id == contract_id)
    if due_before:
        stmt = stmt.where(Obligation.due_date.is_not(None),
                          Obligation.due_date <= due_before)
    if verdict:
        stmt = stmt.join(Verification, Verification.obligation_id == Obligation.id) \
                   .where(Verification.verdict == verdict)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Obligation.title.ilike(like),
                              Obligation.claim.ilike(like),
                              Obligation.obligor.ilike(like)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Obligation.created_at.desc()).limit(limit).offset(offset)
    ).scalars().unique().all()
    return {"items": [obligation_detail(o) for o in rows], "total": int(total)}


@router.get("/calendar")
def calendar(
    db: Session = Depends(get_db),
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
) -> dict:
    start = from_ or date.today()
    end = to or (start + timedelta(days=180))
    rows = db.execute(
        select(Obligation)
        .where(Obligation.due_date.is_not(None),
               Obligation.due_date >= start, Obligation.due_date <= end)
        .order_by(Obligation.due_date)
    ).scalars().all()
    days: dict[str, list] = {}
    for o in rows:
        days.setdefault(o.due_date.isoformat(), []).append(ObligationOut.model_validate(o))
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "days": [{"date": k, "items": v} for k, v in sorted(days.items())],
        "total": len(rows),
    }


@router.get("/{obligation_id}", response_model=ObligationDetail)
def get_obligation(obligation_id: str, db: Session = Depends(get_db)) -> ObligationDetail:
    ob = db.execute(
        select(Obligation).where(Obligation.id == obligation_id).options(*_LOADED)
    ).scalars().first()
    if ob is None:
        raise HTTPException(404, "obligation not found")
    return obligation_detail(ob)


@router.patch("/{obligation_id}/status", response_model=ObligationDetail)
def set_status(
    obligation_id: str,
    status: str = Body(..., embed=True),
    db: Session = Depends(get_db),
) -> ObligationDetail:
    valid = {s.value for s in ObligationStatus}
    if status not in valid:
        raise HTTPException(422, f"status must be one of {sorted(valid)}")
    ob = db.execute(
        select(Obligation).where(Obligation.id == obligation_id).options(*_LOADED)
    ).scalars().first()
    if ob is None:
        raise HTTPException(404, "obligation not found")

    previous = ob.status
    ob.status = status
    db.add(AuditEvent(entity_type="obligation", entity_id=ob.id,
                      action="status_changed", actor="user",
                      payload={"from": previous, "to": status}))
    db.commit()
    db.refresh(ob)
    return obligation_detail(ob)


@router.get("/{obligation_id}/context")
def obligation_context(obligation_id: str, db: Session = Depends(get_db)) -> dict:
    """The clause in the surrounding document, for the highlight view."""
    ob = db.execute(
        select(Obligation).where(Obligation.id == obligation_id).options(*_LOADED)
    ).scalars().first()
    if ob is None:
        raise HTTPException(404, "obligation not found")
    contract = db.get(Contract, ob.contract_id)
    if contract is None or ob.clause is None:
        raise HTTPException(404, "source clause unavailable")
    pad = 1200
    s = max(0, ob.clause.char_start - pad)
    e = min(len(contract.raw_text), ob.clause.char_end + pad)
    return {
        "contract_id": contract.id,
        "contract_title": contract.title,
        "char_start": ob.clause.char_start,
        "char_end": ob.clause.char_end,
        "excerpt_start": s,
        "excerpt": contract.raw_text[s:e],
        "clause_text": ob.clause.text,
    }
