# Data Provenance — ClauseGuard

Per constraint 0.1 (no synthetic data), every row in this project's data
layer traces back to one of the two real datasets named in the brief, both
verified directly against their official sources.

## CUAD

**Source:** https://huggingface.co/datasets/theatticusproject/cuad
(official — uploaded by `theatticusproject`, the dataset's own authors),
license CC BY 4.0.

**File used:** `CUAD_v1/CUAD_v1.json` — the official SQuAD-style QA release
(41 clause-type questions per contract; an answer's presence/absence and
span mark whether that clause type occurs in the contract).

**Verified:** 510 contracts (`len(data)` == 510), matching the brief's
"510 contracts" exactly. 41 clause-type questions × 510 contracts, with the
non-"impossible" (actually-answered) questions totaling in the low tens of
thousands — consistent with the paper's "13,000+ expert-annotated clause
labels" figure (the >13k figure counts individual annotated clause spans,
not question slots).

**Split:** CUAD_v1.json ships as one file with no official train/val/test
split. Per constraint 0.2, `scripts/build_sqlite.py` creates a documented,
reproducible split: **contract-level** (not QA-pair-level, to avoid leaking
the same contract's other clauses across splits) 80/10/10, fixed seed 42.

**Files:** `data/raw/cuad/CUAD_v1.json`

## ContractNLI

**Source:** https://github.com/stanfordnlp/contract-nli (official Stanford
NLP repo), data released as `resources/contract-nli.zip` directly in that
repo.

**Verified:** 607 total documents across the three files (423 train + 61
dev + 123 test), matching the brief's "607 contracts" exactly. Each
document carries entailment labels (`Entailment` / `Contradiction` /
`NotMentioned`) against a fixed set of 17 standard NDA hypotheses, with
character-span evidence for `Entailment` labels — this is the real
`premise, hypothesis, label` structure the brief calls for (the "premise"
is the cited clause span, "hypothesis" is the NDA obligation type,
"label" is the entailment verdict).

**Split:** official — `train.json` / `dev.json` / `test.json` ship directly
from the source, so these are used as-is per constraint 0.2's preference
for official splits.

**Note:** the repo also ships `raw/` (the original 607 contract PDFs/HTML
files, ~70MB). Not committed — `train/dev/test.json` already embed each
document's full extracted `text`, so the raw exhibits are redundant for
this pipeline.

**Files:** `data/raw/contractnli/contract-nli/{train,dev,test}.json`
