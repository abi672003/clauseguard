"""Contract text -> clause-sized spans, with character offsets preserved.

Offsets matter: the UI highlights the exact source span inside the original
document, and the verifier is handed the clause *verbatim* as its premise. Any
drift here would undermine the grounding claim, so every span carries the
(start, end) it was cut from and round-trips exactly.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config import settings

# A numbered/lettered section heading at the start of a line:
#   "12.3 Termination."   "(a) The Supplier shall..."   "ARTICLE VII - PAYMENT"
_SECTION_RE = re.compile(
    r"^(?:\s{0,8})(?:"
    r"(?:ARTICLE|SECTION|CLAUSE|EXHIBIT|SCHEDULE|APPENDIX)\s+[0-9IVXLC]+"
    r"|\d{1,2}(?:\.\d{1,2}){0,3}\s*[.)]?"
    r"|\([a-zA-Z]{1,3}\)"
    r"|\([ivxlc]{1,5}\)"
    r")\s+",
    re.MULTILINE,
)

# Sentence boundary that tolerates legal abbreviations and enumerations.
_SENT_RE = re.compile(
    r"(?<![A-Z][a-z]\.)(?<!\bNo\.)(?<!\bInc\.)(?<!\bLtd\.)(?<!\bCo\.)(?<!\bCorp\.)"
    r"(?<!\bU\.S\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bet\sal\.)(?<!\bNos\.)"
    r"(?<=[.;:!?])\s+(?=[A-Z(“\"])"
)

_WS_RUN = re.compile(r"[ \t ]{2,}")
_NL_RUN = re.compile(r"\n{2,}")


@dataclass(frozen=True)
class Span:
    text: str
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start


def normalise(text: str) -> str:
    """Light clean-up that does NOT change length-sensitive structure."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("­", "")  # soft hyphen
    return text


def _blocks(text: str) -> list[tuple[int, int]]:
    """Cut the document into paragraph/section blocks as (start, end) offsets."""
    cuts: set[int] = {0, len(text)}
    for m in _NL_RUN.finditer(text):
        cuts.add(m.end())
    for m in _SECTION_RE.finditer(text):
        cuts.add(m.start())
    ordered = sorted(cuts)
    return [(a, b) for a, b in zip(ordered, ordered[1:], strict=False) if b > a]


def _split_long(text: str, start: int, limit: int) -> list[Span]:
    """Split an over-long block on sentence boundaries, keeping offsets true."""
    out: list[Span] = []
    pieces: list[tuple[int, int]] = []
    prev = 0
    for m in _SENT_RE.finditer(text):
        pieces.append((prev, m.start()))
        prev = m.end()
    pieces.append((prev, len(text)))

    buf_start: int | None = None
    buf_end = 0
    for a, b in pieces:
        if buf_start is None:
            buf_start = a
        buf_end = b
        if buf_end - buf_start >= limit:
            out.append(Span(text[buf_start:buf_end], start + buf_start, start + buf_end))
            buf_start = None
    if buf_start is not None and buf_end > buf_start:
        out.append(Span(text[buf_start:buf_end], start + buf_start, start + buf_end))
    return out


def segment(text: str, *, min_chars: int | None = None, max_chars: int | None = None) -> list[Span]:
    """Segment a contract into clause candidates.

    Short fragments are merged forward so headings stay attached to the clause
    they introduce; over-long blocks are split on sentence boundaries.
    """
    text = normalise(text)
    lo = min_chars if min_chars is not None else settings.min_clause_chars
    hi = max_chars if max_chars is not None else settings.max_clause_chars

    raw: list[Span] = []
    for a, b in _blocks(text):
        chunk = text[a:b]
        if not chunk.strip():
            continue
        if len(chunk) > hi:
            raw.extend(_split_long(chunk, a, hi))
        else:
            raw.append(Span(chunk, a, b))

    # Merge runs that are too short to carry meaning (headings, list stubs).
    merged: list[Span] = []
    for sp in raw:
        if merged and len(merged[-1].text.strip()) < lo:
            prev = merged.pop()
            merged.append(Span(text[prev.start : sp.end], prev.start, sp.end))
        else:
            merged.append(sp)

    out: list[Span] = []
    for sp in merged:
        stripped = sp.text.strip()
        if len(stripped) < lo:
            continue
        # Tighten offsets onto the non-whitespace content.
        lead = len(sp.text) - len(sp.text.lstrip())
        trail = len(sp.text) - len(sp.text.rstrip())
        s, e = sp.start + lead, sp.end - trail
        if e - s < lo:
            continue
        out.append(Span(text[s:e], s, e))
    return out


def sentences(text: str) -> list[Span]:
    """Sentence-level spans, used to pick the single most probative evidence
    sentence inside a clause once it has been verified."""
    text = normalise(text)
    out: list[Span] = []
    prev = 0
    for m in _SENT_RE.finditer(text):
        seg = text[prev : m.start()]
        if seg.strip():
            out.append(Span(seg.strip(), prev, m.start()))
        prev = m.end()
    tail = text[prev:]
    if tail.strip():
        out.append(Span(tail.strip(), prev, len(text)))
    return out


def clean_for_model(text: str) -> str:
    """Collapse whitespace for model input. Never used for offsets."""
    return _WS_RUN.sub(" ", text.replace("\n", " ")).strip()
