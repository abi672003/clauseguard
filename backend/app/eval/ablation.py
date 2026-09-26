"""The verifier-on / verifier-off ablation.

This is the experiment the whole novelty claim rests on, so it is worth being
precise about what it does and does not show.

WHAT IT MEASURES
    Given a set of (clause, obligation-claim) pairs where ground truth says
    whether the clause really supports the claim, how much unsupported material
    ends up tracked:

      verifier_off - every proposed obligation is tracked. This is what a
                     conventional extraction pipeline does, and it is the
                     control arm.
      verifier_on  - an obligation is tracked only when DeBERTa-v3 finds the
                     clause entails the claim at the calibrated threshold.

    The headline number is `false_obligation_rate`: of everything the system
    tracks, what fraction is not actually supported by the clause it cites.

WHAT IT DOES NOT SHOW
    The absolute rate in the control arm is a property of how the evaluation set
    is built (ContractNLI pairs each positive with a hard negative from the same
    document), not a measurement of any vendor's production error rate. The
    meaningful result is the DELTA between arms on identical inputs.

Two evaluation sets are supported:
    contractnli - human entailment labels; clean ground truth, controlled mix
    pipeline    - the real end-to-end pipeline over held-out CUAD contracts,
                  with truth taken from whether the extracted span overlaps a
                  CUAD expert annotation for that category. Noisier, but it
                  measures the shipped system rather than a proxy for it.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from app.core.config import settings
from app.eval import cuad
from app.eval.contractnli import build_pairs
from app.ml.registry import registry
from app.pipeline.segment import clean_for_model, segment
from app.pipeline.taxonomy import CATEGORIES
from app.pipeline.verify import active_thresholds

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, float], None]


@dataclass
class Arm:
    arm: str
    n_samples: int
    metrics: dict[str, float]


def _metrics(tracked: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    tp = int((tracked & truth).sum())
    fp = int((tracked & ~truth).sum())
    fn = int((~tracked & truth).sum())
    tn = int((~tracked & ~truth).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1": round(f1, 4),
        "false_obligation_rate": round(fp / (tp + fp), 4) if tp + fp else 0.0,
        "tracked": int(tracked.sum()),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "accuracy": round((tp + tn) / max(len(truth), 1), 4),
    }


# --------------------------------------------------------------------------
# ContractNLI arm
# --------------------------------------------------------------------------
def run_contractnli(
    n_samples: int = 600, *, split: str = "test", seed: int = 17,
    on_progress: ProgressFn | None = None,
) -> tuple[list[Arm], dict]:
    pairs = build_pairs(split, seed=seed)
    rng = np.random.default_rng(seed)
    if n_samples and n_samples < len(pairs):
        idx = rng.choice(len(pairs), size=n_samples, replace=False)
        pairs = [pairs[int(i)] for i in sorted(idx)]

    truth = np.array([p.should_be_grounded for p in pairs], dtype=bool)
    t_entail, t_contra, _band = active_thresholds()

    prem = [clean_for_model(p.premise) for p in pairs]
    hyp = [p.hypothesis for p in pairs]
    probs = np.zeros((len(pairs), 3), dtype=np.float32)

    step = 64
    for i in range(0, len(prem), step):
        probs[i : i + step] = registry.nli(prem[i : i + step], hyp[i : i + step])
        if on_progress:
            on_progress("verifying", min(i + step, len(prem)) / max(len(prem), 1))

    contra, entail = probs[:, 0], probs[:, 1]
    tracked_on = (entail >= t_entail) & ~((contra >= t_contra) & (contra > entail))
    tracked_off = np.ones(len(pairs), dtype=bool)   # trust every extraction

    arms = [
        Arm("verifier_off", len(pairs), _metrics(tracked_off, truth)),
        Arm("verifier_on", len(pairs), _metrics(tracked_on, truth)),
    ]
    meta = {
        "dataset": f"ContractNLI {split} split (real, CC BY 4.0)",
        "entailment_threshold": t_entail,
        "contradiction_threshold": t_contra,
        "verifier_model": settings.verifier_model,
        "base_rate_grounded": round(float(truth.mean()), 4),
        "mean_entailment_true": round(float(entail[truth].mean()), 4) if truth.any() else 0.0,
        "mean_entailment_false": round(float(entail[~truth].mean()), 4) if (~truth).any() else 0.0,
    }
    return arms, meta


# --------------------------------------------------------------------------
# End-to-end pipeline arm over held-out CUAD contracts
# --------------------------------------------------------------------------
def _gold_spans(doc_gold: dict[str, list[str]], text: str) -> dict[str, list[tuple[int, int]]]:
    out: dict[str, list[tuple[int, int]]] = {}
    for cat, answers in doc_gold.items():
        for a in answers:
            start = text.find(a[:200])
            if start >= 0:
                out.setdefault(cat, []).append((start, start + len(a)))
    return out


def run_pipeline(
    n_contracts: int = 12, *, seed: int = 17, on_progress: ProgressFn | None = None,
) -> tuple[list[Arm], dict]:
    """Run the real extractor over held-out CUAD contracts and judge each
    proposed obligation against the expert annotations."""
    from app.pipeline.deadline import to_obligation
    from app.pipeline.extract import extractor
    from app.pipeline.verify import verify

    contracts = cuad.load_contracts("test")[:n_contracts]
    truths: list[bool] = []
    entailments: list[float] = []
    verdicts: list[str] = []

    for n, c in enumerate(contracts):
        spans = segment(c.text)
        extracted = extractor.extract(spans)
        candidates = [e for e in extracted if e.is_candidate and e.category]
        if not candidates:
            continue

        gold = _gold_spans(c.gold, c.text)
        pairs: list[tuple[str, str]] = []
        for ex in candidates:
            cat = CATEGORIES[ex.category]
            rec = to_obligation(cat, ex.span.text, effective_date=c.effective_date)
            pairs.append((ex.span.text, rec.claim))
            # Truth: does this span overlap an expert annotation for this category?
            overlaps = any(
                not (ex.span.end <= gs or ex.span.start >= ge)
                for gs, ge in gold.get(ex.category, [])
            )
            truths.append(bool(overlaps))

        results = verify(pairs, find_evidence=False)
        entailments.extend(r.entailment for r in results)
        verdicts.extend(r.verdict for r in results)
        if on_progress:
            on_progress(f"contract {n + 1}/{len(contracts)}", (n + 1) / len(contracts))

    truth = np.array(truths, dtype=bool)
    tracked_on = np.array([v == "grounded" for v in verdicts], dtype=bool)
    tracked_off = np.ones(len(truth), dtype=bool)

    arms = [
        Arm("verifier_off", int(len(truth)), _metrics(tracked_off, truth)),
        Arm("verifier_on", int(len(truth)), _metrics(tracked_on, truth)),
    ]
    meta = {
        "dataset": f"CUAD test split, end-to-end pipeline ({len(contracts)} contracts)",
        "verifier_model": settings.verifier_model,
        "extractor_model": settings.extractor_model,
        "base_rate_grounded": round(float(truth.mean()), 4) if len(truth) else 0.0,
        "note": ("Truth is span overlap with a CUAD expert annotation for the same "
                 "category, so it penalises correct obligations found outside an "
                 "annotated span. Treat it as a lower bound on precision."),
    }
    return arms, meta


def delta(arms: list[Arm]) -> dict[str, float]:
    on = next((a for a in arms if a.arm == "verifier_on"), None)
    off = next((a for a in arms if a.arm == "verifier_off"), None)
    if not (on and off):
        return {}
    return {
        k: round(float(on.metrics.get(k, 0)) - float(off.metrics.get(k, 0)), 4)
        for k in ("precision", "recall", "f1", "false_obligation_rate")
    }
