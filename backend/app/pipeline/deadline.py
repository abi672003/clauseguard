"""Stage 2 - deadline mapping: clause -> trackable obligation record.

This turns a classified clause into a concrete, *checkable* assertion. That
specificity is deliberate. A vague claim ("there is a notice period") is almost
impossible to falsify, so a verifier would rubber-stamp it. A specific claim
("a party must give at least 90 days notice") can be wrong - and stage 3 exists
precisely to catch it when it is.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from dateutil import parser as dateparser

from app.pipeline.segment import clean_for_model
from app.pipeline.taxonomy import Category

# ------------------------------------------------------------------ numbers
_WORD_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
    "one hundred eighty": 180, "one hundred twenty": 120, "ninety-": 90,
}
_UNIT_DAYS = {
    "day": 1, "days": 1, "business day": 1, "business days": 1, "calendar day": 1,
    "calendar days": 1, "week": 7, "weeks": 7, "month": 30, "months": 30,
    "quarter": 91, "quarters": 91, "year": 365, "years": 365,
}

# Only real number words may prefix a numeral. Allowing arbitrary words here
# made "renew for successive one (1) year" match from "renew", which dragged the
# relevance anchor onto the wrong period.
_NUMWORD = (
    r"(?:one\s+hundred\s+(?:eighty|twenty|fifty|ten)|"
    r"eighteen|nineteen|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"seventy|eleven|twelve|twenty|thirty|forty|fifty|sixty|eighty|ninety|hundred|"
    r"three|seven|eight|four|five|nine|one|two|six|ten)"
)
# "thirty (30) days", "90 days", "three (3) years", "one hundred eighty (180) days"
_DURATION_RE = re.compile(
    rf"\b(?:(?P<words>{_NUMWORD})[\s\-]*)?"
    r"(?:\(\s*(?P<paren>\d{1,4})\s*\)|(?P<plain>\d{1,4}))\s*"
    r"(?P<unit>business\s+days?|calendar\s+days?|days?|weeks?|months?|quarters?|years?)\b",
    re.IGNORECASE,
)
_WORD_DURATION_RE = re.compile(
    r"\b(?P<words>one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"fifteen|twenty|thirty|forty|fifty|sixty|ninety)\s+"
    r"(?P<unit>business\s+days?|calendar\s+days?|days?|weeks?|months?|quarters?|years?)\b",
    re.IGNORECASE,
)
_RECURRENCE_RE = re.compile(
    r"\b(annual(?:ly)?|each\s+year|per\s+annum|quarterly|each\s+quarter|monthly|"
    r"each\s+month|semi-?annual(?:ly)?|weekly|每)\b",
    re.IGNORECASE,
)
_ABS_DATE_RE = re.compile(
    r"\b(?:(?:January|February|March|April|May|June|July|August|September|October|"
    r"November|December)\s+\d{1,2},?\s+\d{4}"
    r"|\d{1,2}/\d{1,2}/\d{2,4}"
    r"|\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)
_MONEY_RE = re.compile(
    r"(?P<cur>US\$|USD|\$|EUR|€|GBP|£)\s?(?P<amt>\d[\d,]*(?:\.\d{1,2})?)"
    r"(?:\s*(?P<scale>million|billion|thousand))?",
    re.IGNORECASE,
)
_PCT_RE = re.compile(r"(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)", re.IGNORECASE)

# "Supplier shall", "the Company shall not", "Distributor agrees to"
_OBLIGOR_RE = re.compile(
    r"\b(?:the\s+)?(?P<party>[A-Z][A-Za-z]{2,24}(?:\s+[A-Z][A-Za-z]{2,24}){0,2})\s+"
    r"(?:shall|must|will|agrees\s+to|undertakes\s+to|covenants)\b",
)
_ROLE_WORDS = {
    "supplier", "distributor", "licensee", "licensor", "company", "customer",
    "purchaser", "buyer", "seller", "vendor", "contractor", "client", "provider",
    "recipient", "receiving party", "disclosing party", "reseller", "partner",
    "franchisee", "franchisor", "borrower", "lender", "tenant", "landlord",
    "manufacturer", "agent", "consultant", "employee", "employer", "affiliate",
    "parties", "party",
}
_SCALE = {"thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000}
_RECURRENCE_DAYS = {"weekly": 7, "monthly": 30, "quarterly": 91,
                    "semiannual": 182, "annual": 365}

# Categories where the extracted period really IS a notice period. Elsewhere the
# period is a term length, a warranty window or a restraint duration, and putting
# it in notice_period_days would misreport the contract.
_NOTICE_CATEGORIES = {
    "Notice Period To Terminate Renewal",
    "Termination For Convenience",
    "Change Of Control",
    "Audit Rights",
}

# How the extracted period should be described, per category.
_PERIOD_PHRASE: dict[str, str] = {
    "Notice Period To Terminate Renewal": "The required notice period is {}",
    "Termination For Convenience": "The required notice period is {}",
    "Change Of Control": "The required notice period is {}",
    "Audit Rights": "The required notice period is {}",
    "Renewal Term": "The renewal term is {}",
    "Expiration Date": "The term specified is {}",
    "Warranty Duration": "The warranty lasts {}",
    "Non-Compete": "The restriction lasts {}",
    "No-Solicit Of Customers": "The restriction lasts {}",
    "No-Solicit Of Employees": "The restriction lasts {}",
    "Non-Disparagement": "The restriction lasts {}",
    "Insurance": "The coverage must be maintained for {}",
    "Post-Termination Services": "The services continue for {}",
}

# Things that grammatically precede "shall" but are documents, not obligors.
_NOT_A_PARTY = {
    "agreement", "this agreement", "the agreement", "contract", "this contract",
    "term", "the term", "section", "article", "exhibit", "schedule", "appendix",
    "addendum", "amendment", "notice", "this", "that", "it", "which", "there",
    "the", "such", "any", "no", "each", "either", "both", "all", "nothing",
    "neither", "provided", "however", "title", "risk", "payment", "delivery",
    "confidential information", "intellectual property", "software", "products",
    "services", "license", "licence", "royalties", "fees", "taxes", "time",
}

# Keywords that tell us which duration in a clause is the one that matters.
# Category-level anchors win over type-level ones: a "Notice Period To Terminate
# Renewal" clause almost always mentions both the renewal term and the notice
# period, and only the notice period is the trackable number.
_CATEGORY_ANCHORS: dict[str, tuple[str, ...]] = {
    "Notice Period To Terminate Renewal": ("notice",),
    "Renewal Term": ("renew", "successive", "additional term"),
    "Termination For Convenience": ("notice",),
    "Expiration Date": ("expire", "expiration", "term of this"),
    "Warranty Duration": ("warrant",),
    "Non-Compete": ("period of", "following", "after the termination", "after termination"),
    "No-Solicit Of Customers": ("period of", "following", "after termination"),
    "No-Solicit Of Employees": ("period of", "following", "after termination"),
    "Non-Disparagement": ("period of", "following"),
    "Audit Rights": ("notice", "retain", "records"),
    "Insurance": ("maintain", "throughout", "coverage"),
    "Post-Termination Services": ("after termination", "following", "transition"),
    "Minimum Commitment": ("within", "each", "per"),
    "Revenue/Profit Sharing": ("within", "payable", "after the end"),
}

_ANCHOR_WORDS: dict[str, tuple[str, ...]] = {
    "renewal": ("notice", "renew", "non-renewal", "not to renew", "extend"),
    "termination": ("notice", "terminate", "termination", "cure"),
    "deadline": ("expire", "expiration", "term of", "warrant", "within", "no later"),
    "payment": ("within", "payable", "due", "invoice", "payment"),
    "reporting": ("within", "report", "notify", "notice"),
    "insurance": ("maintain", "coverage", "insurance", "throughout"),
    "audit": ("notice", "audit", "inspect", "records"),
    "restriction": ("period of", "for a period", "following", "after"),
    "ip": ("period of", "for a period", "term"),
    "liability": ("within", "period"),
}


@dataclass
class TemporalFact:
    kind: str                  # duration | absolute | recurrence
    raw: str
    days: int | None = None
    on: date | None = None
    recurrence: str | None = None
    pos: int = -1              # char offset in the cleaned clause text


@dataclass
class ObligationRecord:
    obligation_type: str
    title: str
    claim: str
    #: Every phrasing of this category's assertion, specialised with the facts
    #: found in the clause. Disjunctive categories ("audit or inspect") are
    #: split into separate limbs because an NLI model will not entail a
    #: disjunction; the verifier scores each and the best-entailed one wins.
    claim_variants: list[str]
    severity: str
    obligor: str | None = None
    obligee: str | None = None
    due_date: date | None = None
    due_date_basis: str | None = None
    recurrence: str | None = None
    notice_period_days: int | None = None
    monetary_amount: float | None = None
    currency: str | None = None
    facts: dict = field(default_factory=dict)


# ------------------------------------------------------------------ parsing
def _num_from(match: re.Match) -> int | None:
    if match.groupdict().get("paren"):
        return int(match.group("paren"))
    if match.groupdict().get("plain"):
        return int(match.group("plain"))
    words = (match.groupdict().get("words") or "").strip().lower()
    return _WORD_NUM.get(words)


def _unit_days(unit: str) -> int:
    return _UNIT_DAYS.get(unit.strip().lower(), 1)


def find_durations(text: str) -> list[TemporalFact]:
    out: list[TemporalFact] = []
    seen: set[str] = set()
    for m in _DURATION_RE.finditer(text):
        n = _num_from(m)
        if n is None or n <= 0 or n > 3650:
            continue
        raw = m.group(0).strip()
        if raw.lower() in seen:
            continue
        seen.add(raw.lower())
        out.append(TemporalFact("duration", raw, days=n * _unit_days(m.group("unit")),
                                pos=m.start()))
    for m in _WORD_DURATION_RE.finditer(text):
        n = _WORD_NUM.get(m.group("words").lower())
        raw = m.group(0).strip()
        if n is None or raw.lower() in seen:
            continue
        seen.add(raw.lower())
        out.append(TemporalFact("duration", raw, days=n * _unit_days(m.group("unit")),
                                pos=m.start()))
    return out


def find_absolute_dates(text: str) -> list[TemporalFact]:
    out: list[TemporalFact] = []
    for m in _ABS_DATE_RE.finditer(text):
        try:
            d = dateparser.parse(m.group(0), fuzzy=False).date()
        except (ValueError, OverflowError, TypeError):
            continue
        if 1980 <= d.year <= 2100:
            out.append(TemporalFact("absolute", m.group(0), on=d, pos=m.start()))
    return out


def find_recurrence(text: str) -> str | None:
    m = _RECURRENCE_RE.search(text)
    if not m:
        return None
    raw = m.group(1).lower().replace("-", "")
    if raw.startswith("annual") or raw in {"each year", "per annum"}:
        return "annual"
    if raw.startswith("semiannual"):
        return "semiannual"
    if raw.startswith("quarter") or raw == "each quarter":
        return "quarterly"
    if raw.startswith("month") or raw == "each month":
        return "monthly"
    if raw.startswith("week"):
        return "weekly"
    return None


def find_money(text: str) -> tuple[float, str] | None:
    m = _MONEY_RE.search(text)
    if not m:
        return None
    try:
        amt = float(m.group("amt").replace(",", ""))
    except ValueError:
        return None
    if scale := (m.group("scale") or "").lower():
        amt *= _SCALE.get(scale, 1)
    cur_raw = m.group("cur").upper()
    cur = {"$": "USD", "US$": "USD", "USD": "USD", "€": "EUR",
           "EUR": "EUR", "£": "GBP", "GBP": "GBP"}.get(cur_raw, "USD")
    return amt, cur


def find_obligor(text: str) -> str | None:
    for m in _OBLIGOR_RE.finditer(text):
        party = m.group("party").strip()
        low = party.lower()
        if low in _NOT_A_PARTY or any(w in _NOT_A_PARTY for w in (low.split()[-1],)):
            continue
        if low in _ROLE_WORDS or len(party.split()) <= 3:
            return party
    for role in sorted(_ROLE_WORDS, key=len, reverse=True):
        if role in {"party", "parties"}:
            continue  # too generic to name an obligor; keep the neutral template
        if re.search(rf"\b{re.escape(role)}\b", text, re.IGNORECASE):
            return role.title()
    return None


# ------------------------------------------------------------- claim making
def pick_duration(durations: list[TemporalFact], text: str,
                  obligation_type: str,
                  category_name: str | None = None) -> TemporalFact | None:
    """Choose the duration the clause is actually *about*.

    Naively taking the largest period is wrong: a renewal clause that says
    "renews for one (1) year terms unless ninety (90) days notice is given"
    is about the 90 days, not the year. We score each duration by how close it
    sits to a keyword that signals the obligation type, and fall back to
    document order rather than magnitude.
    """
    if not durations:
        return None
    lowered = text.lower()

    def positions(words: tuple[str, ...]) -> list[int]:
        found: list[int] = []
        for word in words:
            start = 0
            while (i := lowered.find(word, start)) != -1:
                found.append(i)
                start = i + 1
        return found

    anchor_positions = positions(_CATEGORY_ANCHORS.get(category_name or "", ()))
    if not anchor_positions:
        anchor_positions = positions(_ANCHOR_WORDS.get(obligation_type, ()))
    if not anchor_positions:
        return durations[0]

    def distance(d: TemporalFact) -> tuple[int, int]:
        if d.pos < 0:
            return (10**6, 0)
        return (min(abs(d.pos - a) for a in anchor_positions), d.pos)

    best = min(durations, key=distance)
    # If nothing is anywhere near an anchor, prefer document order.
    return best if distance(best)[0] <= 120 else durations[0]


def _humanise_days(days: int) -> str:
    """Render a period the way a contract would state it.

    Notice periods are quoted in days right up to six months - a clause that
    says "ninety (90) days" must not be echoed back as "3 months", because the
    verifier compares the claim against that exact wording.
    """
    if days % 365 == 0 and days >= 365:
        n = days // 365
        return f"{n} year" + ("s" if n > 1 else "")
    if days >= 180 and days % 30 == 0:
        n = days // 30
        return f"{n} month" + ("s" if n > 1 else "")
    return f"{days} days"


def build_claims(cat: Category, text: str, obligor: str | None,
                 durations: list[TemporalFact], money: tuple[float, str] | None,
                 recurrence: str | None, abs_dates: list[TemporalFact]) -> list[str]:
    """Specialise every phrasing of the category with the clause's own facts."""
    return [
        _specialise(cat, variant, text, obligor, durations, money, recurrence, abs_dates)
        for variant in cat.claim_variants
    ]


