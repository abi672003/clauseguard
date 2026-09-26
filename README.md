# ClauseGuard

**Contract obligation monitoring that refuses to trust itself.**

ClauseGuard extracts obligations from commercial contracts — deadlines, notice
periods, renewal triggers, payment and insurance duties — and then does the thing
no other extraction product does: it checks each obligation against the exact
clause it came from, with an entailment model, *before* the obligation is ever
tracked or alerted on.

Large language models are documented to hallucinate on legal text between **17%
and 88%** of the time. An extraction pipeline with no grounding check converts
that error rate directly into false obligations, and a false obligation becomes a
false alert, and false alerts are what destroy a compliance team's trust in a
tool. ClauseGuard treats every extraction as a claim to be proven rather than a
fact to be displayed.

---

## The pipeline

```
 document
    │
    ├─ 1. segment      clause-sized spans, character offsets preserved exactly
    ├─ 2. prefilter    Legal-BERT embeddings in ChromaDB; boilerplate is dropped
    ├─ 3. extract      nearest-prototype classification into 36 CUAD categories
    ├─ 4. deadline map clause → trackable record with a SPECIFIC, checkable claim
    ├─ 5. verify  ◀──  DeBERTa-v3 NLI: does this clause actually entail this claim?
    └─ 6. agent        auto-track / escalate to a human / reject
```

Stage 5 is the contribution. Stages 1–4 are well-served by commercial products
and no novelty is claimed for them.

### Why stage 4 makes stage 5 meaningful

A vague claim ("there is a notice period") is nearly impossible to falsify, so a
verifier would rubber-stamp it. ClauseGuard specialises each claim with what it
actually found — *"The required notice period is 90 days"* — which makes the
claim falsifiable, and gives stage 5 something real to catch.

**Claims must also be minimal.** This was learned the hard way and it shapes the
whole taxonomy. Against a clause reading *"Either party may terminate this
Agreement for convenience upon sixty (60) days prior written notice"*:

| hypothesis | entailment |
|---|---|
| "A party may terminate this agreement for convenience." | **0.998** |
| "A party may terminate this agreement for convenience, **without cause**." | **0.011** |

The clause never says "without cause", so the verifier refuses the claim — and
it is *right to*. The same happens with disjunctions: "may audit **or inspect**
the records" scores 0.013 where "may audit the records" scores 0.989, because
an NLI model will not entail "A or B" from a clause stating only A.

So every claim template is a single, minimal, unqualified assertion, and
genuinely disjunctive categories (*right of first refusal / offer /
negotiation*) list each limb separately. The verifier scores every limb and the
best-entailed one wins, which is what the disjunction actually means — and it
records *which* limb fired, which is more useful to a reviewer anyway. Two tests
(`test_no_claim_template_contains_a_disjunction`,
`test_no_claim_template_carries_unsupported_filler`) hold this invariant.

### Division of authority

The **verifier** is the authority on evidence: does the clause entail the claim?
The **agent** is the authority on policy: given that evidence, what should happen?
The agent may be more cautious than the evidence warrants but never less — an LLM
that tries to auto-track an ungrounded claim is overruled and the override is
recorded. Without that guardrail the agent would become a second hallucination
surface on top of the first.

---

## No model is trained

This is a deliberate engineering choice, not a shortcut. Both checkpoints are
frozen and used as published; only decision boundaries are fitted.

| Stage | Specified | What ClauseGuard actually runs | Training |
|---|---|---|---|
| Extraction | Legal-BERT fine-tuned on CUAD | `nlpaueb/legal-bert-base-uncased` frozen, with a nearest-centroid **prototype bank** built from real CUAD gold spans | none — no gradient steps |
| Verification | DeBERTa-v3 fine-tuned on ContractNLI | `cross-encoder/nli-deberta-v3-base`, which **is** `microsoft/deberta-v3-base` already tuned for 3-way NLI, with its **threshold calibrated** on the real ContractNLI dev split | none — threshold only |
| Agent | GPT-4o-mini or Claude Haiku | **Claude Haiku 4.5**, with a deterministic policy engine fallback | n/a |

The extractor is fitted by embedding the expert-annotated CUAD spans with the
frozen encoder and reducing each category to a handful of prototypes, plus a
**background** prototype pool drawn from unannotated contract text. That
background pool is what lets the extractor answer *"this is just boilerplate"*
instead of being forced to pick one of 36 labels.

Splits are by **contract**, hashed from the title, so no contract appears in two
splits: 347 train / 79 val / 84 test. The accept margin is chosen on val and
reported on the held-out test split. **The demo corpus is seeded from the test
split**, so everything the product shows runs on contracts the extractor has
never seen.

Extractor performance on the held-out CUAD test split:

| Metric | Value |
|---|---|
| Top-1 category accuracy (36 classes) | **0.571** (random = 0.028) |
| Obligation-clause detection precision | **0.921** |
| Obligation-clause detection recall | **0.944** |
| Obligation-clause detection F1 | **0.932** |

A note on why the background pool matters: Legal-BERT's mean-pooled embedding
space is strongly anisotropic — on real contract text every span sits at cosine
0.83–0.96 to every other span. An absolute similarity threshold is therefore
meaningless, and all the discriminative signal lives in the *margin* between a
span's best category prototype and the background pool. ClauseGuard's thresholds
are fitted to that margin, never hand-set.

## Data

Both datasets are real, downloaded at build time, and CC BY 4.0.

