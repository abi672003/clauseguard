"""
Download the two real datasets ClauseGuard is built on.

  CUAD v1      - 510 commercial contracts, 13k+ expert clause annotations (CC BY 4.0)
                 https://huggingface.co/datasets/theatticusproject/cuad
  ContractNLI  - 607 NDAs with document-level entailment labels (CC BY 4.0)
                 https://stanfordnlp.github.io/contract-nli/

Only the annotation files are fetched, not the 500MB of source PDFs - the CUAD
JSON already embeds the full plain text of every contract, which is all the
pipeline needs.

Usage:  python scripts/download_data.py [--force]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"

CUAD_URL = (
    "https://huggingface.co/datasets/theatticusproject/cuad/"
    "resolve/main/CUAD_v1/CUAD_v1.json"
)
CONTRACT_NLI_URL = "https://stanfordnlp.github.io/contract-nli/resources/contract-nli.zip"


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}TB"


def download(url: str, dest: Path, force: bool = False) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        print(f"  [skip] {dest.name} already present ({_human(dest.stat().st_size)})")
        return dest

    print(f"  [get ] {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    headers = {"User-Agent": "ClauseGuard/1.0"}
    with requests.get(url, headers=headers, stream=True, timeout=180) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length") or 0)
        read = 0
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
                read += len(chunk)
                if total:
                    print(f"\r         {100 * read / total:5.1f}%  "
                          f"{_human(read)} / {_human(total)}", end="")
                else:
                    print(f"\r         {_human(read)}", end="")
    print()
    tmp.replace(dest)
    print(f"  [ok  ] {dest.name}  {_human(dest.stat().st_size)}")
    return dest


def fetch_cuad(force: bool) -> None:
    print("\nCUAD v1 (Atticus Project, CC BY 4.0)")
    path = download(CUAD_URL, RAW / "cuad" / "CUAD_v1.json", force)
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    contracts = payload.get("data", [])
    qas = sum(len(p["qas"]) for c in contracts for p in c["paragraphs"])
    answered = sum(
        1 for c in contracts for p in c["paragraphs"] for q in p["qas"] if not q.get("is_impossible")
    )
    print(f"  -> {len(contracts)} contracts, {qas} clause questions, {answered} with gold spans")


def fetch_contract_nli(force: bool) -> None:
    print("\nContractNLI (Stanford NLP, CC BY 4.0)")
    zpath = download(CONTRACT_NLI_URL, RAW / "contract_nli" / "contract-nli.zip", force)
    out = RAW / "contract_nli"
    marker = out / "train.json"
    if marker.exists() and not force:
        print("  [skip] already extracted")
    else:
        with zipfile.ZipFile(zpath) as zf:
            members = [m for m in zf.namelist() if m.endswith(".json")]
            for m in members:
                target = out / Path(m).name
                with zf.open(m) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                print(f"  [ok  ] extracted {Path(m).name}")
    for split in ("train", "dev", "test"):
        p = out / f"{split}.json"
        if p.exists():
            with open(p, encoding="utf-8") as fh:
                d = json.load(fh)
            docs = d.get("documents", [])
            labels = sum(len(doc.get("annotation_sets", [{}])[0].get("annotations", {})) for doc in docs)
            print(f"  -> {split}: {len(docs)} documents, {labels} hypothesis labels")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    print("ClauseGuard :: dataset acquisition")
    print(f"target: {RAW}")
    fetch_cuad(args.force)
    fetch_contract_nli(args.force)
    print("\nDone. Both datasets are real, licensed CC BY 4.0, and used as-is.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
