"""Ingest real CUAD and ContractNLI data into the SQLite data layer.

Sources and verification are documented in docs/DATA_PROVENANCE.md. This
script does not fabricate any data — it only reshapes the real downloaded
files into the schema defined in src/clauseguard/db.py.
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from clauseguard.db import get_connection  # noqa: E402

RAW = ROOT / "data" / "raw"
SEED = 42


def ingest_cuad(conn):
    """CUAD_v1.json: SQuAD-style QA. No official split — create a documented,
    contract-level (not QA-pair-level) 80/10/10 split so a contract's clauses
    never leak across splits."""
    with open(RAW / "cuad" / "CUAD_v1.json") as f:
        cuad = json.load(f)

    contracts = cuad["data"]
    ids = list(range(len(contracts)))
    random.Random(SEED).shuffle(ids)
    n = len(ids)
    n_train, n_val = int(n * 0.8), int(n * 0.1)
    split_of = {}
    for i in ids[:n_train]:
        split_of[i] = "train"
    for i in ids[n_train:n_train + n_val]:
        split_of[i] = "val"
    for i in ids[n_train + n_val:]:
        split_of[i] = "test"

    n_clauses, n_positive = 0, 0
    for idx, contract in enumerate(contracts):
        title = contract["title"]
        split = split_of[idx]
        full_text = " ".join(p["context"] for p in contract["paragraphs"])
        conn.execute(
            "INSERT OR IGNORE INTO contracts (id, title, text, source, split) VALUES (?, ?, ?, ?, ?)",
            (title, title, full_text, "cuad", split),
        )
        for paragraph in contract["paragraphs"]:
            for qa in paragraph["qas"]:
                clause_type = qa["question"].split('"')[1] if '"' in qa["question"] else qa["question"]
                is_impossible = bool(qa.get("is_impossible", len(qa["answers"]) == 0))
                if qa["answers"]:
                    for ans in qa["answers"]:
                        conn.execute(
                            "INSERT INTO clauses (contract_id, clause_type, clause_text, answer_start, "
                            "is_impossible, split, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (title, clause_type, ans["text"], ans["answer_start"], 0, split, "cuad"),
                        )
                        n_positive += 1
                else:
                    conn.execute(
                        "INSERT INTO clauses (contract_id, clause_type, clause_text, answer_start, "
                        "is_impossible, split, source) VALUES (?, ?, NULL, NULL, 1, ?, ?)",
                        (title, clause_type, split, "cuad"),
                    )
                n_clauses += 1

    return {"contracts": n, "clause_rows": n_clauses, "positive_clause_spans": n_positive}


def ingest_contractnli(conn):
    """train.json / dev.json / test.json: official splits, real (premise,
    hypothesis, label) entailment triples."""
    n_docs, n_triples = 0, 0
    for split in ["train", "dev", "test"]:
        with open(RAW / "contractnli" / "contract-nli" / f"{split}.json") as f:
            data = json.load(f)

        hypotheses = data["labels"]
        split_name = "val" if split == "dev" else split

        for doc in data["documents"]:
            doc_id = doc["id"] if "id" in doc else doc["file_name"]
            conn.execute(
                "INSERT OR IGNORE INTO contracts (id, title, text, source, split) VALUES (?, ?, ?, ?, ?)",
                (str(doc_id), doc.get("file_name", str(doc_id)), doc["text"], "contractnli", split_name),
            )
            n_docs += 1

            spans = doc["spans"]
            for hyp_id, ann in doc["annotation_sets"][0]["annotations"].items():
                choice = ann["choice"]
                span_indices = ann.get("spans", [])
                premise = " ".join(
                    doc["text"][spans[i][0]:spans[i][1]] for i in span_indices if i < len(spans)
                )
                conn.execute(
                    "INSERT INTO nli_triples (contract_id, hypothesis_id, hypothesis_text, premise, "
                    "label, split, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (str(doc_id), hyp_id, hypotheses[hyp_id]["hypothesis"], premise, choice, split_name, "contractnli"),
                )
                n_triples += 1

    return {"documents": n_docs, "nli_triples": n_triples}


def main():
    conn = get_connection()

    cuad_stats = ingest_cuad(conn)
    nli_stats = ingest_contractnli(conn)

    conn.commit()

    total_contracts = conn.execute("SELECT COUNT(*) FROM contracts").fetchone()[0]

    print("=== ClauseGuard SQLite ingestion complete ===")
    print(f"CUAD: {cuad_stats}")
    print(f"ContractNLI: {nli_stats}")
    print(f"Total distinct contracts in DB: {total_contracts}")

    for source in ["cuad", "contractnli"]:
        for split in ["train", "val", "test"]:
            n = conn.execute(
                "SELECT COUNT(*) FROM contracts WHERE source=? AND split=?", (source, split)
            ).fetchone()[0]
            print(f"  {source} / {split}: {n} contracts")

    conn.close()


if __name__ == "__main__":
    main()
