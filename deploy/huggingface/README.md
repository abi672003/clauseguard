---
title: ClauseGuard
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Contract obligations, verified against their source clause
---

# ClauseGuard

Contract obligation monitoring that verifies every extraction against the clause
it came from, using entailment, before tracking it.

- **Extraction** — `nlpaueb/legal-bert-base-uncased`, frozen, with a
  nearest-prototype bank built from the real CUAD gold spans.
- **Verification** — `cross-encoder/nli-deberta-v3-base` (that is
  `microsoft/deberta-v3-base` tuned for NLI), threshold calibrated on the real
  ContractNLI dev split.
- **Agent** — Claude Haiku 4.5 when `CLAUSEGUARD_ANTHROPIC_API_KEY` is set as a
  Space secret; otherwise a deterministic policy engine, which is fully
  functional.

No model is fine-tuned. Both datasets (CUAD, ContractNLI) are CC BY 4.0.

Source: https://github.com/abi672003/clauseguard

**First load takes ~60s** while the two transformer checkpoints warm up.
Start from **Contracts → Load real CUAD contracts**.
