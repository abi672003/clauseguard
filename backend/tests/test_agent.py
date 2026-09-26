"""The agent decides policy; it must never be able to soften the evidence."""
from __future__ import annotations

from datetime import date

from app.pipeline.agent import (
    AUTO_TRACK,
    ESCALATE,
    REJECT,
    AgentOutcome,
    _enforce_guardrail,
    decide,
    deterministic_policy,
)
from app.pipeline.deadline import ObligationRecord
from app.pipeline.verify import VerificationResult


def _rec(**kw) -> ObligationRecord:
    base = {"obligation_type": "deadline", "title": "t", "claim": "c",
            "claim_variants": ["c"], "severity": "low",
            "due_date": date(2030, 1, 1)}
    base.update(kw)
    return ObligationRecord(**base)


def _ver(verdict: str, entail: float, contra: float = 0.02) -> VerificationResult:
    return VerificationResult(
        premise="p", hypothesis="h", entailment=entail, neutral=1 - entail - contra,
        contradiction=contra, margin=entail - max(1 - entail - contra, contra),
        verdict=verdict, threshold_used=0.62, model_name="test", latency_ms=1.0,
    )


def test_grounded_and_low_risk_is_tracked_automatically() -> None:
    out = deterministic_policy(_rec(), _ver("grounded", 0.96))
    assert out.action == AUTO_TRACK
    assert out.risk_flags == []


def test_ungrounded_is_rejected() -> None:
    out = deterministic_policy(_rec(), _ver("ungrounded", 0.04))
    assert out.action == REJECT
    assert "not_entailed" in out.risk_flags


def test_uncertain_goes_to_a_human() -> None:
    out = deterministic_policy(_rec(), _ver("uncertain", 0.55))
    assert out.action == ESCALATE


def test_high_severity_with_moderate_confidence_still_gets_review() -> None:
    out = deterministic_policy(_rec(severity="critical"), _ver("grounded", 0.72))
    assert out.action == ESCALATE
    assert "high_severity_moderate_confidence" in out.risk_flags


def test_material_amounts_always_get_review() -> None:
    out = deterministic_policy(
        _rec(obligation_type="payment", monetary_amount=5_000_000.0), _ver("grounded", 0.99)
    )
    assert out.action == ESCALATE
    assert "material_amount" in out.risk_flags


def test_deadline_without_an_anchorable_date_gets_review() -> None:
    out = deterministic_policy(_rec(due_date=None), _ver("grounded", 0.97))
    assert out.action == ESCALATE
    assert "no_anchorable_date" in out.risk_flags


def test_disabled_verifier_tracks_everything_and_says_so() -> None:
    """The ablation's control arm, and the behaviour of a conventional pipeline."""
    out = decide(_rec(), None, verifier_enabled=False)
    assert out.action == AUTO_TRACK
    assert "unverified" in out.risk_flags


def test_agent_cannot_auto_track_an_ungrounded_claim() -> None:
    rogue = AgentOutcome(action=AUTO_TRACK, rationale="looks fine to me",
                         policy_mode="llm")
    fixed = _enforce_guardrail(rogue, _ver("ungrounded", 0.03))
    assert fixed.action == REJECT
    assert "agent_overruled" in fixed.risk_flags


def test_agent_cannot_auto_track_a_borderline_claim() -> None:
    rogue = AgentOutcome(action=AUTO_TRACK, rationale="close enough", policy_mode="llm")
    fixed = _enforce_guardrail(rogue, _ver("uncertain", 0.55))
    assert fixed.action == ESCALATE
    assert "agent_overruled" in fixed.risk_flags


def test_agent_may_be_more_cautious_than_required() -> None:
    cautious = AgentOutcome(action=ESCALATE, rationale="worth a look", policy_mode="llm")
    assert _enforce_guardrail(cautious, _ver("grounded", 0.99)).action == ESCALATE
