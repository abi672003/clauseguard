"""Access to the real CUAD corpus, with the split discipline shared across the app.

The split is a pure function of the contract title, so every component - the
prototype builder, the seeder, the ablation - agrees on which contracts are
train, val and test without passing state around.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache

from dateutil import parser as dateparser

from app.core.config import ROOT_DIR
from app.pipeline.taxonomy import METADATA_CATEGORIES, normalise_cuad_question_id

CUAD_PATH = ROOT_DIR / "data" / "raw" / "cuad" / "CUAD_v1.json"

# Anchor for fuzzy date parsing: any result equal to this means nothing parsed.
_DATE_SENTINEL = dateparser.parse("1900-01-01")

_JURISDICTION_RE = re.compile(
    r"\blaws?\s+of\s+(?:the\s+)?(?:State\s+of\s+|Commonwealth\s+of\s+)?"
    r"(?P<law>[A-Z][A-Za-z.' ]{2,44})",
)
# Adjectival form: "governed by English law", "subject to Delaware law".
def trim_jurisdiction(law: str) -> str | None:
    """Keep only the proper-noun run - a jurisdiction is a name, not a sentence.

    "Delaware notwithstanding the provisions"   -> "Delaware"
    "Florida in the United States of America"   -> "Florida"
    "British Columbia"                          -> "British Columbia"
    "People's Republic of China"                -> "People's Republic of China"
    """
    law = re.split(r"\.\s+", law)[0]          # stop at a sentence break
    words = law.replace(",", " ").split()
    kept: list[str] = []
    for i, w in enumerate(words):
        if w.endswith(".") and len(w) > 2:    # "Texas." ends the jurisdiction
            kept.append(w.rstrip("."))
            break
        if w[:1].isupper():
            kept.append(w)
            continue
        # a lowercase connector survives only between two proper nouns
        if (w.lower() in {"of", "the", "and"} and kept
                and i + 1 < len(words) and words[i + 1][:1].isupper()):
            kept.append(w.lower())
            continue
        break
    while kept and kept[-1].lower() in {"of", "the", "and"}:
        kept.pop()
    out = " ".join(kept).strip(" ,.;:")
    return out[:120] or None


_JURISDICTION_ADJ_RE = re.compile(
    r"\b(?:governed\s+by|subject\s+to|construed\s+in\s+accordance\s+with)\s+"
    r"(?:the\s+)?(?P<law>[A-Z][A-Za-z]{2,24})\s+law\b",
)


def split_of(title: str) -> str:
    """Deterministic contract-level split: 70% train, 15% val, 15% test."""
    h = int(hashlib.sha1(title.encode()).hexdigest()[:8], 16) % 100
    if h < 70:
        return "train"
    return "val" if h < 85 else "test"


@dataclass
class CuadContract:
    title: str
    text: str
    split: str
    gold: dict[str, list[str]] = field(default_factory=dict)

    # ---- gold metadata, straight from the expert annotations --------------
    @property
    def document_name(self) -> str | None:
        v = self.gold.get("Document Name")
        return v[0][:400] if v else None

    @property
    def parties(self) -> tuple[str | None, str | None]:
        v = self.gold.get("Parties") or []
        uniq: list[str] = []
        for p in v:
            p = " ".join(p.split())[:250]
            if p and p not in uniq:
                uniq.append(p)
        return (uniq[0] if uniq else None, uniq[1] if len(uniq) > 1 else None)

    @property
    def effective_date(self) -> date | None:
        for key in ("Effective Date", "Agreement Date"):
            for raw in self.gold.get(key, []):
                # dateutil with fuzzy=True happily returns *today* for a string
                # with no date in it, which silently poisons the corpus. Require
                # an explicit 4-digit year, and anchor the default far away so a
                # bogus parse is detectable.
                if not re.search(r"\b(?:19|20)\d{2}\b", raw):
                    continue
                try:
                    d = dateparser.parse(raw, fuzzy=True,
                                         default=_DATE_SENTINEL).date()
                except (ValueError, OverflowError, TypeError):
                    continue
                if d == _DATE_SENTINEL.date():
                    continue
                if 1980 <= d.year <= 2100:
                    return d
        return None

    @property
    def governing_law(self) -> str | None:
        """Gold answers are whole sentences; pull the jurisdiction out of them."""
        for raw in self.gold.get("Governing Law", []):
            sentence = " ".join(raw.split())
            m = _JURISDICTION_RE.search(sentence) or _JURISDICTION_ADJ_RE.search(sentence)
            if m:
                law = " ".join(m.group("law").split()).strip(" ,.;:")
                law = re.split(r"\b(?:without|excluding|applicable|in\s+all|as\s+to)\b",
                               law, flags=re.IGNORECASE)[0].strip(" ,.;:")
                if trimmed := trim_jurisdiction(law):
                    return trimmed
        # No jurisdiction found. Returning the raw sentence would put a paragraph
        # in a field the UI renders as a chip, so return nothing instead.
        return None

    @property
    def n_gold_obligations(self) -> int:
        return sum(len(v) for k, v in self.gold.items() if k not in METADATA_CATEGORIES)


@lru_cache(maxsize=1)
def _raw() -> list[dict]:
    if not CUAD_PATH.exists():
        raise FileNotFoundError(
            f"{CUAD_PATH} is missing. Run: python scripts/download_data.py"
        )
    return json.loads(CUAD_PATH.read_text())["data"]


def available() -> bool:
    return CUAD_PATH.exists()


def load_contracts(split: str | None = None) -> list[CuadContract]:
    out: list[CuadContract] = []
    for doc in _raw():
        sp = split_of(doc["title"])
        if split and sp != split:
            continue
        para = doc["paragraphs"][0]
        gold: dict[str, list[str]] = {}
        for qa in para["qas"]:
            cat = normalise_cuad_question_id(qa["id"])
            answers = [a["text"] for a in qa.get("answers", []) if a.get("text")]
            if answers:
                gold.setdefault(cat, []).extend(answers)
        out.append(CuadContract(title=doc["title"], text=para["context"],
                                split=sp, gold=gold))
    return out


def corpus_stats() -> dict:
    docs = _raw()
    by_split: dict[str, int] = {}
    for d in docs:
        by_split[split_of(d["title"])] = by_split.get(split_of(d["title"]), 0) + 1
    return {"contracts": len(docs), "by_split": by_split}
