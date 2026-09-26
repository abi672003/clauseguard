"""ORM -> DTO shaping that several routers share."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Contract, Obligation, ObligationStatus
from app.schemas import ContractSummary, ObligationDetail


def obligation_detail(ob: Obligation, *, contract_title: str | None = None) -> ObligationDetail:
    dto = ObligationDetail.model_validate(ob)
    dto.contract_title = contract_title or (ob.contract.title if ob.contract else None)
    return dto


def contract_counts(db: Session, contract_ids: list[str]) -> dict[str, dict[str, int]]:
    """Obligation tallies per contract, in one query rather than N."""
    if not contract_ids:
        return {}
    rows = db.execute(
        select(Obligation.contract_id, Obligation.status, func.count(Obligation.id))
        .where(Obligation.contract_id.in_(contract_ids))
        .group_by(Obligation.contract_id, Obligation.status)
    ).all()
    out: dict[str, dict[str, int]] = {cid: {} for cid in contract_ids}
    for cid, status, n in rows:
        out.setdefault(cid, {})[status] = int(n)
    return out


def contract_summary(contract: Contract, counts: dict[str, int] | None = None) -> ContractSummary:
    counts = counts or {}
    dto = ContractSummary.model_validate(contract)
    dto.obligation_count = sum(counts.values())
    dto.tracked_count = (counts.get(ObligationStatus.auto_tracked.value, 0)
                         + counts.get(ObligationStatus.approved.value, 0))
    dto.review_count = counts.get(ObligationStatus.pending_review.value, 0)
    dto.rejected_count = counts.get(ObligationStatus.rejected.value, 0)
    return dto
