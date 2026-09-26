"""The taxonomy must stay faithful to CUAD's 41 expert categories."""
from __future__ import annotations

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
        assert len(cat.claim_template) > 30
        assert cat.severity in {"low", "medium", "high", "critical"}


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
