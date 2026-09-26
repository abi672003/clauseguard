"""Load real CUAD contracts into the database.

The demo corpus is drawn from the CUAD **test** split on purpose: those
contracts were held out when the extractor's prototype bank was fitted, so
anything the product shows a buyer is performance on documents the system has
never seen. Seeding from the training split would make the demo a memory test.

Header facts come from CUAD's expert annotations rather than from ClauseGuard's
own heuristics, so the contract metadata shown in the UI is ground truth.
"""
from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import AuditEvent, Contract, ContractStatus
from app.eval import cuad

log = logging.getLogger(__name__)


def available() -> bool:
    return cuad.available()


def seed_contracts(db: Session, limit: int = 8, *, split: str = "test") -> list[Contract]:
    """Insert up to `limit` CUAD contracts that are not already present."""
    if not cuad.available():
        raise FileNotFoundError(
            "CUAD is not downloaded. Run: python scripts/download_data.py"
        )

    existing = {
        cid for (cid,) in db.execute(
            select(Contract.cuad_id).where(Contract.cuad_id.is_not(None))
        )
    }
    pool = [c for c in cuad.load_contracts(split) if c.title not in existing]
    # Richest contracts first - a demo should show the system doing real work.
    pool.sort(key=lambda c: c.n_gold_obligations, reverse=True)

    created: list[Contract] = []
    for c in pool[:limit]:
        party_a, party_b = c.parties
        contract = Contract(
            title=(c.document_name or c.title)[:400],
            filename=f"{c.title[:180]}.txt",
            source="cuad",
            cuad_id=c.title,
            contract_type=_infer_type(c.title),
            party_a=party_a,
            party_b=party_b,
            effective_date=c.effective_date,
            governing_law=c.governing_law,
            raw_text=c.text,
            char_count=len(c.text),
            status=ContractStatus.pending.value,
        )
        db.add(contract)
        db.flush()
        db.add(AuditEvent(
            entity_type="contract", entity_id=contract.id, action="seeded",
            actor="system",
            payload={"source": "CUAD v1", "split": c.split,
                     "gold_obligation_spans": c.n_gold_obligations,
                     "license": "CC BY 4.0"},
        ))
        created.append(contract)

    db.commit()
    log.info("seeded %d CUAD contracts from the %s split", len(created), split)
    return created


def _infer_type(title: str) -> str | None:
    t = title.lower()
    for needle, label in (
        ("distributor", "Distribution"), ("distribution", "Distribution"),
        ("license", "License"), ("licence", "License"), ("supply", "Supply"),
        ("service", "Services"), ("consult", "Consulting"), ("endorsement", "Endorsement"),
        ("promotion", "Promotion"), ("hosting", "Hosting"), ("sponsorship", "Sponsorship"),
        ("joint venture", "Joint Venture"), ("reseller", "Reseller"),
        ("franchise", "Franchise"), ("maintenance", "Maintenance"),
        ("development", "Development"), ("manufactur", "Manufacturing"),
        ("co-branding", "Co-Branding"), ("marketing", "Marketing"),
        ("agency", "Agency"), ("outsourcing", "Outsourcing"),
        ("transportation", "Transportation"), ("strategic", "Strategic Alliance"),
        ("affiliate", "Affiliate"), ("collaboration", "Collaboration"),
        ("non-compete", "Non-Compete"), ("intellectual property", "IP"),
    ):
        if needle in t:
            return label
    return "Agreement"


def corpus_summary(db: Session) -> dict:
    total = db.scalar(select(func.count(Contract.id))) or 0
    seeded = db.scalar(
        select(func.count(Contract.id)).where(Contract.source == "cuad")
    ) or 0
    stats = cuad.corpus_stats() if cuad.available() else {}
    return {
        "contracts_in_db": int(total),
        "from_cuad": int(seeded),
        "cuad_available": cuad.available(),
        "cuad_corpus": stats,
    }
