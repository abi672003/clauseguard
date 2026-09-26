"""Stage 4 - the agentic decision loop.

Division of authority, which is the important design decision here:

  * The **verifier** is the authority on grounding. Does this clause entail this
    claim? That is an evidence question and it is settled by the NLI model.
  * The **agent** is the authority on policy. Given the evidence, what should
    happen - track it silently, put it in front of a human, or drop it?

The agent is therefore allowed to be *more* cautious than the evidence warrants,
never less. An LLM that tries to auto-track something the verifier called
ungrounded is overruled and the attempt is recorded. Without that guardrail the
LLM becomes a second hallucination surface layered on top of the first, which
would defeat the entire point of the system.

Runs on Claude Haiku 4.5 when an API key is present, and on a deterministic
policy engine when it is not. The deterministic path is not a degraded mode: it
is fully functional, reproducible, free, and it is what the ablation runs on so
that the measured effect is attributable to the verifier and not to LLM variance.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field

from app.core.config import settings
from app.pipeline.deadline import ObligationRecord
from app.pipeline.verify import VerificationResult

log = logging.getLogger(__name__)

AUTO_TRACK = "auto_track"
ESCALATE = "escalate"
REJECT = "reject"

# Above this entailment a grounded, low-stakes obligation needs no human.
CONFIDENT_ENTAILMENT = 0.90
# Money at or above this always gets human eyes regardless of confidence.
MATERIAL_AMOUNT = 1_000_000.0


@dataclass
class AgentOutcome:
    action: str
    rationale: str
    risk_flags: list[str] = field(default_factory=list)
    confidence: float = 0.0
    policy_mode: str = "deterministic"
    model_name: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0


# --------------------------------------------------------------------------
# Deterministic policy
# --------------------------------------------------------------------------
def deterministic_policy(
    rec: ObligationRecord, ver: VerificationResult | None, *, verifier_enabled: bool = True
) -> AgentOutcome:
    flags: list[str] = []

    if not verifier_enabled or ver is None:
        # The ablation's control arm: extraction is trusted with no grounding check.
        return AgentOutcome(
            action=AUTO_TRACK,
            rationale=("Verification disabled. The obligation was tracked on the strength of "
                       "the extractor alone, with no check that the cited clause supports it."),
            risk_flags=["unverified"],
            confidence=float(rec.severity == "low"),
            policy_mode="deterministic",
        )

    if ver.verdict == "ungrounded":
        return AgentOutcome(
            action=REJECT,
            rationale=(
                f"The cited clause does not support this obligation. Entailment "
                f"{ver.entailment:.2f} against a threshold of {ver.threshold_used:.2f}"
                + (f", and contradiction is {ver.contradiction:.2f}."
                   if ver.contradiction > ver.entailment else ".")
                + " Tracking it would create a duty the contract does not impose."
            ),
            risk_flags=["not_entailed"] + (
                ["contradicted"] if ver.contradiction >= settings.contradiction_threshold else []
            ),
            confidence=round(1.0 - ver.entailment, 3),
            policy_mode="deterministic",
        )

    if ver.verdict == "uncertain":
        return AgentOutcome(
            action=ESCALATE,
            rationale=(
                f"Entailment {ver.entailment:.2f} falls inside the indecision band below the "
                f"{ver.threshold_used:.2f} accept threshold. The clause may support this "
                "obligation, but not clearly enough to track without review."
            ),
            risk_flags=["borderline_entailment"],
            confidence=round(ver.entailment, 3),
            policy_mode="deterministic",
        )

    # --- grounded: decide whether policy still wants a human ---------------
    if rec.severity in {"critical", "high"} and ver.entailment < CONFIDENT_ENTAILMENT:
        flags.append("high_severity_moderate_confidence")
    if rec.monetary_amount and rec.monetary_amount >= MATERIAL_AMOUNT:
        flags.append("material_amount")
    if rec.obligation_type in {"deadline", "renewal"} and rec.due_date is None:
        flags.append("no_anchorable_date")
    if rec.obligation_type == "renewal" and rec.notice_period_days is None:
        flags.append("renewal_without_notice_period")

    if flags:
        return AgentOutcome(
            action=ESCALATE,
            rationale=(
                f"The clause entails the obligation (entailment {ver.entailment:.2f}), so the "
                "extraction is grounded, but policy still requires review: "
                + ", ".join(f.replace("_", " ") for f in flags) + "."
            ),
            risk_flags=flags,
            confidence=round(ver.entailment, 3),
            policy_mode="deterministic",
        )

    return AgentOutcome(
        action=AUTO_TRACK,
        rationale=(
            f"The clause entails the obligation with entailment {ver.entailment:.2f} "
            f"(threshold {ver.threshold_used:.2f}, margin {ver.margin:.2f}) and no policy "
            "risk flags apply. Tracked automatically."
        ),
        risk_flags=[],
        confidence=round(ver.entailment, 3),
        policy_mode="deterministic",
    )


# --------------------------------------------------------------------------
# LLM policy (Claude Haiku 4.5)
# --------------------------------------------------------------------------
SYSTEM_PROMPT = """You are the decision layer of ClauseGuard, a contract obligation monitor.

An upstream extractor proposed an obligation from a contract clause. An entailment
model (DeBERTa-v3 fine-tuned for NLI) has already judged whether the clause actually
supports that claim; its probabilities are given to you and they are authoritative on
the question of grounding. You do NOT re-litigate the entailment evidence.

