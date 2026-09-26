"""Human-in-the-loop review queue."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.serializers import obligation_detail
from app.db.models import AuditEvent, ObligationStatus, ReviewTask
from app.db.session import get_db
from app.schemas import ReviewResolve, ReviewTaskOut
from app.services.analytics import review_stats

router = APIRouter(prefix="/review", tags=["review"])


def _to_dto(task: ReviewTask) -> ReviewTaskOut:
    dto = ReviewTaskOut.model_validate(task)
    if task.obligation is not None:
        dto.obligation = obligation_detail(task.obligation)
    return dto


@router.get("/queue")
def queue(
    db: Session = Depends(get_db),
    state: str = "open",
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(ReviewTask).options(selectinload(ReviewTask.obligation))
    if state and state != "all":
        stmt = stmt.where(ReviewTask.state == state)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(ReviewTask.priority, ReviewTask.created_at)
        .limit(limit).offset(offset)
    ).scalars().unique().all()
    return {"items": [_to_dto(t) for t in rows], "total": int(total)}


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    return review_stats(db)


@router.post("/{task_id}/resolve", response_model=ReviewTaskOut)
def resolve(task_id: str, payload: ReviewResolve,
            db: Session = Depends(get_db)) -> ReviewTaskOut:
    task = db.execute(
        select(ReviewTask).where(ReviewTask.id == task_id)
        .options(selectinload(ReviewTask.obligation))
    ).scalars().first()
    if task is None:
        raise HTTPException(404, "review task not found")
    if task.state != "open":
        raise HTTPException(409, f"task already {task.state}")

    approved = payload.decision == "approve"
    task.state = "approved" if approved else "rejected"
    task.reviewer = payload.reviewer
    task.notes = payload.notes
    task.resolved_at = datetime.now(UTC)

    if task.obligation is not None:
        task.obligation.status = (ObligationStatus.approved.value if approved
                                  else ObligationStatus.rejected.value)

    db.add(AuditEvent(
        entity_type="review_task", entity_id=task.id, action=f"review_{task.state}",
        actor=payload.reviewer,
        payload={"obligation_id": task.obligation_id, "notes": payload.notes},
    ))
    db.commit()
    db.refresh(task)
    return _to_dto(task)
