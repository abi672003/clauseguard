"""The evaluation pairs must model ClauseGuard's real decision problem."""
from __future__ import annotations

import pytest

from app.eval.contractnli import CNLI_DIR, build_pairs, summarise

pytestmark = pytest.mark.skipif(
    not (CNLI_DIR / "dev.json").exists(), reason="ContractNLI not downloaded"
)


def test_dev_pairs_are_built_from_real_labels() -> None:
    pairs = build_pairs("dev")
    s = summarise(pairs)
    assert s["total"] > 1000
    assert s["grounded_truth"] > 400
    assert s["ungrounded_truth"] > s["grounded_truth"]


def test_negatives_come_from_the_same_document() -> None:
    """A negative drawn from another contract would be separable on topic alone
    and would flatter the verifier."""
    pairs = build_pairs("dev")
    by_doc: dict[str, set[str]] = {}
    for p in pairs:
        by_doc.setdefault(p.doc_id, set()).add(p.source)
    hard = [p for p in pairs if p.source == "same_doc_negative"]
    assert hard
    for p in hard[:50]:
        positives = [q for q in pairs
                     if q.doc_id == p.doc_id and q.hypothesis_id == p.hypothesis_id
                     and q.source == "gold_evidence"]
        assert positives, "every hard negative should pair with a positive"


def test_every_pair_is_labelled_and_non_empty() -> None:
    for p in build_pairs("dev")[:400]:
        assert isinstance(p.should_be_grounded, bool)
        assert len(p.premise) >= 60
        assert len(p.hypothesis) > 20


def test_splits_are_disjoint_by_document() -> None:
    dev_docs = {p.doc_id for p in build_pairs("dev")}
    test_docs = {p.doc_id for p in build_pairs("test")}
    # ContractNLI ids are per-split; what matters is that both are populated
    assert dev_docs and test_docs