Your job is the policy question: given this evidence, what should happen?

  auto_track - the claim is well grounded and low-risk enough to track with no human
  escalate   - a human reviewer should look at this before it is trusted
  reject     - the clause does not support the claim; it must not be tracked

Rules you must follow:
  1. If the verdict is "ungrounded" you must answer reject.
  2. If the verdict is "uncertain" you must answer escalate.
  3. If the verdict is "grounded" you may answer auto_track or escalate. Prefer
     escalate when the obligation is high value, carries a hard deadline that could
     not be anchored to a date, or would trigger an irreversible consequence.
  4. Never answer auto_track for anything not verdict "grounded".

Reply with ONLY a JSON object:
{"action": "...", "rationale": "<= 60 words, concrete, cites the numbers",
 "risk_flags": ["snake_case", ...], "confidence": 0.0-1.0}"""


def _build_user_prompt(rec: ObligationRecord, ver: VerificationResult,
                       contract_title: str | None) -> str:
    return f"""CONTRACT: {contract_title or "(untitled)"}

SOURCE CLAUSE (the premise, verbatim):
\"\"\"{ver.premise[:1800]}\"\"\"

PROPOSED OBLIGATION (the hypothesis):
\"\"\"{rec.claim}\"\"\"

OBLIGATION RECORD:
  type            : {rec.obligation_type}
  severity        : {rec.severity}
  obligor         : {rec.obligor or "not identified"}
  due date        : {rec.due_date or "none"} ({rec.due_date_basis or "no basis"})
  notice period   : {rec.notice_period_days or "none"} days
  recurrence      : {rec.recurrence or "none"}
  amount          : {f"{rec.currency} {rec.monetary_amount:,.0f}" if rec.monetary_amount else "none"}

VERIFIER OUTPUT (authoritative on grounding):
  verdict         : {ver.verdict}
  entailment      : {ver.entailment:.4f}
  neutral         : {ver.neutral:.4f}
  contradiction   : {ver.contradiction:.4f}
  margin          : {ver.margin:.4f}
  threshold       : {ver.threshold_used:.2f}
  best evidence   : {ver.evidence_sentence or "n/a"}

Decide."""


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_llm(text: str) -> dict | None:
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def llm_policy(rec: ObligationRecord, ver: VerificationResult,
               contract_title: str | None = None) -> AgentOutcome | None:
    """Ask Claude Haiku. Returns None if the call is unavailable or unusable."""
    if not settings.has_llm:
        return None
    try:
        import anthropic
    except ImportError:
        return None

    t0 = time.perf_counter()
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key,
                                     timeout=settings.agent_timeout_s)
        resp = client.messages.create(
            model=settings.agent_model,
            max_tokens=settings.agent_max_tokens,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user",
                       "content": _build_user_prompt(rec, ver, contract_title)}],
        )
    except Exception as exc:  # network, auth, rate limit, overload
        log.warning("agent LLM call failed (%s); using deterministic policy", exc)
        return None

    latency = (time.perf_counter() - t0) * 1000
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    parsed = _parse_llm(text)
    if not parsed or parsed.get("action") not in {AUTO_TRACK, ESCALATE, REJECT}:
        log.warning("agent LLM returned unusable output; using deterministic policy")
        return None

    flags = parsed.get("risk_flags") or []
    if not isinstance(flags, list):
        flags = [str(flags)]

    return AgentOutcome(
        action=str(parsed["action"]),
        rationale=str(parsed.get("rationale", ""))[:1200],
        risk_flags=[str(f) for f in flags][:8],
        confidence=float(parsed.get("confidence") or 0.0),
        policy_mode="llm",
        model_name=settings.agent_model,
        input_tokens=getattr(resp.usage, "input_tokens", 0),
        output_tokens=getattr(resp.usage, "output_tokens", 0),
        latency_ms=latency,
    )


# --------------------------------------------------------------------------
# Guardrail + entry point
# --------------------------------------------------------------------------
def _enforce_guardrail(outcome: AgentOutcome, ver: VerificationResult) -> AgentOutcome:
    """The agent may be more cautious than the evidence, never less."""
    if ver.verdict == "ungrounded" and outcome.action == AUTO_TRACK:
        outcome.action = REJECT
        outcome.risk_flags = list(dict.fromkeys(outcome.risk_flags + ["agent_overruled"]))
        outcome.rationale = (
            "Agent proposed auto-tracking a claim the verifier found ungrounded; overruled. "
            + outcome.rationale
        )
    elif ver.verdict == "uncertain" and outcome.action == AUTO_TRACK:
        outcome.action = ESCALATE
        outcome.risk_flags = list(dict.fromkeys(outcome.risk_flags + ["agent_overruled"]))
        outcome.rationale = (
            "Agent proposed auto-tracking a borderline claim; downgraded to review. "
            + outcome.rationale
        )
    return outcome


def decide(
    rec: ObligationRecord,
    ver: VerificationResult | None,
    *,
    contract_title: str | None = None,
    verifier_enabled: bool = True,
    use_llm: bool | None = None,
) -> AgentOutcome:
    """Decide what to do with one proposed obligation."""
    if ver is None or not verifier_enabled:
        return deterministic_policy(rec, ver, verifier_enabled=False)

    want_llm = settings.has_llm if use_llm is None else (use_llm and settings.has_llm)
    if want_llm:
        outcome = llm_policy(rec, ver, contract_title)
        if outcome is not None:
            return _enforce_guardrail(outcome, ver)

    return deterministic_policy(rec, ver, verifier_enabled=True)
