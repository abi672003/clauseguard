"""ClauseGuard API: wires the real extraction/deadline-mapping/verification
pipeline to HTTP endpoints for the frontend.

The document view is backed by real CUAD expert annotations (ground truth,
not synthetic) so it's fully real and usable before the fine-tuned Legal-BERT
extractor is in place — see /api/contracts/{id}. Live model extraction and
verification are separate endpoints that 503 clearly until their checkpoints
are dropped in, per constraint 0.3.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from clauseguard.db import get_connection
from clauseguard.extraction.deadline_mapping import map_to_obligation

app = FastAPI(title="ClauseGuard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class VerifyRequest(BaseModel):
    premise: str
    hypothesis: str


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/contracts/sample")
def sample_contracts(limit: int = 20):
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT c.id, c.title, COUNT(cl.id) AS n_clauses
        FROM contracts c JOIN clauses cl ON cl.contract_id = c.id
        WHERE c.source = 'cuad' AND cl.is_impossible = 0
        GROUP BY c.id ORDER BY RANDOM() LIMIT ?
        """,
        (limit,),
    ).fetchall()
    conn.close()
    return [{"id": r[0], "title": r[1], "n_clauses": r[2]} for r in rows]


@app.get("/api/contracts/{contract_id}")
def get_contract(contract_id: str):
    """Real contract text + real CUAD expert-annotated clause spans (ground
    truth) — this is what the frontend renders as the annotated document,
    independent of whether the trained extractor is available yet."""
    conn = get_connection()
    contract = conn.execute(
        "SELECT id, title, text FROM contracts WHERE id = ?", (contract_id,)
    ).fetchone()
    if contract is None:
        conn.close()
        raise HTTPException(404, "contract not found")

    clause_rows = conn.execute(
        "SELECT clause_type, clause_text, answer_start FROM clauses "
        "WHERE contract_id = ? AND is_impossible = 0 AND answer_start IS NOT NULL",
        (contract_id,),
    ).fetchall()
    conn.close()

    clauses = []
    for clause_type, clause_text, answer_start in clause_rows:
        obligation = map_to_obligation(
            contract_id, {"clause_type": clause_type, "text": clause_text}
        )
        clauses.append(
            {
                "clause_type": clause_type,
                "text": clause_text,
                "start": answer_start,
                "end": answer_start + len(clause_text),
                "parsed_date": str(obligation.parsed_date) if obligation and obligation.parsed_date else None,
                "parsed_duration": obligation.parsed_duration if obligation else None,
                "trackable": obligation is not None,
            }
        )

    return {"id": contract[0], "title": contract[1], "text": contract[2], "clauses": clauses}


@app.post("/api/verify")
def verify_claim(req: VerifyRequest):
    try:
        from clauseguard.verification.verifier import verify

        return {"model_available": True, **verify(req.premise, req.hypothesis)}
    except FileNotFoundError as e:
        return {"model_available": False, "message": str(e)}
