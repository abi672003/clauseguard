"""Lazy, process-wide model registry.

Both checkpoints are *frozen* - ClauseGuard performs no gradient updates anywhere.
Checkpoints are resolved from the local `backend/models_cache/` folder first so a
deployed container never makes a Hugging Face network call at request time.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
from transformers import (
    AutoModel,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedModel,
    PreTrainedTokenizerBase,
)

from app.core.config import BACKEND_DIR, settings

log = logging.getLogger(__name__)

LOCAL_CACHE = BACKEND_DIR / "models_cache"

# cross-encoder/nli-deberta-v3-base emits logits in this order.
NLI_LABELS = ("contradiction", "entailment", "neutral")


def resolve_checkpoint(repo_id: str) -> str:
    """Prefer the vendored local folder; fall back to the hub id."""
    local = LOCAL_CACHE / repo_id.replace("/", "__")
    if (local / "config.json").exists():
        return str(local)
    if settings.hf_cache_dir:
        alt = Path(settings.hf_cache_dir) / repo_id.replace("/", "__")
        if (alt / "config.json").exists():
            return str(alt)
    log.warning("checkpoint %s not vendored locally; will resolve from the hub", repo_id)
    return repo_id


def pick_device() -> torch.device:
    if settings.device != "auto":
        return torch.device(settings.device)
    # CPU is the default even when MPS exists: these are base-size encoders, the
    # workload is short-sequence and batchy, and CPU avoids MPS kernel gaps in
    # DeBERTa's disentangled attention. Set CLAUSEGUARD_DEVICE=mps to override.
    return torch.device("cpu")


@dataclass
class _Bundle:
    tokenizer: PreTrainedTokenizerBase
    model: PreTrainedModel
    name: str
    load_ms: float = 0.0
    meta: dict = field(default_factory=dict)


class ModelRegistry:
    """Thread-safe lazy loader. First touch pays the load cost, nobody else does."""

    def __init__(self) -> None:
        self._embedder: _Bundle | None = None
        self._verifier: _Bundle | None = None
        self._lock = threading.Lock()
        self._device = pick_device()

    # ------------------------------------------------------------------ device
    @property
    def device(self) -> torch.device:
        return self._device

    # ---------------------------------------------------------------- embedder
    def embedder(self) -> _Bundle:
        if self._embedder is None:
            with self._lock:
                if self._embedder is None:
                    path = resolve_checkpoint(settings.extractor_model)
                    t0 = time.perf_counter()
                    tok = AutoTokenizer.from_pretrained(path)
                    mdl = AutoModel.from_pretrained(path).to(self._device).eval()
                    for p in mdl.parameters():
                        p.requires_grad_(False)
                    self._embedder = _Bundle(
                        tokenizer=tok,
                        model=mdl,
                        name=settings.extractor_model,
                        load_ms=(time.perf_counter() - t0) * 1000,
                        meta={"hidden_size": mdl.config.hidden_size, "path": path},
                    )
                    log.info("loaded embedder %s in %.0fms", settings.extractor_model,
                             self._embedder.load_ms)
        return self._embedder

    # ---------------------------------------------------------------- verifier
    def verifier(self) -> _Bundle:
        if self._verifier is None:
            with self._lock:
                if self._verifier is None:
                    path = resolve_checkpoint(settings.verifier_model)
                    t0 = time.perf_counter()
                    tok = AutoTokenizer.from_pretrained(path)
                    mdl = (
                        AutoModelForSequenceClassification.from_pretrained(path)
                        .to(self._device)
                        .eval()
                    )
                    for p in mdl.parameters():
                        p.requires_grad_(False)
                    id2label = {int(k): v.lower() for k, v in mdl.config.id2label.items()}
                    self._verifier = _Bundle(
                        tokenizer=tok,
                        model=mdl,
                        name=settings.verifier_model,
                        load_ms=(time.perf_counter() - t0) * 1000,
                        meta={"id2label": id2label, "path": path,
                              "base": mdl.config._name_or_path},
                    )
                    log.info("loaded verifier %s in %.0fms", settings.verifier_model,
                             self._verifier.load_ms)
        return self._verifier

    # --------------------------------------------------------------- inference
    @torch.inference_mode()
    def embed(self, texts: list[str], batch_size: int | None = None) -> np.ndarray:
        """Mean-pooled, L2-normalised Legal-BERT sentence embeddings."""
        if not texts:
            return np.zeros((0, 768), dtype=np.float32)
        b = self.embedder()
        bs = batch_size or settings.embed_batch_size
        out: list[np.ndarray] = []
        for i in range(0, len(texts), bs):
            chunk = texts[i : i + bs]
            enc = b.tokenizer(
                chunk, padding=True, truncation=True,
                max_length=settings.max_seq_len, return_tensors="pt",
            ).to(self._device)
            hidden = b.model(**enc).last_hidden_state          # [B, T, H]
            mask = enc["attention_mask"].unsqueeze(-1).float()  # [B, T, 1]
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=-1)
            out.append(pooled.cpu().numpy().astype(np.float32))
        return np.vstack(out)

    @torch.inference_mode()
    def nli(
        self, premises: list[str], hypotheses: list[str], batch_size: int | None = None
    ) -> np.ndarray:
        """Return [n, 3] probabilities ordered (contradiction, entailment, neutral)."""
        if not premises:
            return np.zeros((0, 3), dtype=np.float32)
        if len(premises) != len(hypotheses):
            raise ValueError("premises and hypotheses must be the same length")
        b = self.verifier()
        bs = batch_size or settings.verify_batch_size
        id2label: dict[int, str] = b.meta["id2label"]
        order = [next(i for i, lbl in id2label.items() if lbl == name) for name in NLI_LABELS]

        out: list[np.ndarray] = []
        for i in range(0, len(premises), bs):
            enc = b.tokenizer(
                premises[i : i + bs], hypotheses[i : i + bs],
                padding=True, truncation="only_first",
                max_length=settings.max_seq_len, return_tensors="pt",
            ).to(self._device)
            probs = b.model(**enc).logits.softmax(-1)
            out.append(probs[:, order].cpu().numpy().astype(np.float32))
        return np.vstack(out)

    # ------------------------------------------------------------------ status
    def status(self) -> dict[str, bool]:
        return {
            settings.extractor_model: self._embedder is not None,
            settings.verifier_model: self._verifier is not None,
        }

    def warmup(self) -> None:
        """Touch both models so the first real request is fast."""
        self.embed(["This Agreement shall commence on the Effective Date."])
        self.nli(["Supplier shall deliver within 30 days."],
                 ["Supplier must deliver within thirty days."])


registry = ModelRegistry()
