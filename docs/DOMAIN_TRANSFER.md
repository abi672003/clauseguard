# Domain-Transfer Limitation: Verifier on Non-NDA Contracts

ContractNLI's 607 real contracts are specifically NDAs, and its 17
hypotheses are all NDA-specific obligation types ("Receiving Party shall
not reverse engineer...", "Agreement shall not grant Receiving Party any
right to..."). CUAD's 510 contracts span many contract types (license
agreements, distributor agreements, affiliate agreements, etc.), most of
which aren't NDAs.

This means the verifier (`src/clauseguard/verification/verifier.py`), when
applied to obligations extracted from a non-NDA CUAD contract, is running
out-of-domain relative to its training data — a real limitation, not one
hidden by this codebase. In practice this means:

- Verification confidence on genuine NDA clauses (a meaningful subset of
  CUAD, since NDAs are a common contract type) should be trusted closely to
  what the ContractNLI test-set metrics report.
- Verification confidence on structurally different obligation types (e.g.
  a licensing "Minimum Commitment" clause, which has no ContractNLI
  analogue) is a genuine generalization test, not a validated result — the
  ablation in `scripts/run_ablation.py` measures this using ContractNLI's
  own real held-out test set (in-domain), and that in-domain number is the
  one to cite for the project's headline claim. Report any out-of-domain
  spot checks as exploratory, not as validated performance.

No synthetic NDA-style relabeling of CUAD clauses was created to paper over
this gap, per constraint 0.1 — this is a documented scope boundary instead.