def _specialise(cat: Category, base: str, text: str, obligor: str | None,
                durations: list[TemporalFact], money: tuple[float, str] | None,
                recurrence: str | None, abs_dates: list[TemporalFact]) -> str:
    """Specialise one template with what was actually found in the clause."""
    subject = obligor if obligor else None

    # Substitute the obligor into templates that start with a generic actor.
    if subject:
        base = re.sub(r"^A party\b", subject, base)

    extra: list[str] = []
    primary = pick_duration(durations, text, cat.obligation_type, cat.name)

    if primary and cat.obligation_type in {
        "renewal", "termination", "deadline", "insurance", "audit", "restriction", "ip"
    }:
        phrase = _PERIOD_PHRASE.get(cat.name, "The period specified is {}")
        extra.append(phrase.format(_humanise_days(primary.days)))

    if cat.obligation_type in {"payment", "liability"} and money:
        amt, cur = money
        extra.append(f"The amount involved is {cur} {amt:,.0f}")

    if recurrence and cat.obligation_type in {"payment", "reporting", "audit", "insurance"}:
        extra.append(f"The obligation recurs {recurrence}")

    if cat.obligation_type == "deadline" and abs_dates and not primary:
        extra.append(f"The date specified is {abs_dates[0].on.isoformat()}")

    claim = base.rstrip(".")
    if extra:
        claim = claim + ". " + ". ".join(extra)
    return claim.rstrip(".") + "."


