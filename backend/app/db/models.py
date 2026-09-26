"""SQLAlchemy ORM models - the system of record for contracts, clauses,
obligations, and (critically) the verification evidence behind every claim."""
from __future__ import annotations

import enum
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------- enums
class ContractStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"


class ObligationStatus(str, enum.Enum):
    auto_tracked = "auto_tracked"       # verifier + agent both cleared it
    pending_review = "pending_review"   # escalated to a human
    approved = "approved"               # human confirmed
    rejected = "rejected"               # human or agent rejected it
    expired = "expired"


class Verdict(str, enum.Enum):
    grounded = "grounded"       # clause entails the obligation claim
    ungrounded = "ungrounded"   # clause contradicts or fails to support it
    uncertain = "uncertain"     # inside the calibrated indecision band


class AgentAction(str, enum.Enum):
    auto_track = "auto_track"
    escalate = "escalate"
    reject = "reject"


# ------------------------------------------------------------------ contract
class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(512), index=True)
    filename: Mapped[str | None] = mapped_column(String(512))
    source: Mapped[str] = mapped_column(String(32), default="upload")  # upload | cuad
    cuad_id: Mapped[str | None] = mapped_column(String(256), index=True)
    contract_type: Mapped[str | None] = mapped_column(String(128), index=True)
    party_a: Mapped[str | None] = mapped_column(String(256))
    party_b: Mapped[str | None] = mapped_column(String(256))
    effective_date: Mapped[date | None] = mapped_column(Date)
    governing_law: Mapped[str | None] = mapped_column(String(128))
    raw_text: Mapped[str] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default=ContractStatus.pending.value, index=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)

    clauses: Mapped[list[Clause]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="Clause.index"
    )
    obligations: Mapped[list[Obligation]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )
    runs: Mapped[list[PipelineRun]] = relationship(
        back_populates="contract", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("cuad_id", name="uq_contract_cuad_id"),)


# -------------------------------------------------------------------- clause
class Clause(Base):
    """A candidate span of contract text, with the extractor's read on it."""

    __tablename__ = "clauses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(
        ForeignKey("contracts.id", ondelete="CASCADE"), index=True
    )
    index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    char_start: Mapped[int] = mapped_column(Integer, default=0)
    char_end: Mapped[int] = mapped_column(Integer, default=0)

    # extractor output
    category: Mapped[str | None] = mapped_column(String(128), index=True)
    category_score: Mapped[float] = mapped_column(Float, default=0.0)
    runner_up: Mapped[str | None] = mapped_column(String(128))
    runner_up_score: Mapped[float] = mapped_column(Float, default=0.0)
    prefilter_score: Mapped[float] = mapped_column(Float, default=0.0)
    is_candidate: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    contract: Mapped[Contract] = relationship(back_populates="clauses")
    obligations: Mapped[list[Obligation]] = relationship(
        back_populates="clause", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_clause_contract_index", "contract_id", "index"),)


# ---------------------------------------------------------------- obligation
class Obligation(Base):
    """A trackable duty derived from a clause. `claim` is the machine-generated
    natural-language assertion that the verifier must find entailed by `clause`."""

    __tablename__ = "obligations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(
        ForeignKey("contracts.id", ondelete="CASCADE"), index=True
    )
    clause_id: Mapped[str] = mapped_column(
        ForeignKey("clauses.id", ondelete="CASCADE"), index=True
    )

    obligation_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512))
    claim: Mapped[str] = mapped_column(Text)          # the hypothesis sent to the verifier
    obligor: Mapped[str | None] = mapped_column(String(256))
    obligee: Mapped[str | None] = mapped_column(String(256))

    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    due_date_basis: Mapped[str | None] = mapped_column(String(256))
    recurrence: Mapped[str | None] = mapped_column(String(64))
    notice_period_days: Mapped[int | None] = mapped_column(Integer)
    monetary_amount: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(8))

    severity: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    extraction_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(
        String(24), default=ObligationStatus.pending_review.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    contract: Mapped[Contract] = relationship(back_populates="obligations")
    clause: Mapped[Clause] = relationship(back_populates="obligations")
    verification: Mapped[Verification | None] = relationship(
        back_populates="obligation", cascade="all, delete-orphan", uselist=False
    )
    decision: Mapped[AgentDecision | None] = relationship(
        back_populates="obligation", cascade="all, delete-orphan", uselist=False
    )
    review: Mapped[ReviewTask | None] = relationship(
        back_populates="obligation", cascade="all, delete-orphan", uselist=False
    )


# -------------------------------------------------------------- verification
class Verification(Base):
    """The research contribution: did the cited clause actually entail the claim?"""

    __tablename__ = "verifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    obligation_id: Mapped[str] = mapped_column(
        ForeignKey("obligations.id", ondelete="CASCADE"), index=True, unique=True
    )

    premise: Mapped[str] = mapped_column(Text)      # the clause, verbatim
    hypothesis: Mapped[str] = mapped_column(Text)   # the obligation claim

    entailment: Mapped[float] = mapped_column(Float, default=0.0)
    neutral: Mapped[float] = mapped_column(Float, default=0.0)
    contradiction: Mapped[float] = mapped_column(Float, default=0.0)
    margin: Mapped[float] = mapped_column(Float, default=0.0)
    verdict: Mapped[str] = mapped_column(String(16), index=True)
    threshold_used: Mapped[float] = mapped_column(Float, default=0.0)
    model_name: Mapped[str] = mapped_column(String(128))
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    evidence_sentence: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    obligation: Mapped[Obligation] = relationship(back_populates="verification")