| Dataset | Size | Used for |
|---|---|---|
| [CUAD v1](https://huggingface.co/datasets/theatticusproject/cuad) | 510 contracts, 41 expert categories, 13k+ annotations | prototype bank; held-out demo corpus; end-to-end ablation |
| [ContractNLI](https://stanfordnlp.github.io/contract-nli/) | 607 NDAs, span-level entailment labels | verifier threshold calibration; controlled ablation |

---

## The ablation

The novelty claim only holds if the verifier measurably reduces false
obligations, so that is measured directly, on identical inputs:

- **verifier_off** — every proposed obligation is tracked. This is what a
  conventional extraction pipeline does, and it is the control arm.
- **verifier_on** — an obligation is tracked only when the clause entails the
  claim at the calibrated threshold.

The headline metric is `false_obligation_rate`: of everything the system tracks,
what fraction is not actually supported by the clause it cites.

Ground truth comes from ContractNLI's human entailment labels. Each positive is
paired with a **hard negative from the same document** — the same claim attached
to a clause that does not support it, which is precisely the hallucination mode
being guarded against. Negatives from other contracts would be separable on topic
alone and would flatter the verifier.

### Measured result

Held-out **ContractNLI test split**, n = 3,059 labelled (clause, claim) pairs,
threshold 0.14 fitted on the dev split at a 0.95 target precision:

| | verifier **off** | verifier **on** | change |
|---|---|---|---|
| **False-obligation rate** | **68.4%** | **7.0%** | **−61.4 pts** |
| Precision | 0.316 | 0.930 | +0.614 |
| Recall | 1.000 | 0.620 | −0.380 |
| F1 | 0.481 | 0.744 | +0.263 |

Confusion at the operating point: TP 600 · FP 45 · FN 368 · TN 2046.

**The recall cost is real and is the honest trade.** The verifier rejects about
38% of genuinely-supported obligations rather than risk tracking unsupported
ones, which is the right bias when a false obligation becomes a false alert.
Claims that land in the indecision band are routed to a human rather than
dropped silently, so recall lost by the model is recoverable by the reviewer —
that is what `/review` is for.

> **Read the numbers honestly.** The absolute rate in the control arm is a
> property of how the evaluation set is constructed — each positive is paired
> with one hard negative — not a measurement of any vendor's production error
> rate. The meaningful result is the **delta between arms on identical inputs**.

Reproduce: `python scripts/calibrate.py`, or run it from `/research` in the UI,
or `POST /api/v1/analytics/ablation/run`.

---

## Running it

### Docker — one command, everything included

```bash
docker compose up --build
# → http://localhost:7860
```

The image bakes in both datasets and both checkpoints, so a running container
makes no Hugging Face network call and starts deterministically.

### Local development

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/python scripts/download_data.py        # CUAD + ContractNLI
.venv/bin/python scripts/download_models.py      # both frozen checkpoints
.venv/bin/python scripts/build_prototypes.py     # fit the extractor (no training)
.venv/bin/python scripts/calibrate.py            # fit the verifier threshold

cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev        # → http://localhost:5173
```

### The agent

ClauseGuard is fully functional with no API key: the decision loop runs on a
deterministic policy engine, which is reproducible, free, and is what the
ablation runs on so the measured effect is attributable to the verifier rather
than to LLM variance. Adding a key upgrades the rationales to Claude Haiku 4.5:

```bash
cp .env.example .env    # set CLAUSEGUARD_ANTHROPIC_API_KEY
```

### Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

---

## Architecture

```
backend/app/
  pipeline/    segment · prefilter · extract · deadline · verify · agent · orchestrator
  ml/          frozen-checkpoint registry (local-first, lazy, thread-safe)
  eval/        CUAD + ContractNLI accessors, the ablation harness
  api/         FastAPI routers; WebSocket progress stream
  services/    background jobs, progress hub, seeding, analytics
  db/          SQLAlchemy models — contracts, clauses, obligations, verifications,
               agent decisions, review tasks, pipeline runs, audit log
frontend/src/
  components/three/   VerificationCore · ObligationConstellation · PipelineFlow · ClauseLattice
  pages/              landing · dashboard · contracts · obligations · review · research
```

Every obligation row is joined to the clause it came from, the entailment
probabilities that judged it, and the decision taken — so any tracked duty can be
traced back to the sentence that justifies it. That audit chain is what makes the
output defensible rather than merely plausible.

- **Full API reference:** [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) · live at `/api/docs`
- **Design language:** [`docs/FRONTEND_BRIEF.md`](docs/FRONTEND_BRIEF.md)

---

## Honest limitations

- Contract **header** extraction for uploaded documents (parties, effective date,
  governing law) is heuristic and lands roughly 30–50% of fields. CUAD-seeded
  contracts use the expert annotations instead, so the demo corpus is exact.
- The verifier operates on a clause at a time. An obligation that is only
  entailed by combining two distant clauses will be escalated, not auto-tracked.
- Scanned PDFs with no text layer are rejected; there is no OCR stage.
- Prototype extraction is strong at recognising clause *categories* and
  deliberately conservative about what it accepts as an obligation candidate.
- Because the CUAD corpus is historical (1999–2019), a seeded demo shows due
  dates in the past. Upload a current contract to see the forward calendar.
- The verifier rejects a high share of proposals on real contracts. That is
  mostly the verifier catching genuine extraction errors — a misclassified
  table header will not entail a licence claim — but it also means end-to-end
  recall is bounded by extractor precision, not by the verifier.

## Licence

Code MIT. CUAD and ContractNLI are CC BY 4.0 and remain the property of their
authors — the Atticus Project and Stanford NLP respectively.