def _severity_bump(cat: Category, days: int | None, money: float | None) -> str:
    order = ["low", "medium", "high", "critical"]
    i = order.index(cat.severity)
    if days is not None and days <= 30:
        i = min(i + 1, 3)
    if money is not None and money >= 1_000_000:
        i = min(i + 1, 3)
    return order[i]


def to_obligation(
    cat: Category, clause_text: str, *, effective_date: date | None = None
) -> ObligationRecord:
    """Map one classified clause onto a trackable obligation record."""
    text = clean_for_model(clause_text)

    durations = find_durations(text)
    abs_dates = find_absolute_dates(text)
    recurrence = find_recurrence(text)
    money = find_money(text)
    obligor = find_obligor(text)

    primary = pick_duration(durations, text, cat.obligation_type, cat.name)
    notice_days = primary.days if (primary and cat.name in _NOTICE_CATEGORIES) else None

    due: date | None = None
    basis: str | None = None
    if abs_dates:
        due = abs_dates[0].on
        basis = f"explicit date in clause: '{abs_dates[0].raw}'"
    elif recurrence and cat.obligation_type in {"payment", "reporting", "audit", "insurance"}:
        # A recurring duty is anchored to its next period boundary, not to a
        # one-off offset from the effective date.
        period = _RECURRENCE_DAYS.get(recurrence)
        if effective_date and period:
            due = effective_date + timedelta(days=period)
            basis = (f"recurs {recurrence}; next period ends "
                     f"{_humanise_days(period)} after the effective date")
        else:
            basis = f"recurs {recurrence}; no effective date on the contract to anchor it"
    elif primary and effective_date:
        due = effective_date + timedelta(days=primary.days)
        basis = f"effective date + {_humanise_days(primary.days)} (from '{primary.raw}')"
    elif primary:
        basis = (f"relative period '{primary.raw}' ({_humanise_days(primary.days)}); "
                 "no effective date on the contract to anchor it")

    variants = build_claims(cat, text, obligor, durations, money, recurrence, abs_dates)
    title = cat.name if not obligor else f"{cat.name} — {obligor}"

    return ObligationRecord(
        obligation_type=cat.obligation_type,
        title=title[:500],
        claim=variants[0],
        claim_variants=variants,
        severity=_severity_bump(cat, primary.days if primary else None,
                                money[0] if money else None),
        obligor=obligor,
        due_date=due,
        due_date_basis=basis,
        recurrence=recurrence,
        notice_period_days=notice_days,
        monetary_amount=money[0] if money else None,
        currency=money[1] if money else None,
        facts={
            "durations": [{"raw": d.raw, "days": d.days} for d in durations[:6]],
            "absolute_dates": [d.on.isoformat() for d in abs_dates[:4] if d.on],
            "percentages": _PCT_RE.findall(text)[:4],
            "recurrence": recurrence,
        },
    )
