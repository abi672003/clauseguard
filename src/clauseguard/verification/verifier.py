"""Entailment-based verification: DeBERTa-v3 fine-tuned on ContractNLI.

This is the project's actual research contribution (per the brief): check
whether a claimed obligation is genuinely entailed by the specific clause
cited, before it's trusted and tracked — adapted from the CITE benchmark's
citation-verification approach for case law, applied here to contract
obligation monitoring for the first time.

Per constraint 0.3, loaded from a local folder path only. Populated by
running notebooks/finetune_deberta_contractnli.ipynb in Colab.

Domain-transfer note (see docs/DOMAIN_TRANSFER.md): ContractNLI's 17
hypotheses are all NDA-specific ("Receiving Party shall not..."). When this
verifier checks an obligation claim extracted from a general commercial
contract (CUAD covers many contract types beyond NDAs), it is applied
out-of-domain — a real limitation to keep in view, not one this code papers
over.
"""

from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_PATH = Path(__file__).resolve().parents[3] / "models" / "clauseguard-verifier"
MAX_LENGTH = 384

# Matches label2id in notebooks/finetune_deberta_contractnli.ipynb
ID2LABEL = {0: "NotMentioned", 1: "Entailment", 2: "Contradiction"}

_model = None
_tokenizer = None


def _ensure_loaded():
    global _model, _tokenizer
    if _model is not None:
        return
    if not (MODEL_PATH / "config.json").exists():
        raise FileNotFoundError(
            f"No fine-tuned model found at {MODEL_PATH}. Run "
            "notebooks/finetune_deberta_contractnli.ipynb in Colab and copy "
            "its output folder here — see constraint 0.3 in the project brief."
        )
    _tokenizer = AutoTokenizer.from_pretrained(str(MODEL_PATH))
    _model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_PATH))
    _model.eval()


def verify(premise: str, hypothesis: str) -> dict:
    """Check whether `hypothesis` (the claimed obligation, stated as a
    plain-English sentence) is entailed by `premise` (the cited clause
    text). Returns {"label", "confidence", "probabilities"}."""
    _ensure_loaded()
    inputs = _tokenizer(
        premise, hypothesis, truncation=True, max_length=MAX_LENGTH, padding=True, return_tensors="pt"
    )
    with torch.no_grad():
        logits = _model(**inputs).logits
    probs = torch.softmax(logits, dim=-1)[0]
    label_idx = int(torch.argmax(probs).item())
    return {
        "label": ID2LABEL[label_idx],
        "confidence": probs[label_idx].item(),
        "probabilities": {ID2LABEL[i]: probs[i].item() for i in range(len(ID2LABEL))},
    }
