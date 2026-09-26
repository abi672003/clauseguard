"""Thresholds must stay derived from fitted artefacts, never hand-set.

Both of the bugs these tests guard against actually shipped during development:

  * `prefilter_min_score` was hand-set to 0.20 while the real margin
    distribution spans roughly +/-0.02, so the filter rejected every span of
    every contract and a silent fallback substituted an arbitrary dozen.
  * `entailment_threshold` was hand-set to 0.62 while calibration on
    ContractNLI dev chose 0.14, so the verifier rejected most genuine
    obligations.

Legal-BERT's embedding space is strongly anisotropic and the NLI head is not
calibrated to intuition. Neither number is guessable; both must come from
`scripts/build_prototypes.py` and `scripts/calibrate.py`.
"""
from __future__ import annotations

import json

import pytest

from app.core.config import settings
from app.pipeline.extract import BANK_PATH, META_PATH, extractor
from app.pipeline.verify import CALIBRATION_PATH, active_thresholds

pytestmark = pytest.mark.skipif(
    not BANK_PATH.exists(), reason="prototype bank not built"
)


def test_prototype_bank_matches_its_manifest() -> None:
    meta = json.loads(META_PATH.read_text())
    extractor._ensure()  # noqa: SLF001
    assert extractor._bank is not None  # noqa: SLF001
    assert extractor._bank.shape[0] == meta["n_prototypes"]  # noqa: SLF001
    assert extractor._bank.shape[1] == meta["dim"]  # noqa: SLF001
    assert len(meta["categories"]) == 36
    assert meta["encoder"] == settings.extractor_model


def test_extractor_uses_the_fitted_margin_not_a_guess() -> None:
    meta = json.loads(META_PATH.read_text())
    assert extractor.accept_margin == pytest.approx(meta["accept_margin"])


def test_no_absolute_cosine_floor_by_default() -> None:
    """An absolute similarity gate is meaningless in this embedding space."""
    assert settings.prototype_min_cosine is None


def test_prefilter_floor_tracks_the_fitted_margin() -> None:
    """The pre-filter must sit just below the accept margin, not far above it."""
    assert settings.prefilter_min_score is None, "a hardcoded floor would drift"
    derived = extractor.accept_margin - settings.prefilter_recall_band
    assert derived <= extractor.accept_margin
    assert abs(derived - extractor.accept_margin) <= 0.05


def test_extractor_reports_held_out_performance() -> None:
    meta = json.loads(META_PATH.read_text())
    test = meta["test"]
    # Guard against a silent regression in how the bank is fitted.
    assert test["top1"] > 0.40, test
    assert test["f1"] > 0.80, test


@pytest.mark.skipif(not CALIBRATION_PATH.exists(), reason="not calibrated")
def test_config_default_matches_the_calibrated_threshold() -> None:
    """If these drift apart, /health advertises a threshold the verifier isn't
    using."""
    cal = json.loads(CALIBRATION_PATH.read_text())
    assert settings.entailment_threshold == pytest.approx(cal["entailment_threshold"])


@pytest.mark.skipif(not CALIBRATION_PATH.exists(), reason="not calibrated")
def test_runtime_thresholds_come_from_the_calibration_file() -> None:
    cal = json.loads(CALIBRATION_PATH.read_text())
    t_entail, t_contra, _band = active_thresholds()
    assert t_entail == pytest.approx(cal["entailment_threshold"])
    assert t_contra == pytest.approx(cal["contradiction_threshold"])


@pytest.mark.skipif(not CALIBRATION_PATH.exists(), reason="not calibrated")
def test_verifier_beats_the_no_verifier_control_on_held_out_data() -> None:
    """The novelty claim, asserted as a test."""
    cal = json.loads(CALIBRATION_PATH.read_text())
    on = cal["test"]["at_chosen"]
    off = cal["test"]["no_verifier"]
    assert on["false_obligation_rate"] < off["false_obligation_rate"]
    assert on["precision"] > off["precision"]
    # The effect should be large, not marginal.
    assert off["false_obligation_rate"] - on["false_obligation_rate"] > 0.30


@pytest.mark.slow
def test_extraction_yields_a_sane_candidate_rate_on_a_real_contract() -> None:
    """A real contract should yield a meaningful fraction of candidates - not
    zero (the floor-too-high bug) and not everything (no discrimination)."""
    from app.eval import cuad
    from app.pipeline.segment import segment

    if not cuad.available():
        pytest.skip("CUAD not downloaded")
    contract = cuad.load_contracts("test")[0]
    spans = segment(contract.text)[:120]
    extracted = extractor.extract(spans)
    rate = sum(e.is_candidate for e in extracted) / len(extracted)
    assert 0.05 < rate < 0.90, f"candidate rate {rate:.2%} looks broken"
