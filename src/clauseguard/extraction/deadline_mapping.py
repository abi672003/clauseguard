"""Convert an extracted clause into a trackable obligation record.

Pipeline step 2 (deadline mapping): pulls a concrete date or duration out
of the extracted clause text, when the clause type is one that carries
deadline/renewal/penalty semantics, so it can be tracked and alerted on.
"""

import re
from dataclasses import dataclass, field
from datetime import date

from dateutil import parser as dateparser

# Real CUAD clause types (see extraction/clause_types.json) that carry
# deadline/renewal/penalty semantics worth tracking as obligations.
TRACKABLE_CLAUSE_TYPES = {
    "Agreement Date": "reference_date",
    "Effective Date": "reference_date",
    "Expiration Date": "deadline",
    "Renewal Term": "renewal_condition",
    "Notice Period To Terminate Renewal": "renewal_condition",
    "Termination For Convenience": "termination_condition",
    "Post-Termination Services": "termination_condition",
    "Warranty Duration": "duration_obligation",
    "Liquidated Damages": "penalty_term",
    "Uncapped Liability": "penalty_term",
    "Cap On Liability": "penalty_term",
    "Minimum Commitment": "penalty_term",
}

DURATION_PATTERN = re.compile(
    # Real CUAD contract text commonly spells the number out with a
    # parenthetical numeral, e.g. "ten (10)                years" — allow
    # the closing paren and arbitrary whitespace between the digits and
    # the unit word.
    r"(\d+)[\s)\-]*(day|week|month|year)s?", re.IGNORECASE
)

MONTH_NAMES = (
    "january|february|march|april|may|june|july|august|september|october|november|december|"
    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec"
)
# dateutil's fuzzy=True mode will happily invent a date out of a bare
# number (e.g. treating the "10" in "ten (10) years" as a day-of-month and
# filling in today's month/year) — only attempt it when the text actually
# contains an explicit date signal: a month name, or a numeric D/M/Y date.
EXPLICIT_DATE_SIGNAL = re.compile(
    rf"\b({MONTH_NAMES})\b|\b\d{{1,2}}[/-]\d{{1,2}}[/-]\d{{2,4}}\b|\b\d{{4}}\b",
    re.IGNORECASE,
)


@dataclass
class ObligationRecord:
    contract_id: str
    clause_type: str
    category: str
    source_text: str
    parsed_date: date | None = None
    parsed_duration: tuple[int, str] | None = None
    tracked: bool = True
    escalation_reason: str | None = None
    verification: dict | None = field(default=None)


def _try_parse_date(text: str) -> date | None:
    if not EXPLICIT_DATE_SIGNAL.search(text):
        return None
    try:
        return dateparser.parse(text, fuzzy=True, default=None).date()
    except (ValueError, OverflowError, TypeError):
        return None


def _try_parse_duration(text: str) -> tuple[int, str] | None:
    match = DURATION_PATTERN.search(text)
    if match:
        return int(match.group(1)), match.group(2).lower()
    return None


def map_to_obligation(contract_id: str, extracted_clause: dict) -> ObligationRecord | None:
    """extracted_clause: output of extraction.extractor.extract_clause().
    Returns None if this clause type isn't one we track as an obligation."""
    clause_type = extracted_clause["clause_type"]
    if clause_type not in TRACKABLE_CLAUSE_TYPES:
        return None

    category = TRACKABLE_CLAUSE_TYPES[clause_type]
    text = extracted_clause["text"]

    record = ObligationRecord(
        contract_id=contract_id,
        clause_type=clause_type,
        category=category,
        source_text=text,
    )

    # Real clause text expresses a deadline as either a fixed date or a
    # duration regardless of which CUAD clause type it was tagged under
    # (e.g. an "Effective Date" clause can read "the term shall be ten
    # years" with no fixed date at all) — try both.
    record.parsed_date = _try_parse_date(text)
    record.parsed_duration = _try_parse_duration(text)

    return record
