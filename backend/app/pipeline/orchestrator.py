"""The end-to-end pipeline.

    segment -> prefilter -> extract -> deadline map -> verify -> agent -> persist

Every obligation that comes out the far end carries its own evidence: the clause
it was drawn from, the claim that was made about it, the entailment
probabilities that judged that claim, and the decision that was taken as a
result. Nothing is tracked without that chain being recorded, which is what
makes the output auditable rather than merely plausible.

`verifier_enabled=False` runs the same pipeline with stage 5 skipped and every
extraction trusted. That is the control arm of the ablation, and it is also what
a conventional extraction product does.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    AgentDecision,
    AuditEvent,
    Clause,
    Contract,
    ContractStatus,
    Obligation,
    ObligationStatus,
    PipelineRun,
    ReviewTask,
    Verification,
)
from app.pipeline import agent as agent_mod
from app.pipeline.deadline import to_obligation
from app.pipeline.extract import extractor
from app.pipeline.prefilter import prefilter, store
from app.pipeline.segment import segment
from app.pipeline.taxonomy import CATEGORIES
from app.pipeline.verify import verify

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, str, float, dict], None]

STAGES = ("queued", "ingest", "segment", "prefilter", "extract",
          "deadline", "verify", "agent", "persist", "complete")


@dataclass
class StageClock:
    timings: dict[str, float] = field(default_factory=dict)
    _t0: float = field(default_factory=time.perf_counter)

    def mark(self, stage: str) -> None:
        now = time.perf_counter()
        self.timings[stage] = round((now - self._t0) * 1000, 1)
        self._t0 = now

    @property
    def total_ms(self) -> float:
        return round(sum(self.timings.values()), 1)


def _noop(stage: str, message: str, pct: float, payload: dict) -> None:
    return None


def analyze_contract(
    db: Session,
    contract: Contract,
    *,
    verifier_enabled: bool | None = None,
    use_agent: bool | None = None,
    max_clauses: int | None = None,
    on_progress: ProgressFn | None = None,
) -> PipelineRun:
    """Run the full pipeline over one contract and persist everything."""
    emit = on_progress or _noop
    verify_on = settings.verifier_enabled if verifier_enabled is None else verifier_enabled
    clock = StageClock()
    counts: dict[str, int | str | bool] = {}

    contract.status = ContractStatus.processing.value
    contract.error = None
    db.commit()

    try:
        # ---- wipe any previous analysis so re-runs are idempotent ----------
        emit("ingest", "Preparing contract", 0.02, {})
        db.execute(delete(Obligation).where(Obligation.contract_id == contract.id))
        db.execute(delete(Clause).where(Clause.contract_id == contract.id))
        db.commit()
        clock.mark("ingest")

        # ---- 1. segment ---------------------------------------------------
        emit("segment", "Segmenting contract into clause spans", 0.08, {})
        spans = segment(contract.raw_text)
        counts["spans"] = len(spans)
        clock.mark("segment")
        emit("segment", f"{len(spans)} clause spans", 0.15, {"spans": len(spans)})

        if not spans:
            raise ValueError("no clause-sized spans could be segmented from this document")

        # ---- 2. prefilter (ChromaDB) --------------------------------------
        emit("prefilter", "Embedding spans and pre-filtering", 0.20, {})
        pre = prefilter(contract.id, spans)
        counts["prefiltered"] = len(pre.kept)
        counts["prefilter_backend"] = pre.backend
        counts["embeddings_cached"] = pre.cached
        clock.mark("prefilter")
        emit("prefilter", f"{len(pre.kept)} of {len(spans)} spans worth extracting",
             0.32, {"kept": len(pre.kept), "backend": pre.backend, "cached": pre.cached})

        kept_idx = pre.kept[:max_clauses] if max_clauses else pre.kept
        kept_spans = [spans[i] for i in kept_idx]
        # Reuse the vectors the pre-filter just computed instead of encoding the
        # same spans a second time.
        kept_vecs = pre.embeddings[kept_idx] if len(pre.embeddings) else None

        # ---- 3. extract ---------------------------------------------------
        emit("extract", f"Classifying {len(kept_spans)} spans with Legal-BERT prototypes",
             0.38, {})
        extracted = extractor.extract(kept_spans, embeddings=kept_vecs)
        candidates = [e for e in extracted if e.is_candidate]
        counts["candidates"] = len(candidates)
        clock.mark("extract")
        emit("extract", f"{len(candidates)} obligation candidates", 0.50,
             {"candidates": len(candidates)})

        # persist clause rows (all pre-filtered spans, candidate or not)
        clause_rows: list[Clause] = []
        by_key: dict[int, Clause] = {}
        for local_i, ex in enumerate(extracted):
            global_i = kept_idx[local_i]
            row = Clause(
                contract_id=contract.id, index=global_i,
                text=ex.span.text, char_start=ex.span.start, char_end=ex.span.end,
                category=ex.category, category_score=round(ex.category_score, 4),
                runner_up=ex.runner_up, runner_up_score=round(ex.runner_up_score, 4),
                prefilter_score=round(float(pre.scores[global_i]), 4),
                is_candidate=ex.is_candidate,
            )
            clause_rows.append(row)
            by_key[local_i] = row
        db.add_all(clause_rows)
        db.flush()

        # ---- 4. deadline mapping ------------------------------------------
        emit("deadline", "Mapping clauses to trackable obligations", 0.56, {})
        proposals: list[tuple[Clause, object]] = []
        for local_i, ex in enumerate(extracted):
            if not ex.is_candidate or not ex.category:
                continue
            cat = CATEGORIES.get(ex.category)
            if cat is None:
                continue
            rec = to_obligation(cat, ex.span.text, effective_date=contract.effective_date)
            proposals.append((by_key[local_i], rec))
        counts["proposals"] = len(proposals)
        clock.mark("deadline")
        emit("deadline", f"{len(proposals)} trackable obligations proposed", 0.62,
             {"proposals": len(proposals)})

        # ---- 5. verify (the contribution) ---------------------------------
        verifications: list[object | None]
        if verify_on and proposals:
            emit("verify", f"Verifying {len(proposals)} claims against their source clauses",
                 0.66, {"n": len(proposals)})
            # Disjunctive categories carry several phrasings. Score them all and
            # keep the best-entailed limb, which is what "A or B" actually means
            # and also records which limb fired.
            flat: list[tuple[str, str]] = []
            owner: list[int] = []
            for idx, (clause_row, rec) in enumerate(proposals):
                for variant in rec.claim_variants or [rec.claim]:
                    flat.append((clause_row.text, variant))
                    owner.append(idx)
            scored = verify(flat)

            best: list[object | None] = [None] * len(proposals)
            for own, res in zip(owner, scored, strict=True):
                current = best[own]
                if current is None or res.entailment > current.entailment:
                    best[own] = res
            for (_clause_row, rec), res in zip(proposals, best, strict=True):
                if res is not None:
                    rec.claim = res.hypothesis   # the limb that actually verified
            results = [r for r in best if r is not None]
            verifications = list(best)
            counts["grounded"] = sum(1 for v in results if v.verdict == "grounded")
            counts["uncertain"] = sum(1 for v in results if v.verdict == "uncertain")
            counts["ungrounded"] = sum(1 for v in results if v.verdict == "ungrounded")
            emit("verify",
                 f"{counts['grounded']} grounded / {counts['uncertain']} uncertain / "
                 f"{counts['ungrounded']} ungrounded", 0.80, dict(counts))
        else:
            verifications = [None] * len(proposals)
            counts["grounded"] = counts["uncertain"] = counts["ungrounded"] = 0
            emit("verify", "Verifier disabled - every extraction trusted as-is", 0.80,
                 {"verifier_enabled": False})
        clock.mark("verify")

        # ---- 6. agent decision loop ---------------------------------------
        emit("agent", "Deciding: track automatically or escalate", 0.84, {})
        want_llm = settings.has_llm if use_agent is None else use_agent
        tracked = escalated = rejected = 0
        agent_mode = "llm" if (want_llm and settings.has_llm and verify_on) else "deterministic"

        for (clause_row, rec), ver in zip(proposals, verifications, strict=False):
            outcome = agent_mod.decide(
                rec, ver, contract_title=contract.title,
                verifier_enabled=verify_on, use_llm=want_llm,
            )
            if outcome.action == agent_mod.AUTO_TRACK:
                status = ObligationStatus.auto_tracked.value
                tracked += 1
            elif outcome.action == agent_mod.ESCALATE:
                status = ObligationStatus.pending_review.value
                escalated += 1
            else:
                status = ObligationStatus.rejected.value
                rejected += 1

            ob = Obligation(
                contract_id=contract.id, clause_id=clause_row.id,
                obligation_type=rec.obligation_type, title=rec.title, claim=rec.claim,
                obligor=rec.obligor, obligee=rec.obligee,
                due_date=rec.due_date, due_date_basis=rec.due_date_basis,
                recurrence=rec.recurrence, notice_period_days=rec.notice_period_days,
                monetary_amount=rec.monetary_amount, currency=rec.currency,
                severity=rec.severity,
                extraction_confidence=round(clause_row.category_score, 4),
                status=status,
            )
            db.add(ob)
            db.flush()

            if ver is not None:
                db.add(Verification(
                    obligation_id=ob.id, premise=ver.premise, hypothesis=ver.hypothesis,
                    entailment=round(ver.entailment, 6), neutral=round(ver.neutral, 6),
                    contradiction=round(ver.contradiction, 6), margin=round(ver.margin, 6),
                    verdict=ver.verdict, threshold_used=ver.threshold_used,
                    model_name=ver.model_name, latency_ms=round(ver.latency_ms, 2),
                    evidence_sentence=ver.evidence_sentence,
                ))

            db.add(AgentDecision(
                obligation_id=ob.id, action=outcome.action, rationale=outcome.rationale,
                risk_flags=outcome.risk_flags, confidence=outcome.confidence,
                policy_mode=outcome.policy_mode, model_name=outcome.model_name,
                input_tokens=outcome.input_tokens, output_tokens=outcome.output_tokens,
                latency_ms=round(outcome.latency_ms, 2),
            ))

            if outcome.action == agent_mod.ESCALATE:
                db.add(ReviewTask(
                    obligation_id=ob.id, state="open",
                    reason=outcome.rationale[:2000],
                    priority={"critical": 0, "high": 1, "medium": 2, "low": 3}
                             .get(rec.severity, 2),
                ))

        counts["auto_tracked"] = tracked
        counts["pending_review"] = escalated
        counts["rejected"] = rejected
        counts["agent_mode"] = agent_mode
        clock.mark("agent")
        emit("agent", f"{tracked} auto-tracked, {escalated} to review, {rejected} rejected",
             0.94, {"auto_tracked": tracked, "pending_review": escalated,
                    "rejected": rejected})

        # ---- 7. persist ----------------------------------------------------
        emit("persist", "Writing results", 0.97, {})
        contract.status = ContractStatus.complete.value
        contract.processed_at = datetime.now(UTC)
        run = PipelineRun(
            contract_id=contract.id, verifier_enabled=verify_on, agent_mode=agent_mode,
            stage_timings=clock.timings, counts=counts, total_ms=clock.total_ms,
            status="complete",
        )
        db.add(run)
        db.add(AuditEvent(
            entity_type="contract", entity_id=contract.id, action="analyzed",
            actor="pipeline",
            payload={"verifier_enabled": verify_on, "agent_mode": agent_mode, **counts},
        ))
        db.commit()
        clock.mark("persist")
        emit("complete", "Analysis complete", 1.0, dict(counts))
        log.info("analyzed %s in %.0fms: %s", contract.id, clock.total_ms, counts)
        return run

    except Exception as exc:
        db.rollback()
        contract.status = ContractStatus.failed.value
        contract.error = str(exc)[:2000]
        run = PipelineRun(
            contract_id=contract.id, verifier_enabled=verify_on,
            agent_mode="deterministic", stage_timings=clock.timings, counts=counts,
            total_ms=clock.total_ms, status="failed", error=str(exc)[:2000],
        )
        db.add(run)
        db.commit()
        emit("failed", f"Analysis failed: {exc}", 1.0, {"error": str(exc)})
        log.exception("pipeline failed for contract %s", contract.id)
        return run


def delete_contract_artifacts(contract_id: str) -> None:
    """Drop the contract's cached span embeddings when it is deleted."""
    store.delete_contract(contract_id)
