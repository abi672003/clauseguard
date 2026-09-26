"""The taxonomy must stay faithful to CUAD's 41 expert categories."""
from __future__ import annotations

import re

from app.pipeline.taxonomy import (
    ALL_CUAD_CATEGORIES,
    CATEGORIES,
    METADATA_CATEGORIES,
    OBLIGATION_TYPES,
    normalise_cuad_question_id,
)


def test_covers_all_41_cuad_categories() -> None:
    assert len(CATEGORIES) + len(METADATA_CATEGORIES) == 41
    assert len(set(ALL_CUAD_CATEGORIES)) == 41


def test_every_category_maps_to_a_known_obligation_type() -> None:
    for cat in CATEGORIES.values():
        assert cat.obligation_type in OBLIGATION_TYPES


def test_every_category_has_a_usable_claim_template() -> None:
    for cat in CATEGORIES.values():
        assert cat.claim_template.endswith(".")
        assert len(cat.claim_template) > 20
        assert cat.severity in {"low", "medium", "high", "critical"}


def test_no_claim_template_contains_a_disjunction() -> None:
    """An NLI model will not entail "A or B" from a clause stating only A.

    Measured: "A party may audit or inspect the other party's records" scores
    0.013 against a clause granting audit rights, where "A party may audit the
    other party's records" scores 0.989. Disjunctive categories must therefore
    put each limb in `alternatives`, which the verifier scores separately.
    """
    offenders = [
        c.name for c in CATEGORIES.values()
        for variant in c.claim_variants
        if re.search(r"\b(?:or|and/or)\b", variant)
    ]
    assert not offenders, f"disjunctive claim templates: {offenders}"


def test_no_claim_template_carries_unsupported_filler() -> None:
    """"under this agreement" measurably depresses entailment and asserts
    nothing the category does not already imply."""
    offenders = [
        c.name for c in CATEGORIES.values()
        for variant in c.claim_variants
        if "under this agreement" in variant
        and c.name != "Third Party Beneficiary"  # here it is the actual claim
    ]
    assert not offenders, f"templates with filler: {offenders}"


def test_claim_variants_are_distinct_within_a_category() -> None:
    for cat in CATEGORIES.values():
        variants = cat.claim_variants
        assert len(set(variants)) == len(variants), cat.name


def test_claim_templates_are_distinct() -> None:
    """Two categories sharing a template would make their claims unfalsifiable
    against each other."""
    templates = [c.claim_template for c in CATEGORIES.values()]
    assert len(set(templates)) == len(templates)


def test_question_id_parsing() -> None:
    qid = "LIMEENERGYCO_09_09_1999-EX-10-DISTRIBUTOR AGREEMENT__Notice Period To Terminate Renewal"
    assert normalise_cuad_question_id(qid) == "Notice Period To Terminate Renewal"


def test_categories_match_the_real_cuad_file() -> None:
    from app.eval import cuad

    if not cuad.available():
        return
    found: set[str] = set()
    for c in cuad.load_contracts("test")[:5]:
        found.update(c.gold)
    assert found <= set(ALL_CUAD_CATEGORIES), found - set(ALL_CUAD_CATEGORIES)
