"""Pydantic DTOs - the wire contract between FastAPI and the React client.
The frontend's TypeScript types mirror this file exactly."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ORM = ConfigDict(from_attributes=True)

Verdict = Literal["grounded", "ungrounded", "uncertain"]
AgentAction = Literal["auto_track", "escalate", "reject"]
ObligationStatus = Literal[
    "auto_tracked", "pending_review", "approved", "rejected", "expired"
]


# ------------------------------------------------------------------- clause
class ClauseOut(BaseModel):
    model_config = ORM
    id: str
    index: int
    text: str
    char_start: int
    char_end: int
    category: str | None = None
    category_score: float = 0.0
    runner_up: str | None = None
    runner_up_score: float = 0.0
    prefilter_score: float = 0.0
    is_candidate: bool = False


# ------------------------------------------------------------- verification
class VerificationOut(BaseModel):
    model_config = ORM
    id: str
    premise: str
    hypothesis: str
    entailment: float
    neutral: float
    contradiction: float
    margin: float
    verdict: Verdict
    threshold_used: float
    model_name: str
    latency_ms: float
    evidence_sentence: str | None = None
    created_at: datetime


# ------------------------------------------------------------------- agent
class AgentDecisionOut(BaseModel):
    model_config = ORM
    id: str
    action: AgentAction
    rationale: str
    risk_flags: list[str] = Field(default_factory=list)
    confidence: float
    policy_mode: Literal["llm", "deterministic"]
    model_name: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


# -------------------------------------------------------------- obligation
class ObligationOut(BaseModel):
    model_config = ORM
    id: str
    contract_id: str
    clause_id: str
    obligation_type: str
    title: str
    claim: str
    obligor: str | None = None
    obligee: str | None = None
    due_date: date | None = None
    due_date_basis: str | None = None
    recurrence: str | None = None
    notice_period_days: int | None = None
    monetary_amount: float | None = None
    currency: str | None = None
    severity: Literal["low", "medium", "high", "critical"]
    extraction_confidence: float
    status: ObligationStatus
    created_at: datetime


class ObligationDetail(ObligationOut):
    """Everything a reviewer needs to adjudicate: the claim, the clause it was
    drawn from, the entailment evidence, and the agent's reasoning."""
    clause: ClauseOut | None = None
    verification: VerificationOut | None = None
    decision: AgentDecisionOut | None = None
    contract_title: str | None = None


# --------------------------------------------------------------- contract
class ContractSummary(BaseModel):
    model_config = ORM
    id: str
    title: str
    filename: str | None = None
    source: str
    contract_type: str | None = None
    party_a: str | None = None
    party_b: str | None = None
    effective_date: date | None = None
    governing_law: str | None = None
    char_count: int
    status: str
    created_at: datetime
    processed_at: datetime | None = None
    obligation_count: int = 0
    tracked_count: int = 0
    review_count: int = 0
    rejected_count: int = 0


class ContractDetail(ContractSummary):
    raw_text: str
    clauses: list[ClauseOut] = Field(default_factory=list)
    obligations: list[ObligationDetail] = Field(default_factory=list)
    latest_run: PipelineRunOut | None = None


# ------------------------------------------------------------ pipeline run
class StageTiming(BaseModel):
    stage: str
    ms: float
    detail: dict[str, Any] = Field(default_factory=dict)


class PipelineRunOut(BaseModel):
    model_config = ORM
    id: str
    contract_id: str
    verifier_enabled: bool
    agent_mode: str
    stage_timings: dict[str, Any] = Field(default_factory=dict)
    counts: dict[str, Any] = Field(default_factory=dict)
    total_ms: float
    status: str
    error: str | None = None
    created_at: datetime


# ------------------------------------------------------------------ review
class ReviewTaskOut(BaseModel):
    model_config = ORM
    id: str
    obligation_id: str
    state: Literal["open", "approved", "rejected"]
    reason: str
    priority: int
    reviewer: str | None = None
    notes: str | None = None
    created_at: datetime
    resolved_at: datetime | None = None
    obligation: ObligationDetail | None = None


class ReviewResolve(BaseModel):
    decision: Literal["approve", "reject"]
    reviewer: str = "analyst"
    notes: str | None = None


# --------------------------------------------------------------- requests
class AnalyzeRequest(BaseModel):
    verifier_enabled: bool | None = None
    use_agent: bool | None = None
    max_clauses: int | None = Field(default=None, ge=1, le=2000)


class TextIngestRequest(BaseModel):
    title: str = Field(min_length=1, max_length=400)
    text: str = Field(min_length=200)
    contract_type: str | None = None
    analyze: bool = True
    verifier_enabled: bool | None = None


class SeedRequest(BaseModel):
    limit: int = Field(default=8, ge=1, le=60)
    analyze: bool = True


# -------------------------------------------------------------- analytics
class DashboardStats(BaseModel):
    contracts: int
    contracts_processed: int
    clauses: int
    candidate_clauses: int
    obligations: int
    auto_tracked: int
    pending_review: int
    approved: int
    rejected: int
    grounded: int
    ungrounded: int
    uncertain: int
    hallucination_rate_blocked: float
    mean_entailment: float
    upcoming_30d: int
    overdue: int
    by_type: dict[str, int]
    by_severity: dict[str, int]
    by_month: list[dict[str, Any]]
    verdict_scatter: list[dict[str, Any]]


class AblationArm(BaseModel):
    arm: Literal["verifier_on", "verifier_off"]
    n_samples: int
    metrics: dict[str, float]


class AblationReport(BaseModel):
    model_config = ORM
    run_label: str
    dataset: str
    created_at: datetime
    arms: list[AblationArm]
    delta: dict[str, float]
    notes: str | None = None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    env: str
    models_loaded: dict[str, bool]
    llm_agent: bool
    verifier_enabled: bool
    entailment_threshold: float
    device: str
    db_contracts: int


# ------------------------------------------------------ websocket progress
class ProgressEvent(BaseModel):
    contract_id: str
    stage: Literal[
        "queued", "ingest", "segment", "prefilter", "extract",
        "deadline", "verify", "agent", "persist", "complete", "failed",
    ]
    message: str
    pct: float = 0.0
    payload: dict[str, Any] = Field(default_factory=dict)


ContractDetail.model_rebuild()
