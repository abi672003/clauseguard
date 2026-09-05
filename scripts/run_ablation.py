"""Ablation: false-obligation rate with the verifier enabled vs. disabled.

Uses ContractNLI's own real held-out test set (607-contract corpus, official
split — see docs/DATA_PROVENANCE.md) as a stand-in for "claimed obligation,
cited clause" pairs: each (premise, hypothesis) triple's real label tells
us whether the claim is actually grounded (Entailment) or not
(Contradiction / NotMentioned — i.e. the kind of ungrounded claim an
extraction-only pipeline with no verification step would still auto-track).

verifier-off: every extracted claim is auto-tracked with no check.
verifier-on: a claim is auto-tracked only if the verifier predicts
Entailment above CONFIDENCE_THRESHOLD; otherwise it's escalated to a human
reviewer instead of being trusted.

This ablation is in-domain (ContractNLI test set matches the verifier's
training distribution) — see docs/DOMAIN_TRANSFER.md for why this is the
number to cite, rather than performance on non-NDA CUAD contracts.

Requires models/clauseguard-verifier/ (run
notebooks/finetune_deberta_contractnli.ipynb first).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from clauseguard.db import get_connection  # noqa: E402
from clauseguard.verification.verifier import verify  # noqa: E402

CONFIDENCE_THRESHOLD = 0.5


def main():
    conn = get_connection()
    rows = conn.execute(
        "SELECT premise, hypothesis_text, label FROM nli_triples "
        "WHERE source='contractnli' AND split='test'"
    ).fetchall()
    conn.close()

    print(f"Evaluating {len(rows)} real ContractNLI test triples")

    n = len(rows)
    verifier_off_false = sum(1 for _, _, label in rows if label != "Entailment")

    tracked, tracked_false, escalated = 0, 0, 0
    for i, (premise, hypothesis, true_label) in enumerate(rows):
        result = verify(premise, hypothesis)
        if result["label"] == "Entailment" and result["confidence"] >= CONFIDENCE_THRESHOLD:
            tracked += 1
            if true_label != "Entailment":
                tracked_false += 1
        else:
            escalated += 1

        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{n}")

    verifier_off_rate = verifier_off_false / n
    verifier_on_rate = (tracked_false / tracked) if tracked else float("nan")

    print("\n=== Ablation: false-obligation rate ===")
    print(f"n = {n} real (premise, hypothesis, label) test triples")
    print(f"verifier OFF (auto-track everything):  false-obligation rate = {verifier_off_rate:.3f} "
          f"({verifier_off_false}/{n})")
    print(f"verifier ON  (track only if Entailment >= {CONFIDENCE_THRESHOLD}): "
          f"false-obligation rate = {verifier_on_rate:.3f} ({tracked_false}/{tracked}), "
          f"{escalated}/{n} escalated to human review instead of auto-tracked")


if __name__ == "__main__":
    main()