# ------------------------------------------------------------ agent decision
class AgentDecision(Base):
    __tablename__ = "agent_decisions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    obligation_id: Mapped[str] = mapped_column(
        ForeignKey("obligations.id", ondelete="CASCADE"), index=True, unique=True
    )
    action: Mapped[str] = mapped_column(String(24), index=True)
    rationale: Mapped[str] = mapped_column(Text)
    risk_flags: Mapped[list | None] = mapped_column(JSON, default=list)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    policy_mode: Mapped[str] = mapped_column(String(24), default="deterministic")  # llm | deterministic
    model_name: Mapped[str | None] = mapped_column(String(128))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    obligation: Mapped[Obligation] = relationship(back_populates="decision")


# --------------------------------------------------------------- review task
class ReviewTask(Base):
    __tablename__ = "review_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    obligation_id: Mapped[str] = mapped_column(
        ForeignKey("obligations.id", ondelete="CASCADE"), index=True, unique=True
    )
    state: Mapped[str] = mapped_column(String(16), default="open", index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[int] = mapped_column(Integer, default=2, index=True)
    reviewer: Mapped[str | None] = mapped_column(String(128))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)

    obligation: Mapped[Obligation] = relationship(back_populates="review")


# -------------------------------------------------------------- pipeline run
class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    contract_id: Mapped[str] = mapped_column(
        ForeignKey("contracts.id", ondelete="CASCADE"), index=True
    )
    verifier_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    agent_mode: Mapped[str] = mapped_column(String(24), default="deterministic")
    stage_timings: Mapped[dict | None] = mapped_column(JSON, default=dict)
    counts: Mapped[dict | None] = mapped_column(JSON, default=dict)
    total_ms: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(24), default="complete")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)

    contract: Mapped[Contract] = relationship(back_populates="runs")


# ----------------------------------------------------------- ablation result
class AblationResult(Base):
    """Persisted evidence for the verifier-on vs verifier-off study."""

    __tablename__ = "ablation_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    run_label: Mapped[str] = mapped_column(String(128), index=True)
    arm: Mapped[str] = mapped_column(String(32), index=True)  # verifier_on | verifier_off
    dataset: Mapped[str] = mapped_column(String(64))
    n_samples: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# ---------------------------------------------------------------- audit log
class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    entity_type: Mapped[str] = mapped_column(String(48), index=True)
    entity_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    actor: Mapped[str] = mapped_column(String(128), default="system")
    payload: Mapped[dict | None] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
