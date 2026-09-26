"""The verifier is the product's core claim, so its decision rule and its actual
behaviour on contract language are both tested."""
from __future__ import annotations

import pytest

from app.pipeline.verify import decide, verify_one

T_E, T_C, BAND = 0.62, 0.50, 0.12


def test_clear_entailment_is_grounded() -> None:
    verdict, margin = decide(0.95, 0.01, 0.04, T_E, T_C, BAND)
    assert verdict == "grounded"
    assert margin > 0


def test_borderline_entailment_lands_in_the_indecision_band() -> None:
    verdict, _ = decide(0.55, 0.05, 0.40, T_E, T_C, BAND)
    assert verdict == "uncertain"


def test_far_below_threshold_is_ungrounded() -> None:
    verdict, _ = decide(0.10, 0.05, 0.85, T_E, T_C, BAND)
    assert verdict == "ungrounded"


def test_contradiction_overrides_a_passing_entailment() -> None:
    verdict, _ = decide(0.40, 0.55, 0.05, T_E, T_C, BAND)
    assert verdict == "ungrounded"


def test_band_boundaries_are_exact() -> None:
    assert decide(T_E, 0.0, 1 - T_E, T_E, T_C, BAND)[0] == "grounded"
    assert decide(T_E - BAND, 0.0, 0.5, T_E, T_C, BAND)[0] == "uncertain"
    assert decide(T_E - BAND - 1e-6, 0.0, 0.5, T_E, T_C, BAND)[0] == "ungrounded"


@pytest.mark.slow
def test_supported_claim_is_grounded_on_real_contract_language() -> None:
    clause = ("Supplier shall deliver the Products within thirty (30) days of receipt "
              "of a purchase order.")
    result = verify_one(clause, "Supplier must deliver the products within 30 days "
                                "of a purchase order.")
    assert result.verdict == "grounded"
    assert result.entailment > 0.8


@pytest.mark.slow
def test_hallucinated_obligation_is_not_grounded() -> None:
    """The failure mode the whole system exists to catch: a penalty obligation
    invented from a clause that only sets a delivery deadline."""
    clause = ("Supplier shall deliver the Products within thirty (30) days of receipt "
              "of a purchase order.")
    result = verify_one(clause, "Supplier must pay liquidated damages of $50,000 "
                                "for each week of late delivery.")
    assert result.verdict != "grounded"
    assert result.entailment < 0.5


@pytest.mark.slow
def test_wrong_number_in_the_claim_is_caught() -> None:
    """Specific claims are the point: a claim with the wrong period should not
    survive verification as easily as a vague one."""
    clause = "Either party may terminate on ninety (90) days written notice."
    right = verify_one(clause, "A party may terminate on 90 days written notice.")
    wrong = verify_one(clause, "A party may terminate on 5 days written notice.")
    assert right.entailment > wrong.entailment


@pytest.mark.slow
def test_long_clause_is_windowed_not_truncated() -> None:
    filler = "The parties acknowledge the foregoing recitals. " * 60
    clause = filler + ("Distributor shall maintain insurance of not less than "
                       "$5,000,000 throughout the Term.")
    result = verify_one(clause, "Distributor must maintain insurance during the term.")
    assert result.verdict == "grounded"
    assert result.evidence_sentence is not None
    assert "insurance" in result.evidence_sentence.lower()
