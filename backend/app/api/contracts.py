"""Contract ingestion, listing and analysis."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.serializers import contract_counts, contract_summary, obligation_detail
from app.core.config import settings
from app.db.models import AuditEvent, Clause, Contract, ContractStatus, PipelineRun
from app.db.session import get_db
from app.pipeline.ingest import UnsupportedDocument, ingest, ingest_text
from app.pipeline.orchestrator import delete_contract_artifacts
from app.schemas import (
    AnalyzeRequest,
    ClauseOut,
    ContractDetail,
    ContractSummary,
    PipelineRunOut,
    SeedRequest,
    TextIngestRequest,
)
from app.services import jobs, seed

log = logging.getLogger(__name__)
router = APIRouter(prefix="/contracts", tags=["contracts"])


@router.get("")
def list_contracts(
    db: Session = Depends(get_db),
    status: str | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(Contract)
    if status:
        stmt = stmt.where(Contract.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Contract.title.ilike(like),
                              Contract.party_a.ilike(like),
                              Contract.party_b.ilike(like),
                              Contract.contract_type.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Contract.created_at.desc()).limit(limit).offset(offset)
    ).scalars().all()
    counts = contract_counts(db, [r.id for r in rows])
    return {
        "items": [contract_summary(r, counts.get(r.id, {})) for r in rows],
        "total": int(total),
    }


@router.post("/upload", response_model=ContractSummary, status_code=201)
async def upload_contract(
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    analyze: bool = Form(True),
    verifier_enabled: bool | None = Form(None),
) -> ContractSummary:
    blob = await file.read()
    if len(blob) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"file exceeds {settings.max_upload_mb}MB")
    try:
        doc = ingest(file.filename or "contract.txt", blob)
    except UnsupportedDocument as exc:
        raise HTTPException(415, str(exc)) from exc
    except Exception as exc:
        log.exception("ingest failed")
        raise HTTPException(400, f"could not read document: {exc}") from exc

    contract = Contract(
        title=doc.title, filename=file.filename, source="upload",
        contract_type=doc.contract_type, party_a=doc.party_a, party_b=doc.party_b,
        effective_date=doc.effective_date, governing_law=doc.governing_law,
        raw_text=doc.text, char_count=len(doc.text),
        status=ContractStatus.pending.value,
    )
    db.add(contract)
    db.flush()
    db.add(AuditEvent(entity_type="contract", entity_id=contract.id, action="uploaded",
                      actor="user", payload={"filename": file.filename,
                                             "bytes": len(blob), "pages": doc.pages}))
    db.commit()

    if analyze:
        jobs.submit(contract.id, verifier_enabled=verifier_enabled)
    return contract_summary(contract, {})


@router.post("/text", response_model=ContractSummary, status_code=201)
def ingest_contract_text(
    payload: TextIngestRequest, db: Session = Depends(get_db)
) -> ContractSummary:
    doc = ingest_text(payload.title, payload.text, payload.contract_type)
    contract = Contract(
        title=doc.title, filename=None, source="upload",
        contract_type=doc.contract_type, party_a=doc.party_a, party_b=doc.party_b,
        effective_date=doc.effective_date, governing_law=doc.governing_law,
        raw_text=doc.text, char_count=len(doc.text),
        status=ContractStatus.pending.value,
    )
    db.add(contract)
    db.flush()
    db.add(AuditEvent(entity_type="contract", entity_id=contract.id,
                      action="ingested_text", actor="user",
                      payload={"chars": len(doc.text)}))
    db.commit()
    if payload.analyze:
        jobs.submit(contract.id, verifier_enabled=payload.verifier_enabled)
    return contract_summary(contract, {})


@router.post("/seed", status_code=201)
def seed_from_cuad(payload: SeedRequest, db: Session = Depends(get_db)) -> dict:
    try:
        created = seed.seed_contracts(db, limit=payload.limit)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    if payload.analyze:
        for c in created:
            jobs.submit(c.id)
    return {"seeded": [contract_summary(c, {}) for c in created],
            "count": len(created)}


@router.get("/{contract_id}", response_model=ContractDetail)
def get_contract(contract_id: str, db: Session = Depends(get_db)) -> ContractDetail:
    contract = db.execute(
        select(Contract)
        .where(Contract.id == contract_id)
        .options(
            selectinload(Contract.clauses),
            selectinload(Contract.obligations),
        )
    ).scalars().first()
    if contract is None:
        raise HTTPException(404, "contract not found")

    counts = contract_counts(db, [contract.id]).get(contract.id, {})
    dto = ContractDetail.model_validate(contract)
    summary = contract_summary(contract, counts)
    dto.obligation_count = summary.obligation_count
    dto.tracked_count = summary.tracked_count
    dto.review_count = summary.review_count
    dto.rejected_count = summary.rejected_count
    dto.clauses = [ClauseOut.model_validate(c) for c in contract.clauses]
    dto.obligations = [obligation_detail(o, contract_title=contract.title)
                       for o in contract.obligations]
    latest = db.execute(
        select(PipelineRun).where(PipelineRun.contract_id == contract_id)
        .order_by(PipelineRun.created_at.desc()).limit(1)
    ).scalars().first()
    dto.latest_run = PipelineRunOut.model_validate(latest) if latest else None
    return dto


@router.delete("/{contract_id}")
def delete_contract(contract_id: str, db: Session = Depends(get_db)) -> dict:
    contract = db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(404, "contract not found")
    db.delete(contract)
    db.commit()
    delete_contract_artifacts(contract_id)
    return {"deleted": True, "id": contract_id}


@router.post("/{contract_id}/analyze", status_code=202)
def analyze(contract_id: str, payload: AnalyzeRequest | None = None,
            db: Session = Depends(get_db)) -> dict:
    contract = db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(404, "contract not found")
    payload = payload or AnalyzeRequest()
    queued = jobs.submit(
        contract_id, verifier_enabled=payload.verifier_enabled,
        use_agent=payload.use_agent, max_clauses=payload.max_clauses,
    )
    if not queued:
        raise HTTPException(409, "analysis already in progress for this contract")
    return {"queued": True, "contract_id": contract_id,
            "verifier_enabled": payload.verifier_enabled,
            "stream": f"{settings.api_prefix}/ws/pipeline/{contract_id}"}


@router.get("/{contract_id}/clauses", response_model=list[ClauseOut])
def get_clauses(contract_id: str, candidates_only: bool = False,
                db: Session = Depends(get_db)) -> list[ClauseOut]:
    stmt = select(Clause).where(Clause.contract_id == contract_id)
    if candidates_only:
        stmt = stmt.where(Clause.is_candidate.is_(True))
    rows = db.execute(stmt.order_by(Clause.index)).scalars().all()
    return [ClauseOut.model_validate(c) for c in rows]


@router.get("/{contract_id}/runs", response_model=list[PipelineRunOut])
def get_runs(contract_id: str, db: Session = Depends(get_db)) -> list[PipelineRunOut]:
    rows = db.execute(
        select(PipelineRun).where(PipelineRun.contract_id == contract_id)
        .order_by(PipelineRun.created_at.desc()).limit(20)
    ).scalars().all()
    return [PipelineRunOut.model_validate(r) for r in rows]
