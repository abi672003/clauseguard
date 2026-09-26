"""The segmenter's offsets are load-bearing: the UI highlights the source span
and the verifier is handed the clause verbatim. Drift here is silent corruption."""
from __future__ import annotations

from app.pipeline.segment import clean_for_model, segment, sentences


def test_offsets_round_trip_exactly(cuad_text: str) -> None:
    for span in segment(cuad_text):
        assert cuad_text[span.start : span.end] == span.text


def test_spans_are_ordered_and_non_overlapping(cuad_text: str) -> None:
    spans = segment(cuad_text)
    assert len(spans) > 10
    for a, b in zip(spans, spans[1:], strict=False):
        assert a.start < b.start
        assert a.end <= b.start


def test_respects_minimum_length(cuad_text: str) -> None:
    for span in segment(cuad_text, min_chars=80):
        assert len(span.text.strip()) >= 80


def test_short_document_yields_nothing_rather_than_junk() -> None:
    assert segment("Too short.") == []


def test_sentences_split_without_breaking_on_abbreviations() -> None:
    text = ("Acme Inc. shall deliver the Products. Payment is due in 30 days. "
            "The parties agree.")
    out = [s.text for s in sentences(text)]
    assert len(out) == 3
    assert out[0].startswith("Acme Inc. shall")


def test_clean_for_model_collapses_whitespace_only() -> None:
    assert clean_for_model("a   b\n\nc") == "a b c"
