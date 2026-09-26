"""Fit the verifier's decision threshold on the real ContractNLI dev split.

No model parameters change here. The frozen NLI checkpoint produces
probabilities; this script only chooses where to put the accept line, and then
reports what that line does on the held-out ContractNLI test split.

Two operating points are reported:
  * best-F1        - the balanced default
  * high-precision - the lowest threshold whose precision clears --target-precision.
                     False obligations are the expensive error in this domain
                     (a wrongly-tracked duty becomes a wrong alert, and a wrong
                     alert is what destroys trust in the product), so the
                     deployed default is the high-precision point.

Usage: python scripts/calibrate.py [--limit N] [--target-precision 0.95]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import settings  # noqa: E402
from app.eval.contractnli import build_pairs, summarise  # noqa: E402
from app.ml.registry import registry  # noqa: E402
from app.pipeline.segment import clean_for_model  # noqa: E402

OUT = ROOT / "backend" / "artifacts" / "calibration.json"


def run_nli(pairs, label: str) -> np.ndarray:
    prem = [clean_for_model(p.premise) for p in pairs]
    hyp = [p.hypothesis for p in pairs]
    out = []
    step = 64
    t0 = time.perf_counter()
    for i in range(0, len(prem), step):
        out.append(registry.nli(prem[i : i + step], hyp[i : i + step]))
        done = min(i + step, len(prem))
        el = time.perf_counter() - t0
        rate = done / max(el, 1e-6)
        eta = (len(prem) - done) / max(rate, 1e-6)
        print(f"\r  {label}: {done}/{len(prem)}  ({rate:.1f}/s, eta {eta:.0f}s)",
              end="", flush=True)
    print()
    return np.vstack(out)


def metrics_at(entail: np.ndarray, contra: np.ndarray, neutral: np.ndarray,
               truth: np.ndarray, t_e: float, t_c: float) -> dict:
    """A claim is TRACKED when the verifier calls it grounded."""
    grounded = (entail >= t_e) & ~((contra >= t_c) & (contra > entail))
    tp = int((grounded & truth).sum())
    fp = int((grounded & ~truth).sum())
    fn = int((~grounded & truth).sum())
    tn = int((~grounded & ~truth).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "threshold": round(float(t_e), 4),
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "f1": round(f1, 4),
        # of everything the system would TRACK, how much is not actually supported
        "false_obligation_rate": round(fp / (tp + fp), 4) if tp + fp else 0.0,
        "accuracy": round((tp + tn) / max(len(truth), 1), 4),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cap pairs per split (0 = all)")
    ap.add_argument("--target-precision", type=float, default=0.95)
    ap.add_argument("--contradiction-threshold", type=float,
                    default=settings.contradiction_threshold)
    args = ap.parse_args()

    print("ClauseGuard :: verifier threshold calibration")
    print(f"verifier: {settings.verifier_model} (frozen, device={registry.device})")

    dev = build_pairs("dev")
    test = build_pairs("test")
    if args.limit:
        dev, test = dev[: args.limit], test[: args.limit]
    print(f"dev  {summarise(dev)}")
    print(f"test {summarise(test)}")

    print("\nscoring dev...")
    dp = run_nli(dev, "dev")
    dev_truth = np.array([p.should_be_grounded for p in dev])

    grid = np.round(np.arange(0.05, 0.96, 0.01), 3)
    curve = [metrics_at(dp[:, 1], dp[:, 0], dp[:, 2], dev_truth,
                        t, args.contradiction_threshold) for t in grid]

    best_f1 = max(curve, key=lambda m: m["f1"])
    hi_prec = next((m for m in curve if m["precision"] >= args.target_precision
                    and m["recall"] > 0.05), best_f1)

    print("\n--- dev operating points ---")
    print(f"best-F1        t={best_f1['threshold']:.2f}  P={best_f1['precision']:.3f} "
          f"R={best_f1['recall']:.3f} F1={best_f1['f1']:.3f} "
          f"false-obligation={best_f1['false_obligation_rate']:.3f}")
    print(f"high-precision t={hi_prec['threshold']:.2f}  P={hi_prec['precision']:.3f} "
          f"R={hi_prec['recall']:.3f} F1={hi_prec['f1']:.3f} "
          f"false-obligation={hi_prec['false_obligation_rate']:.3f}")

    chosen = hi_prec["threshold"]

    print("\nscoring held-out test...")
    tp_ = run_nli(test, "test")
    test_truth = np.array([p.should_be_grounded for p in test])
    test_at_chosen = metrics_at(tp_[:, 1], tp_[:, 0], tp_[:, 2], test_truth,
                                chosen, args.contradiction_threshold)
    test_at_bestf1 = metrics_at(tp_[:, 1], tp_[:, 0], tp_[:, 2], test_truth,
                                best_f1["threshold"], args.contradiction_threshold)

    # What happens with NO verifier at all: every extraction is trusted.
    no_verifier = {
        "precision": round(float(test_truth.mean()), 4),
        "recall": 1.0,
        "f1": round(2 * float(test_truth.mean()) / (float(test_truth.mean()) + 1), 4),
        "false_obligation_rate": round(1 - float(test_truth.mean()), 4),
        "tracked": int(len(test_truth)),
    }

    print("\n--- held-out TEST ---")
    print(f"no verifier      : P={no_verifier['precision']:.3f} R=1.000 "
          f"false-obligation={no_verifier['false_obligation_rate']:.3f}")
    print(f"verifier @ {chosen:.2f}  : P={test_at_chosen['precision']:.3f} "
          f"R={test_at_chosen['recall']:.3f} F1={test_at_chosen['f1']:.3f} "
          f"false-obligation={test_at_chosen['false_obligation_rate']:.3f}")

    payload = {
        "verifier_model": settings.verifier_model,
        "base_model": "microsoft/deberta-v3-base",
        "calibrated_on": "ContractNLI dev split (real, CC BY 4.0)",
        "held_out": "ContractNLI test split",
        "entailment_threshold": chosen,
        "contradiction_threshold": args.contradiction_threshold,
        "uncertain_band": settings.uncertain_band,
        "target_precision": args.target_precision,
        "dev": {"n": len(dev), "best_f1": best_f1, "high_precision": hi_prec,
                "summary": summarise(dev)},
        "test": {"n": len(test), "at_chosen": test_at_chosen,
                 "at_best_f1": test_at_bestf1, "no_verifier": no_verifier,
                 "summary": summarise(test)},
        "curve": curve,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
