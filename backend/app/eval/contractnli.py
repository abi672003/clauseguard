"""Turn ContractNLI into the decision problem ClauseGuard actually faces.

ContractNLI labels each (document, hypothesis) pair Entailment / Contradiction /
NotMentioned, and for the first two it marks which spans carry the evidence.

ClauseGuard's question is narrower and harder: given ONE clause and ONE claim,
does that clause support that claim? So we build pairs that mirror it exactly:

  grounded    <- the hypothesis paired with its own gold evidence spans
  ungrounded  <- the same hypothesis paired with a span from the SAME document
                 that carries no evidence for it (a plausible-looking but wrong
                 citation - precisely the hallucination mode we are guarding
                 against), plus every Contradiction and NotMentioned pair

Sampling negatives from the same contract matters. Negatives drawn from other
documents would be trivially separable on topic alone and would flatter the
verifier.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass

from app.core.config import ROOT_DIR

CNLI_DIR = ROOT_DIR / "data" / "raw" / "contract_nli"


@dataclass(frozen=True)
class Pair:
    premise: str
    hypothesis: str
    should_be_grounded: bool
    source: str          # gold_evidence | same_doc_negative | contradiction | not_mentioned
    doc_id: str
    hypothesis_id: str


def _span_text(doc: dict, idx: int) -> str:
    start, end = doc["spans"][idx]
    return doc["text"][start:end].strip()


def build_pairs(
    split: str = "dev", *, seed: int = 17, negatives_per_positive: int = 1,
    min_chars: int = 60, max_chars: int = 1500,
) -> list[Pair]:
    path = CNLI_DIR / f"{split}.json"
    if not path.exists():
        raise SystemExit(f"missing {path}; run scripts/download_data.py first")
    data = json.loads(path.read_text())
    labels = data["labels"]
    rng = random.Random(seed)

    pairs: list[Pair] = []
    for doc in data["documents"]:
        anns = doc["annotation_sets"][0]["annotations"]
        evidence_spans: set[int] = set()
        for a in anns.values():
            evidence_spans.update(a.get("spans", []))

        n_spans = len(doc["spans"])
        non_evidence = [i for i in range(n_spans) if i not in evidence_spans]

        for hyp_id, ann in anns.items():
            hypothesis = labels[hyp_id]["hypothesis"]
            choice = ann["choice"]
            spans = ann.get("spans", [])

            if choice == "Entailment" and spans:
                premise = " ".join(_span_text(doc, i) for i in spans)[:max_chars]
                if len(premise) >= min_chars:
                    pairs.append(Pair(premise, hypothesis, True, "gold_evidence",
                                      doc["id"], hyp_id))
                # the matching hard negative: same doc, same claim, wrong clause
                pool = list(non_evidence)
                rng.shuffle(pool)
                taken = 0
                for i in pool:
                    if taken >= negatives_per_positive:
                        break
                    t = _span_text(doc, i)
                    if min_chars <= len(t) <= max_chars:
                        pairs.append(Pair(t, hypothesis, False, "same_doc_negative",
                                          doc["id"], hyp_id))
                        taken += 1

            elif choice == "Contradiction" and spans:
                premise = " ".join(_span_text(doc, i) for i in spans)[:max_chars]
                if len(premise) >= min_chars:
                    pairs.append(Pair(premise, hypothesis, False, "contradiction",
                                      doc["id"], hyp_id))

            elif choice == "NotMentioned":
                pool = list(range(n_spans))
                rng.shuffle(pool)
                for i in pool:
                    t = _span_text(doc, i)
                    if min_chars <= len(t) <= max_chars:
                        pairs.append(Pair(t, hypothesis, False, "not_mentioned",
                                          doc["id"], hyp_id))
                        break
    return pairs


def summarise(pairs: list[Pair]) -> dict:
    by_source: dict[str, int] = {}
    for p in pairs:
        by_source[p.source] = by_source.get(p.source, 0) + 1
    return {
        "total": len(pairs),
        "grounded_truth": sum(1 for p in pairs if p.should_be_grounded),
        "ungrounded_truth": sum(1 for p in pairs if not p.should_be_grounded),
        "by_source": by_source,
    }
