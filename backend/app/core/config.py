"""Central configuration. Every tunable lives here and is overridable by env var."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env"), env_prefix="CLAUSEGUARD_", extra="ignore"
    )

    # ---------------------------------------------------------------- app
    app_name: str = "ClauseGuard"
    version: str = "1.0.0"
    env: Literal["dev", "prod", "test"] = "dev"
    api_prefix: str = "/api/v1"
    # NoDecode is required, not stylistic. pydantic-settings JSON-decodes any
    # complex-typed field in EnvSettingsSource *before* validators run, so a
    # plain comma-separated CLAUSEGUARD_CORS_ORIGINS raises SettingsError at
    # import time and the process never starts. NoDecode hands the raw string
    # to the validator below instead.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://localhost:4173",
            "http://127.0.0.1:5173",
        ]
    )

    # ------------------------------------------------------------ storage
    data_dir: Path = ROOT_DIR / "data"
    artifacts_dir: Path = BACKEND_DIR / "artifacts"
    database_url: str = f"sqlite:///{BACKEND_DIR / 'artifacts' / 'clauseguard.sqlite3'}"
    chroma_dir: Path = ROOT_DIR / "data" / "chroma"
    upload_dir: Path = ROOT_DIR / "data" / "uploads"

    # ------------------------------------------------------------- models
    # Frozen encoder used for span embedding + prototype classification.
    extractor_model: str = "nlpaueb/legal-bert-base-uncased"
    # DeBERTa-v3-base already fine-tuned for natural language inference.
    verifier_model: str = "cross-encoder/nli-deberta-v3-base"
    hf_cache_dir: Path | None = None
    device: Literal["auto", "cpu", "mps", "cuda"] = "auto"
    max_seq_len: int = 384
    embed_batch_size: int = 16
    verify_batch_size: int = 8

    # --------------------------------------------------------- thresholds
    # Calibrated on the real ContractNLI dev split by scripts/calibrate.py;
    # these defaults are the values that calibration produced.
    # Fitted by scripts/calibrate.py on the real ContractNLI dev split at a
    # 0.95 target precision, then confirmed on the held-out test split:
    # false-obligation rate 68.4% (no verifier) -> 7.0% (verifier on).
    # These are read back from artifacts/calibration.json at runtime; the values
    # here are the fallback and are kept in step with it deliberately.
    entailment_threshold: float = 0.14
    contradiction_threshold: float = 0.50
    uncertain_band: float = 0.09

    # Legal-BERT's mean-pooled embedding space is strongly anisotropic: on real
    # contract text every span sits at cosine 0.83-0.96 to everything else, and
    # the whole discriminative signal lives in a margin band of roughly +/-0.02.
    # These are therefore derived from the prototype bank's fitted accept margin
    # rather than set by hand - an absolute cosine floor is meaningless here.
    # `prototype_min_cosine = None` disables the absolute gate entirely.
    prototype_min_cosine: float | None = None
    # Pre-filtering is recall-oriented: it sits below the fitted margin by this
    # band so the extractor, not the filter, makes the accept decision.
    prefilter_recall_band: float = 0.01
    prefilter_top_k: int = 160
    prefilter_min_score: float | None = None
    verifier_enabled: bool = True

    # -------------------------------------------------------------- agent
    anthropic_api_key: str | None = None
    agent_model: str = "claude-haiku-4-5-20251001"
    agent_max_tokens: int = 900
    agent_enabled: bool = True
    agent_timeout_s: float = 30.0

    # ------------------------------------------------------------ ingest
    max_upload_mb: int = 20
    min_clause_chars: int = 60
    max_clause_chars: int = 2400

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """Accept both a comma-separated string and a JSON array."""
        if isinstance(v, str):
            raw = v.strip()
            if raw.startswith("["):
                import json

                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    pass
            return [o.strip() for o in raw.split(",") if o.strip()]
        return v

    @property
    def has_llm(self) -> bool:
        return bool(self.anthropic_api_key) and self.agent_enabled

    def ensure_dirs(self) -> None:
        for p in (self.data_dir, self.artifacts_dir, self.chroma_dir, self.upload_dir):
            Path(p).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s


settings = get_settings()
