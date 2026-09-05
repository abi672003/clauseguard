import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clauseguard.extraction.deadline_mapping import map_to_obligation


def test_ignores_unrelated_clause_types():
    assert map_to_obligation("c1", {"clause_type": "Governing Law", "text": "New York"}) is None


def test_does_not_hallucinate_a_date_from_a_bare_number():
    # Regression: dateutil's fuzzy mode used to turn "ten (10)" into a
    # fabricated calendar date using today's month/year as filler.
    record = map_to_obligation(
        "c1", {"clause_type": "Effective Date", "text": "The term shall be ten (10) years"}
    )
    assert record.parsed_date is None
    assert record.parsed_duration == (10, "year")


def test_parses_explicit_date():
    record = map_to_obligation("c1", {"clause_type": "Effective Date", "text": "1 August 2011"})
    assert record.parsed_date is not None
    assert record.parsed_date.year == 2011 and record.parsed_date.month == 8


def test_parses_duration_across_parenthetical_and_whitespace_noise():
    text = "renewed for one (1) or more one (1)     month periods"
    record = map_to_obligation("c1", {"clause_type": "Renewal Term", "text": text})
    assert record.parsed_duration == (1, "month")
