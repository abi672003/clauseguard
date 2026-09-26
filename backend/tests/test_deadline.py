"""Deadline mapping turns a clause into a specific, checkable claim."""
from __future__ import annotations

from datetime import date

import pytest

from app.pipeline.deadline import find_durations, find_money, pick_duration, to_obligation
from app.pipeline.taxonomy import CATEGORIES

EFF = date(2024, 3, 1)


def test_picks_the_notice_period_not_the_renewal_term() -> None:
    """The clause names two periods. Only one of them is the notice period."""
    text = ("This Agreement shall automatically renew for successive one (1) year terms "
            "unless either party provides ninety (90) days prior written notice.")
    rec = to_obligation(CATEGORIES["Notice Period To Terminate Renewal"], text,
                        effective_date=EFF)
    assert rec.notice_period_days == 90
    assert "90 days" in rec.claim


def test_renewal_term_is_not_recorded_as_a_notice_period() -> None:
    text = ("Upon expiry of the Initial Term this Agreement shall renew for successive "
            "two (2) year periods unless thirty (30) days notice is given.")
    rec = to_obligation(CATEGORIES["Renewal Term"], text, effective_date=EFF)
    assert rec.notice_period_days is None
    assert "renewal term is 2 years" in rec.claim


def test_duration_word_prefix_does_not_swallow_surrounding_text() -> None:
    found = find_durations("renew for successive one (1) year terms unless ninety (90) days")
    raws = {d.raw for d in found}
    assert "one (1) year" in raws
    assert "ninety (90) days" in raws


def test_explicit_date_beats_a_relative_period() -> None:
    rec = to_obligation(CATEGORIES["Expiration Date"],
                        "This Agreement shall expire on December 31, 2026.",
                        effective_date=EFF)
    assert rec.due_date == date(2026, 12, 31)
    assert "explicit date" in (rec.due_date_basis or "")


def test_recurring_payment_anchors_to_its_period_not_to_a_notice_offset() -> None:
    rec = to_obligation(CATEGORIES["Revenue/Profit Sharing"],
                        "Licensee shall pay a royalty of five percent (5%) of Net Sales, "
                        "payable quarterly within thirty (30) days of each quarter end.",
                        effective_date=EFF)
    assert rec.recurrence == "quarterly"
    assert rec.due_date == date(2024, 5, 31)


def test_documents_are_never_treated_as_the_obligor() -> None:
    rec = to_obligation(CATEGORIES["Termination For Convenience"],
                        "This Agreement shall terminate upon sixty (60) days notice.",
                        effective_date=EFF)
    assert rec.obligor not in {"This Agreement", "Agreement", "The Agreement"}


def test_named_party_is_picked_up_as_obligor() -> None:
    rec = to_obligation(CATEGORIES["Insurance"],
                        "Distributor shall maintain liability insurance of $2,000,000 "
                        "throughout the Term.", effective_date=EFF)
    assert rec.obligor == "Distributor"
    assert rec.monetary_amount == 2_000_000.0
    assert rec.currency == "USD"


@pytest.mark.parametrize("text,amount", [
    ("a fee of $50,000 per month", 50_000.0),
    ("USD 1,250,000 payable on signing", 1_250_000.0),
    ("up to $2.5 million in damages", 2_500_000.0),
])
def test_money_parsing(text: str, amount: float) -> None:
    got = find_money(text)
    assert got is not None and got[0] == amount


def test_pick_duration_falls_back_to_document_order_without_anchors() -> None:
    durations = find_durations("within 10 days and also 90 days")
    chosen = pick_duration(durations, "within 10 days and also 90 days", "other", None)
    assert chosen is not None and chosen.days == 10
