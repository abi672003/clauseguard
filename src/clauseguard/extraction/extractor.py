"""Obligation clause extraction: Legal-BERT fine-tuned on CUAD.

Per constraint 0.3, loaded from a local folder path only — never a Hugging
Face hub string. Populated by running
notebooks/finetune_legalbert_cuad.ipynb in Colab and copying its output
here.

Uses the same sliding-window inference the notebook trains for, since real
contracts routinely exceed the model's 384-token window. This step alone is
intentionally not novel — commercial products already do this well; the
verification step in src/clauseguard/verification is the project's actual
contribution.
"""

import json
from pathlib import Path

import torch
from transformers import AutoModelForQuestionAnswering, AutoTokenizer

MODEL_PATH = Path(__file__).resolve().parents[3] / "models" / "clauseguard-extractor"
CLAUSE_TYPES_PATH = Path(__file__).resolve().parent / "clause_types.json"
MAX_LENGTH = 384
DOC_STRIDE = 128

with open(CLAUSE_TYPES_PATH) as f:
    CLAUSE_TYPE_QUESTIONS: dict[str, str] = json.load(f)

_model = None
_tokenizer = None


def _ensure_loaded():
    global _model, _tokenizer
    if _model is not None:
        return
    if not (MODEL_PATH / "config.json").exists():
        raise FileNotFoundError(
            f"No fine-tuned model found at {MODEL_PATH}. Run "
            "notebooks/finetune_legalbert_cuad.ipynb in Colab and copy its "
            "output folder here — see constraint 0.3 in the project brief."
        )
    _tokenizer = AutoTokenizer.from_pretrained(str(MODEL_PATH))
    _model = AutoModelForQuestionAnswering.from_pretrained(str(MODEL_PATH))
    _model.eval()


def extract_clause(contract_text: str, clause_type: str) -> dict | None:
    """Extract the span for a single clause type, or None if not present.

    Returns {"clause_type", "text", "start", "end", "confidence"}.
    """
    _ensure_loaded()
    if clause_type not in CLAUSE_TYPE_QUESTIONS:
        raise ValueError(f"Unknown clause_type {clause_type!r}. See {CLAUSE_TYPES_PATH}.")
    question = CLAUSE_TYPE_QUESTIONS[clause_type]

    encoding = _tokenizer(
        question,
        contract_text,
        truncation="only_second",
        max_length=MAX_LENGTH,
        stride=DOC_STRIDE,
        return_overflowing_tokens=True,
        return_offsets_mapping=True,
        padding="max_length",
        return_tensors="pt",
    )
    offset_mapping = encoding.pop("offset_mapping")
    encoding.pop("overflow_to_sample_mapping", None)

    with torch.no_grad():
        outputs = _model(
            input_ids=encoding["input_ids"],
            attention_mask=encoding["attention_mask"],
            **({"token_type_ids": encoding["token_type_ids"]} if "token_type_ids" in encoding else {}),
        )

    best_margin, best_span, best_confidence = -1e9, None, 0.0
    for window_idx in range(encoding["input_ids"].shape[0]):
        sequence_ids = encoding.sequence_ids(window_idx)
        input_ids = encoding["input_ids"][window_idx].tolist()
        cls_index = input_ids.index(_tokenizer.cls_token_id)

        start_logits = outputs.start_logits[window_idx]
        end_logits = outputs.end_logits[window_idx]
        cls_score = (start_logits[cls_index] + end_logits[cls_index]).item()

        context_positions = [i for i, sid in enumerate(sequence_ids) if sid == 1]
        if not context_positions:
            continue

        window_best_score, window_best_span = -1e9, None
        for s in context_positions:
            for e in range(s, min(s + 30, context_positions[-1] + 1)):
                score = (start_logits[s] + end_logits[e]).item()
                if score > window_best_score:
                    window_best_score, window_best_span = score, (s, e)

        margin = window_best_score - cls_score
        if margin > best_margin:
            offsets = offset_mapping[window_idx]
            s, e = window_best_span
            best_margin = margin
            best_span = (offsets[s][0].item(), offsets[e][1].item())
            best_confidence = torch.sigmoid(torch.tensor(margin)).item()

    if best_span is None or best_margin <= 0:
        return None

    start, end = best_span
    return {
        "clause_type": clause_type,
        "text": contract_text[start:end],
        "start": start,
        "end": end,
        "confidence": best_confidence,
    }


def extract_all_clauses(contract_text: str) -> list[dict]:
    """Run extraction for every real CUAD clause type; returns only the
    clause types actually found (non-None)."""
    results = []
    for clause_type in CLAUSE_TYPE_QUESTIONS:
        result = extract_clause(contract_text, clause_type)
        if result is not None:
            results.append(result)
    return results
