"""Fit ClauseGuard's clause extractor WITHOUT training anything.

Method (prototype / nearest-centroid classification over a frozen encoder):
  1. Split the 510 CUAD contracts into train/val/test *by contract*, so no
     contract's text is ever seen in two splits.
  2. From TRAIN contracts only, take the expert gold answer spans for each of
     the 36 obligation-bearing categories.
  3. Embed them with a frozen nlpaueb/legal-bert-base-uncased (mean-pooled,
     L2-normalised). No parameter of the encoder is ever updated.
  4. Reduce each category's embeddings to a handful of prototypes by k-means,
     plus a pool of BACKGROUND prototypes drawn from unannotated contract text
     so the classifier can say "this is not an obligation" instead of being
     forced to pick a category.
  5. Choose the accept threshold on VAL, and report the held-out TEST numbers.

Inference is then a cosine similarity against the prototype bank.

Usage: python scripts/build_prototypes.py [--max-per-category 240] [--seed 17]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import settings  # noqa: E402
from app.ml.registry import registry  # noqa: E402
from app.pipeline.segment import clean_for_model, segment  # noqa: E402
from app.pipeline.taxonomy import (  # noqa: E402
    CATEGORIES,
    METADATA_CATEGORIES,
    normalise_cuad_question_id,
)

CUAD_PATH = ROOT / "data" / "raw" / "cuad" / "CUAD_v1.json"
OUT_NPZ = ROOT / "backend" / "artifacts" / "prototypes.npz"
OUT_META = ROOT / "backend" / "artifacts" / "prototypes.json"
SPLIT_PATH = ROOT / "backend" / "artifacts" / "cuad_splits.json"

BACKGROUND = "__background__"


def split_of(title: str) -> str:
    """Deterministic, contract-level split. Same title -> same split, always."""
    h = int(hashlib.sha1(title.encode()).hexdigest()[:8], 16) % 100
    if h < 70:
        return "train"
    return "val" if h < 85 else "test"


def load_cuad() -> list[dict]:
    if not CUAD_PATH.exists():
        raise SystemExit(f"missing {CUAD_PATH}; run scripts/download_data.py first")
    return json.loads(CUAD_PATH.read_text())["data"]


def harvest(docs: list[dict]) -> tuple[dict[str, list[tuple[str, str]]], dict[str, list[str]]]:
    """Return per-split gold (category, text) pairs and per-split background text."""
    gold: dict[str, list[tuple[str, str]]] = {"train": [], "val": [], "test": []}
    background: dict[str, list[str]] = {"train": [], "val": [], "test": []}
    rng = random.Random(17)

    for doc in docs:
        sp = split_of(doc["title"])
        para = doc["paragraphs"][0]
        context = para["context"]
        covered: list[tuple[int, int]] = []

        for qa in para["qas"]:
            cat = normalise_cuad_question_id(qa["id"])
            if cat in METADATA_CATEGORIES or cat not in CATEGORIES:
                # still record coverage so metadata spans aren't used as background
                for ans in qa.get("answers", []):
                    covered.append((ans["answer_start"], ans["answer_start"] + len(ans["text"])))
                continue
            for ans in qa.get("answers", []):
                txt = clean_for_model(ans["text"])
                start = ans["answer_start"]
                covered.append((start, start + len(ans["text"])))
                if 40 <= len(txt) <= 3000:
                    gold[sp].append((cat, txt))

        # background = segmented spans that overlap no annotation at all
        spans = segment(context)
        rng.shuffle(spans)
        taken = 0
        for s in spans:
            if taken >= 6:
                break
            if any(not (s.end <= a or s.start >= b) for a, b in covered):
                continue
            t = clean_for_model(s.text)
            if 80 <= len(t) <= 2000:
                background[sp].append(t)
                taken += 1

    return gold, background


def kmeans(x: np.ndarray, k: int, seed: int, iters: int = 40) -> np.ndarray:
    """Spherical k-means on L2-normalised vectors. Pure clustering - no model
    parameters are learned, this only summarises the frozen embeddings."""
    n = len(x)
    k = max(1, min(k, n))
    rng = np.random.default_rng(seed)
    # k-means++ style seeding on cosine distance
    idx = [int(rng.integers(n))]
    while len(idx) < k:
        sims = (x @ x[idx].T).max(axis=1)
        d = np.clip(1.0 - sims, 1e-9, None) ** 2
        idx.append(int(rng.choice(n, p=d / d.sum())))
    c = x[idx].copy()

    for _ in range(iters):
        assign = (x @ c.T).argmax(axis=1)
        new = np.zeros_like(c)
        for j in range(k):
            members = x[assign == j]
            new[j] = members.mean(0) if len(members) else c[j]
        norms = np.linalg.norm(new, axis=1, keepdims=True)
        new = new / np.clip(norms, 1e-9, None)
        if np.allclose(new, c, atol=1e-6):
            c = new
            break
        c = new
    return c.astype(np.float32)


def embed_all(texts: list[str], label: str) -> np.ndarray:
    t0 = time.perf_counter()
    out: list[np.ndarray] = []
    step = 256
    for i in range(0, len(texts), step):
        out.append(registry.embed(texts[i : i + step]))
        done = min(i + step, len(texts))
        print(f"\r  embedding {label}: {done}/{len(texts)}", end="", flush=True)
    print(f"   [{time.perf_counter() - t0:.0f}s]")
    return np.vstack(out) if out else np.zeros((0, 768), dtype=np.float32)


def score(bank: np.ndarray, labels: list[str], vecs: np.ndarray) -> tuple[list[str], np.ndarray]:
    """Best non-background category and its margin over the background pool."""
    sims = vecs @ bank.T                                    # [N, P]
    cats = sorted({lbl for lbl in labels if lbl != BACKGROUND})
    cat_idx = {c: [i for i, lbl in enumerate(labels) if lbl == c] for c in cats}
    bg_idx = [i for i, lbl in enumerate(labels) if lbl == BACKGROUND]

    per_cat = np.stack([sims[:, cat_idx[c]].max(axis=1) for c in cats], axis=1)  # [N, C]
    bg = sims[:, bg_idx].max(axis=1) if bg_idx else np.full(len(vecs), -1.0)

    best = per_cat.argmax(axis=1)
    best_sim = per_cat.max(axis=1)
    return [cats[i] for i in best], (best_sim - bg)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-per-category", type=int, default=240)
    ap.add_argument("--max-background", type=int, default=1800)
    ap.add_argument("--protos-per-category", type=int, default=5)
    ap.add_argument("--background-protos", type=int, default=28)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    print("ClauseGuard :: building the extractor prototype bank (no training)")
    docs = load_cuad()
    sizes = {s: sum(1 for d in docs if split_of(d["title"]) == s) for s in ("train", "val", "test")}
    print(f"contracts: {len(docs)} -> {sizes}")

    gold, background = harvest(docs)
    print("gold spans: " + ", ".join(f"{k}={len(v)}" for k, v in gold.items()))
    print("background: " + ", ".join(f"{k}={len(v)}" for k, v in background.items()))

    # ---- assemble the TRAIN fitting set -----------------------------------
    by_cat: dict[str, list[str]] = {}
    for cat, txt in gold["train"]:
        by_cat.setdefault(cat, []).append(txt)
    for cat in by_cat:
        uniq = list(dict.fromkeys(by_cat[cat]))
        rng.shuffle(uniq)
        by_cat[cat] = uniq[: args.max_per_category]

    bg_train = list(dict.fromkeys(background["train"]))
    rng.shuffle(bg_train)
    bg_train = bg_train[: args.max_background]

    print(f"\nfitting on {sum(len(v) for v in by_cat.values())} gold spans "
          f"across {len(by_cat)} categories + {len(bg_train)} background spans")
    print(f"encoder: {settings.extractor_model} (frozen, device={registry.device})")

    # ---- embed & reduce to prototypes -------------------------------------
    bank: list[np.ndarray] = []
    labels: list[str] = []
    per_cat_counts: dict[str, int] = {}

    flat_texts, flat_cats = [], []
    for cat, texts in sorted(by_cat.items()):
        flat_texts.extend(texts)
        flat_cats.extend([cat] * len(texts))
    emb = embed_all(flat_texts, "gold")

    for cat in sorted(by_cat):
        mask = np.array([c == cat for c in flat_cats])
        vecs = emb[mask]
        k = max(1, min(args.protos_per_category, len(vecs) // 6 or 1))
        protos = kmeans(vecs, k, args.seed)
        bank.append(protos)
        labels.extend([cat] * len(protos))
        per_cat_counts[cat] = int(len(vecs))

    bg_emb = embed_all(bg_train, "background")
    bg_protos = kmeans(bg_emb, args.background_protos, args.seed)
    bank.append(bg_protos)
    labels.extend([BACKGROUND] * len(bg_protos))

    bank_arr = np.vstack(bank).astype(np.float32)
    print(f"\nprototype bank: {bank_arr.shape[0]} vectors x {bank_arr.shape[1]} dims "
          f"({len(set(labels)) - 1} categories + background)")

    # ---- evaluate on VAL, pick the margin threshold ------------------------
    def eval_split(split: str) -> dict:
        pairs = gold[split]
        if not pairs:
            return {}
        rng2 = random.Random(args.seed)
        rng2.shuffle(pairs)
        pairs = pairs[:1600]
        texts = [t for _, t in pairs]
        truth = [c for c, _ in pairs]
        v = embed_all(texts, f"{split}-gold")
        pred, margin = score(bank_arr, labels, v)
        acc = float(np.mean([p == t for p, t in zip(pred, truth, strict=False)]))

        bgs = background[split][:800]
        bv = embed_all(bgs, f"{split}-bg") if bgs else np.zeros((0, 768), np.float32)
        _, bg_margin = score(bank_arr, labels, bv) if len(bv) else ([], np.zeros(0))
        return {"n": len(texts), "top1": acc, "margin": margin,
                "bg_margin": bg_margin, "n_bg": len(bgs)}

    print("\n--- validation ---")
    val = eval_split("val")
    grid = np.round(np.arange(-0.02, 0.121, 0.005), 4)
    best_t, best_f1 = 0.0, -1.0
    curve = []
    for t in grid:
        tp = float((val["margin"] >= t).sum())
        fn = float((val["margin"] < t).sum())
        fp = float((val["bg_margin"] >= t).sum())
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        curve.append({"threshold": float(t), "precision": prec, "recall": rec, "f1": f1})
        if f1 > best_f1:
            best_t, best_f1 = float(t), f1
    print(f"val top-1 category accuracy : {val['top1']:.3f}  (n={val['n']})")
    print(f"chosen accept margin        : {best_t:.3f}  (val F1={best_f1:.3f})")

    print("\n--- held-out test ---")
    test = eval_split("test")
    tp = float((test["margin"] >= best_t).sum())
    fn = float((test["margin"] < best_t).sum())
    fp = float((test["bg_margin"] >= best_t).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    print(f"test top-1 category accuracy: {test['top1']:.3f}  (n={test['n']})")
    print(f"test clause-detection P/R/F1: {prec:.3f} / {rec:.3f} / {f1:.3f} "
          f"(background n={test['n_bg']})")

    # ---- persist -----------------------------------------------------------
    OUT_NPZ.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT_NPZ, bank=bank_arr, labels=np.array(labels, dtype=object))
    meta = {
        "encoder": settings.extractor_model,
        "method": "frozen-encoder nearest-centroid prototypes (no gradient updates)",
        "dim": int(bank_arr.shape[1]),
        "n_prototypes": int(bank_arr.shape[0]),
        "categories": sorted(by_cat),
        "background_label": BACKGROUND,
        "accept_margin": best_t,
        "per_category_train_spans": per_cat_counts,
        "splits": sizes,
        "val": {"top1": val["top1"], "n": val["n"], "f1": best_f1},
        "test": {"top1": test["top1"], "n": test["n"],
                 "precision": prec, "recall": rec, "f1": f1},
        "threshold_curve": curve,
        "built_with_seed": args.seed,
    }
    OUT_META.write_text(json.dumps(meta, indent=2))
    SPLIT_PATH.write_text(json.dumps(
        {d["title"]: split_of(d["title"]) for d in docs}, indent=0))
    print(f"\nwrote {OUT_NPZ.relative_to(ROOT)} and {OUT_META.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
