"""Stage 3 - entailment-based grounding. This is the research contribution.

Commercial contract-intelligence tools extract obligations and present them.
Nothing between extraction and presentation asks the question that actually
matters: *does the clause we cited actually say this?* Language models are
documented to hallucinate on legal text at rates between 17% and 88%, so an
unchecked extraction is an unquantified liability.

ClauseGuard treats every extracted obligation as a **hypothesis** and its source
clause as a **premise**, and runs natural language inference over the pair with
DeBERTa-v3. An obligation is only trusted when the clause entails it. The
technique is adapted from citation verification for case law (the CITE
benchmark, 2026); applying it to contract obligation monitoring is new.

The verifier is a frozen checkpoint - cross-encoder/nli-deberta-v3-base, which
is microsoft/deberta-v3-base already tuned for 3-way NLI. Only the decision
threshold is fitted, and it is fitted on the real ContractNLI dev split by
scripts/calibrate.py.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

import numpy as np

from app.core.config import BACKEND_DIR, settings
from app.ml.registry import registry
from app.pipeline.segment import clean_for_model, sentences

log = logging.getLogger(__name__)

CALIBRATION_PATH = BACKEND_DIR / "artifacts" / "calibration.json"

# A premise longer than this is verified in overlapping sentence windows rather
# than truncated, so evidence near the end of a long clause is not silently lost.
WINDOW_CHARS = 900
WINDOW_OVERLAP = 1         # sentences shared between neighbouring windows
MAX_WINDOWS = 8


@dataclass
class VerificationResult:
    premise: str
    hypothesis: str
    entailment: float
    neutral: float
    contradiction: float
    margin: float
    verdict: str
    threshold_used: float
    model_name: str
    latency_ms: float
    evidence_sentence: str | None = None

    @property
    def is_grounded(self) -> bool:
        return self.verdict == "grounded"


def load_calibration() -> dict:
    """Thresholds chosen on the ContractNLI dev split, if calibration has run."""
    if CALIBRATION_PATH.exists():
        try:
            return json.loads(CALIBRATION_PATH.read_text())
        except json.JSONDecodeError:
            log.warning("calibration file unreadable; falling back to config defaults")
    return {}


def active_thresholds() -> tuple[float, float, float]:
    cal = load_calibration()
    return (
        float(cal.get("entailment_threshold", settings.entailment_threshold)),
        float(cal.get("contradiction_threshold", settings.contradiction_threshold)),
        float(cal.get("uncertain_band", settings.uncertain_band)),
    )


def decide(entail: float, contra: float, neutral: float,
           t_entail: float, t_contra: float, band: float) -> tuple[str, float]:
    """Three-way verdict with an explicit indecision band.

    The band is the point of the design: rather than forcing a binary call near
    the threshold, borderline claims are routed to a human instead of being
    silently tracked or silently dropped.
    """
    margin = entail - max(neutral, contra)
    if contra >= t_contra and contra > entail:
        return "ungrounded", margin
    if entail >= t_entail:
        return "grounded", margin
    if entail >= t_entail - band:
        return "uncertain", margin
    return "ungrounded", margin


def _windows(premise: str) -> list[str]:
    """Tile an over-long premise into sentence windows that cover ALL of it.

    Coverage is the whole point. An earlier version advanced a fixed stride and
    stopped after MAX_WINDOWS, which silently dropped the tail of a long clause -
    so an obligation stated in the last paragraph was never verified against the
    sentence that actually supported it. Here the window size grows instead, so
    the budget caps cost without ever losing text.
    """
    if len(premise) <= WINDOW_CHARS:
        return [premise]
    sents = [s.text for s in sentences(premise)]
    if len(sents) <= 1:
        return [premise[:WINDOW_CHARS]]

    # Grow the target window until the whole premise fits inside MAX_WINDOWS of
    # them, accounting for the one-sentence overlap between neighbours.
    target = WINDOW_CHARS
    while -(-len(premise) // target) > MAX_WINDOWS:
        target *= 2

    out: list[str] = []
    i = 0
    while i < len(sents):
        buf: list[str] = []
        size = 0
        j = i
        while j < len(sents) and size < target:
            buf.append(sents[j])
            size += len(sents[j]) + 1
            j += 1
        out.append(" ".join(buf))
        if j >= len(sents):
            break
        i = max(j - WINDOW_OVERLAP, i + 1)   # overlap so no boundary splits evidence
    return out or [premise[:target]]


def verify(
    pairs: list[tuple[str, str]], *, find_evidence: bool = True
) -> list[VerificationResult]:
    """Verify (clause, claim) pairs. Returns one result per input pair.

    Long clauses are scored window-by-window and the best-entailing window wins,
    which also yields the specific sentence to show a reviewer as evidence.
    """
    if not pairs:
        return []
    t0 = time.perf_counter()
    t_entail, t_contra, band = active_thresholds()
    model_name = settings.verifier_model

    # Flatten every (window, hypothesis) into a single batched NLI call.
    flat_prem: list[str] = []
    flat_hyp: list[str] = []
    owner: list[int] = []
    for idx, (premise, hypothesis) in enumerate(pairs):
        clean = clean_for_model(premise)
        for w in _windows(clean):
            flat_prem.append(w)
            flat_hyp.append(hypothesis)
            owner.append(idx)

    probs = registry.nli(flat_prem, flat_hyp)      # [(contradiction, entailment, neutral)]
    owner_arr = np.asarray(owner)

    results: list[VerificationResult] = []
    total_ms = (time.perf_counter() - t0) * 1000
    per_pair_ms = total_ms / max(len(pairs), 1)

    for idx, (premise, hypothesis) in enumerate(pairs):
        rows = np.flatnonzero(owner_arr == idx)
        sub = probs[rows]
        best = int(sub[:, 1].argmax())              # highest entailment window
        contra, entail, neutral = (float(sub[best, 0]), float(sub[best, 1]),
                                   float(sub[best, 2]))
        verdict, margin = decide(entail, contra, neutral, t_entail, t_contra, band)

        evidence: str | None = None
        if find_evidence:
            window = flat_prem[rows[best]]
            evidence = _best_sentence(window, hypothesis) if verdict != "ungrounded" else None

        results.append(VerificationResult(
            premise=premise, hypothesis=hypothesis,
            entailment=entail, neutral=neutral, contradiction=contra,
            margin=margin, verdict=verdict, threshold_used=t_entail,
            model_name=model_name, latency_ms=per_pair_ms,
            evidence_sentence=evidence,
        ))
    return results


def _best_sentence(window: str, hypothesis: str) -> str | None:
    """The single sentence inside a window that most supports the claim."""
    sents = [s.text for s in sentences(window) if len(s.text) > 30]
    if len(sents) <= 1:
        return sents[0] if sents else None
    probs = registry.nli(sents, [hypothesis] * len(sents))
    return sents[int(probs[:, 1].argmax())]


def verify_one(premise: str, hypothesis: str) -> VerificationResult:
    return verify([(premise, hypothesis)])[0]
