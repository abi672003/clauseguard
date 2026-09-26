"""Stage 1 - obligation clause extraction.

The extractor is a nearest-prototype classifier over a frozen
nlpaueb/legal-bert-base-uncased encoder. The prototype bank is built once by
`scripts/build_prototypes.py` from the real CUAD gold spans; nothing here
updates any model parameter.

A clause is accepted as an obligation candidate only when its best category
prototype beats the BACKGROUND prototype pool by the margin chosen on the CUAD
validation split. That background pool is what lets the extractor answer
"this is just boilerplate" instead of being forced to pick one of 36 labels.
"""
from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass

import numpy as np

from app.core.config import BACKEND_DIR, settings
from app.ml.registry import registry
from app.pipeline.segment import Span, clean_for_model
from app.pipeline.taxonomy import CATEGORIES, Category

log = logging.getLogger(__name__)

BANK_PATH = BACKEND_DIR / "artifacts" / "prototypes.npz"
META_PATH = BACKEND_DIR / "artifacts" / "prototypes.json"
BACKGROUND = "__background__"


@dataclass
class ExtractedClause:
    span: Span
    index: int
    category: str | None
    category_score: float
    runner_up: str | None
    runner_up_score: float
    background_score: float
    margin: float
    is_candidate: bool

    @property
    def taxonomy(self) -> Category | None:
        return CATEGORIES.get(self.category) if self.category else None


class PrototypeExtractor:
    """Lazily-loaded prototype bank + cosine scoring."""

    def __init__(self) -> None:
        self._bank: np.ndarray | None = None
        self._labels: list[str] = []
        self._cats: list[str] = []
        self._cat_slices: dict[str, np.ndarray] = {}
        self._bg_slice: np.ndarray | None = None
        self._meta: dict = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ load
    def _ensure(self) -> None:
        if self._bank is not None:
            return
        with self._lock:
            if self._bank is not None:
                return
            if not BANK_PATH.exists():
                raise RuntimeError(
                    f"prototype bank missing at {BANK_PATH}. "
                    "Run: python scripts/build_prototypes.py"
                )
            data = np.load(BANK_PATH, allow_pickle=True)
            bank = data["bank"].astype(np.float32)
            labels = [str(x) for x in data["labels"].tolist()]
            self._bank = bank
            self._labels = labels
            self._cats = sorted({lbl for lbl in labels if lbl != BACKGROUND})
            self._cat_slices = {
                c: np.array([i for i, lbl in enumerate(labels) if lbl == c], dtype=np.int64)
                for c in self._cats
            }
            self._bg_slice = np.array(
                [i for i, lbl in enumerate(labels) if lbl == BACKGROUND], dtype=np.int64
            )
            self._meta = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
            log.info("prototype bank loaded: %d vectors, %d categories",
                     bank.shape[0], len(self._cats))

    @property
    def ready(self) -> bool:
        return BANK_PATH.exists()

    @property
    def meta(self) -> dict:
        self._ensure()
        return self._meta

    @property
    def accept_margin(self) -> float:
        self._ensure()
        return float(self._meta.get("accept_margin", 0.0))

    # ----------------------------------------------------------------- score
    def classify(
        self, texts: list[str], embeddings: np.ndarray | None = None
    ) -> list[tuple[str, float, str, float, float, float]]:
        """-> [(best_cat, best_sim, runner_up, runner_sim, bg_sim, margin)]

        `embeddings` lets the caller hand back vectors the pre-filter already
        computed. Re-encoding them here would double the cost of the single
        most expensive stage for no gain.
        """
        self._ensure()
        assert self._bank is not None and self._bg_slice is not None
        if not texts:
            return []

        if embeddings is not None and len(embeddings) == len(texts):
            vecs = embeddings
        else:
            vecs = registry.embed(texts)         # already L2-normalised
        sims = vecs @ self._bank.T               # cosine, [N, P]

        per_cat = np.stack(
            [sims[:, self._cat_slices[c]].max(axis=1) for c in self._cats], axis=1
        )                                        # [N, C]
        bg = sims[:, self._bg_slice].max(axis=1) # [N]

        order = np.argsort(-per_cat, axis=1)
        out = []
        for i in range(len(texts)):
            b, r = int(order[i, 0]), int(order[i, 1]) if per_cat.shape[1] > 1 else int(order[i, 0])
            best_sim = float(per_cat[i, b])
            out.append((
                self._cats[b], best_sim,
                self._cats[r], float(per_cat[i, r]),
                float(bg[i]), best_sim - float(bg[i]),
            ))
        return out

    # --------------------------------------------------------------- extract
    def extract(
        self, spans: list[Span], *, margin: float | None = None,
        embeddings: np.ndarray | None = None,
    ) -> list[ExtractedClause]:
        thresh = self.accept_margin if margin is None else margin
        texts = [clean_for_model(s.text) for s in spans]
        scored = self.classify(texts, embeddings=embeddings)

        floor = settings.prototype_min_cosine
        out: list[ExtractedClause] = []
        for i, (span, (cat, sim, run, run_sim, bg_sim, marg)) in enumerate(
            zip(spans, scored, strict=True)
        ):
            # The margin against the background pool IS the decision. An absolute
            # cosine floor is disabled by default because this embedding space is
            # far too anisotropic for one to carry meaning: on real contract text
            # every span scores 0.83-0.96 against everything.
            is_cand = marg >= thresh and (floor is None or sim >= floor)
            out.append(ExtractedClause(
                span=span, index=i,
                category=cat if is_cand else None,
                category_score=sim, runner_up=run, runner_up_score=run_sim,
                background_score=bg_sim, margin=marg, is_candidate=is_cand,
            ))
        return out


extractor = PrototypeExtractor()
