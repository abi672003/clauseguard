"""Pre-fetch the two frozen transformer checkpoints into a local folder so the
app can run with no Hugging Face network call at request time.

  nlpaueb/legal-bert-base-uncased   - frozen encoder for clause embedding
  cross-encoder/nli-deberta-v3-base - microsoft/deberta-v3-base already tuned
                                      for 3-way NLI; used as the verifier

Only the PyTorch artefacts are fetched (no TF/Flax/ONNX duplicates).
"""
from __future__ import annotations

import sys
from pathlib import Path

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "backend" / "models_cache"

SPECS = [
    (
        "nlpaueb/legal-bert-base-uncased",
        ["config.json", "vocab.txt", "tokenizer_config.json",
         "special_tokens_map.json", "pytorch_model.bin"],
    ),
    (
        "cross-encoder/nli-deberta-v3-base",
        ["config.json", "model.safetensors", "spm.model", "tokenizer.json",
         "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json"],
    ),
]


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    for repo, patterns in SPECS:
        print(f"\n-> {repo}")
        path = snapshot_download(
            repo_id=repo,
            allow_patterns=patterns,
            local_dir=DEST / repo.replace("/", "__"),
            max_workers=4,
        )
        size = sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file())
        print(f"   cached at {path}  ({size / 1e6:.0f} MB)")
    print("\nAll checkpoints local. Set CLAUSEGUARD_HF_CACHE_DIR to this folder for offline use.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
