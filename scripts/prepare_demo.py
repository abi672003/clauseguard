"""Populate a ClauseGuard instance with real, fully-analysed data.

Seeds contracts from the held-out CUAD test split, runs the full pipeline over
each, and records an ablation run so the research screen has real numbers to
show. Safe to re-run: contracts already present are skipped.

Usage: python scripts/prepare_demo.py [--contracts 6] [--ablation-samples 600]
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.db.models import AblationResult, Contract, ContractStatus  # noqa: E402
from app.db.session import SessionLocal, init_db  # noqa: E402
from app.eval import ablation as ablation_mod  # noqa: E402
from app.pipeline.orchestrator import analyze_contract  # noqa: E402
from app.services.seed import seed_contracts  # noqa: E402

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contracts", type=int, default=6)
    ap.add_argument("--ablation-samples", type=int, default=600)
    ap.add_argument("--skip-ablation", action="store_true")
    args = ap.parse_args()

    init_db()
    db = SessionLocal()

    print("ClauseGuard :: preparing a real demo corpus")
    created = seed_contracts(db, limit=args.contracts)
    print(f"seeded {len(created)} contracts from the CUAD test split (held out from fitting)")

    pending = db.query(Contract).filter(
        Contract.status.in_([ContractStatus.pending.value, ContractStatus.failed.value])
    ).all()
    print(f"analysing {len(pending)} contracts\n")

    for i, c in enumerate(pending, 1):
        t0 = time.perf_counter()
        print(f"[{i}/{len(pending)}] {c.title[:58]:60s} {c.char_count:>8,} chars ... ",
              end="", flush=True)
        run = analyze_contract(db, c, verifier_enabled=True, use_agent=False)
        k = run.counts or {}
        print(f"{time.perf_counter() - t0:5.0f}s  "
              f"{k.get('candidates', 0):3d} candidates -> "
              f"{k.get('auto_tracked', 0):3d} tracked / "
              f"{k.get('pending_review', 0):2d} review / "
              f"{k.get('rejected', 0):3d} rejected")

    if not args.skip_ablation:
        print(f"\nrunning the ablation over {args.ablation_samples} ContractNLI test pairs")
        arms, meta = ablation_mod.run_contractnli(
            n_samples=args.ablation_samples,
            on_progress=lambda stage, pct: print(f"\r  {stage}: {pct:.0%}", end="", flush=True),
        )
        print()
        label = f"contractnli-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
        for arm in arms:
            db.add(AblationResult(
                run_label=label, arm=arm.arm, dataset=meta["dataset"],
                n_samples=arm.n_samples, metrics=arm.metrics,
                notes=f"base rate grounded={meta.get('base_rate_grounded')}; "
                      f"verifier={meta.get('verifier_model')}",
            ))
        db.commit()

        d = ablation_mod.delta(arms)
        off = next(a for a in arms if a.arm == "verifier_off").metrics
        on = next(a for a in arms if a.arm == "verifier_on").metrics
        print(f"\n  false-obligation rate : {off['false_obligation_rate']:.1%} (off) "
              f"-> {on['false_obligation_rate']:.1%} (on)   "
              f"delta {d['false_obligation_rate']:+.3f}")
        print(f"  precision             : {off['precision']:.3f} -> {on['precision']:.3f}")
        print(f"  recall                : {off['recall']:.3f} -> {on['recall']:.3f}")

    db.close()
    print("\nDemo corpus ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
