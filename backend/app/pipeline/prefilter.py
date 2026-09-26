"""Span pre-filter backed by ChromaDB.

A 60,000-character contract segments into ~100 clause spans, and most of them
are boilerplate - recitals, definitions, notices, signature blocks. Running the
full extract -> verify -> agent chain over all of them wastes the expensive
stages on text that was never going to yield an obligation.

So every span is embedded once with the frozen Legal-BERT encoder, persisted in
Chroma, and scored against the category prototype bank. Only the spans that look
like they carry a duty go downstream.

Persistence earns its keep twice over: the ablation re-runs the same contract
with the verifier on and off, and re-analysis after a threshold change is
common. Neither re-embeds. It also gives the product corpus-wide semantic clause
search for free.

Chroma is optional. If it is unavailable or its store is corrupt, the filter
falls back to an in-process numpy path and the pipeline is unaffected.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

from app.core.config import settings
from app.ml.registry import registry
from app.pipeline.segment import Span, clean_for_model

log = logging.getLogger(__name__)

COLLECTION = "contract_spans"


@dataclass
class PrefilterResult:
    kept: list[int]                 # indices into the original span list
    scores: np.ndarray              # relevance score per span, aligned to input
    embeddings: np.ndarray          # [N, 768], reused by the extractor
    backend: str                    # chroma | numpy
    cached: bool                    # embeddings came from the store, not the encoder


class SpanStore:
    """Thin, failure-tolerant wrapper over a persistent Chroma collection."""

    def __init__(self) -> None:
        self._client = None
        self._collection = None
        self._available: bool | None = None

    def _connect(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            # chromadb 0.6.x calls posthog with a signature its pinned client
            # does not accept and logs an ERROR per event. Telemetry is already
            # off; this stops the noise from looking like a real failure.
            for name in ("chromadb.telemetry", "chromadb.telemetry.product",
                         "chromadb.telemetry.product.posthog"):
                logging.getLogger(name).setLevel(logging.CRITICAL)

            settings.chroma_dir.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(
                path=str(settings.chroma_dir),
                settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
            )
            self._collection = self._client.get_or_create_collection(
                name=COLLECTION, metadata={"hnsw:space": "cosine"}
            )
            self._available = True
            log.info("chroma span store ready at %s", settings.chroma_dir)
        except Exception as exc:
            log.warning("chroma unavailable (%s); using numpy fallback", exc)
            self._available = False
        return self._available

    @property
    def available(self) -> bool:
        return self._connect()

    # ------------------------------------------------------------------ read
    def fetch(self, contract_id: str, expected: int) -> np.ndarray | None:
        """Return cached embeddings in span order, or None on any mismatch."""
        if not self.available:
            return None
        try:
            got = self._collection.get(
                where={"contract_id": contract_id}, include=["embeddings", "metadatas"]
            )
        except Exception as exc:
            log.warning("chroma fetch failed (%s)", exc)
            return None

        metas = got.get("metadatas") or []
        embs = got.get("embeddings")
        if embs is None or len(metas) != expected:
            return None
        order = np.argsort([int(m.get("span_index", 0)) for m in metas])
        arr = np.asarray(embs, dtype=np.float32)[order]
        return arr if arr.shape[0] == expected else None

    # ----------------------------------------------------------------- write
    def upsert(self, contract_id: str, spans: list[Span], embeddings: np.ndarray) -> None:
        if not self.available:
            return
        try:
            self._collection.upsert(
                ids=[f"{contract_id}:{i}" for i in range(len(spans))],
                embeddings=[e.tolist() for e in embeddings],
                documents=[s.text[:4000] for s in spans],
                metadatas=[
                    {"contract_id": contract_id, "span_index": i,
                     "char_start": s.start, "char_end": s.end, "length": s.length}
                    for i, s in enumerate(spans)
                ],
            )
        except Exception as exc:
            log.warning("chroma upsert failed (%s)", exc)

    def delete_contract(self, contract_id: str) -> None:
        if not self.available:
            return
        try:
            self._collection.delete(where={"contract_id": contract_id})
        except Exception as exc:
            log.warning("chroma delete failed (%s)", exc)

    # ---------------------------------------------------------------- search
    def search(self, query: str, k: int = 20,
               contract_id: str | None = None) -> list[dict]:
        """Corpus-wide semantic clause search."""
        if not self.available:
            return []
        try:
            vec = registry.embed([query])[0].tolist()
            res = self._collection.query(
                query_embeddings=[vec], n_results=k,
                where={"contract_id": contract_id} if contract_id else None,
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:
            log.warning("chroma search failed (%s)", exc)
            return []
        out: list[dict] = []
        for doc, meta, dist in zip(
            res.get("documents", [[]])[0],
            res.get("metadatas", [[]])[0],
            res.get("distances", [[]])[0], strict=False,
        ):
            out.append({"text": doc, **meta, "similarity": 1.0 - float(dist)})
        return out

    def count(self) -> int:
        if not self.available:
            return 0
        try:
            return int(self._collection.count())
        except Exception:
            return 0


store = SpanStore()


def prefilter(
    contract_id: str, spans: list[Span], *, top_k: int | None = None,
    min_score: float | None = None, use_cache: bool = True,
) -> PrefilterResult:
    """Embed (or reuse) span vectors and select those worth extracting from."""
    from app.pipeline.extract import extractor  # local import avoids a cycle

    k = top_k if top_k is not None else settings.prefilter_top_k
    if min_score is not None:
        floor = min_score
    elif settings.prefilter_min_score is not None:
        floor = settings.prefilter_min_score
    else:
        # Sit just below the extractor's fitted accept margin so this stage is
        # recall-oriented and the extractor makes the actual accept decision.
        try:
            floor = extractor.accept_margin - settings.prefilter_recall_band
        except Exception:
            floor = -1.0

    if not spans:
        return PrefilterResult([], np.zeros(0, np.float32),
                               np.zeros((0, 768), np.float32), "numpy", False)

    cached_emb = store.fetch(contract_id, len(spans)) if use_cache else None
    if cached_emb is not None:
        emb, was_cached = cached_emb, True
    else:
        emb = registry.embed([clean_for_model(s.text) for s in spans])
        store.upsert(contract_id, spans, emb)
        was_cached = False

    # Relevance = best similarity to any obligation-category prototype, minus the
    # best similarity to the background pool. Spans that look more like
    # boilerplate than like any duty score at or below zero.
    try:
        extractor._ensure()  # noqa: SLF001 - internal warm-up is intentional
        bank, labels = extractor._bank, extractor._labels  # noqa: SLF001
        cat_idx = np.array([i for i, lbl in enumerate(labels)
                            if lbl != "__background__"], dtype=np.int64)
        bg_idx = np.array([i for i, lbl in enumerate(labels)
                           if lbl == "__background__"], dtype=np.int64)
        sims = emb @ bank.T
        scores = sims[:, cat_idx].max(axis=1) - sims[:, bg_idx].max(axis=1)
    except Exception as exc:
        log.warning("prototype bank unavailable for prefilter (%s); keeping all spans", exc)
        scores = np.ones(len(spans), dtype=np.float32)

    order = np.argsort(-scores)
    above = [int(i) for i in order if scores[i] >= floor]
    kept = above[:k]
    if len(above) > k:
        log.info("prefilter capped %s: %d spans cleared the floor, keeping top %d",
                 contract_id, len(above), k)
    if not kept:
        # Never hand an empty contract downstream, but say so - silently
        # substituting an arbitrary dozen spans would look like a real result.
        kept = [int(i) for i in order[: min(12, len(spans))]]
        log.warning("prefilter floor %.4f rejected every span of %s; "
                    "falling back to the %d best-scoring", floor, contract_id, len(kept))

    return PrefilterResult(
        kept=sorted(kept), scores=scores.astype(np.float32),
        embeddings=emb, backend="chroma" if store.available else "numpy",
        cached=was_cached,
    )
