from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

# Point the app at a scratch database before anything imports settings.
_tmpdir = tempfile.mkdtemp(prefix="clauseguard-test-")
os.environ.setdefault("CLAUSEGUARD_DATABASE_URL", f"sqlite:///{_tmpdir}/test.sqlite3")
os.environ.setdefault("CLAUSEGUARD_ENV", "test")
os.environ.setdefault("CLAUSEGUARD_DEVICE", "cpu")
os.environ.setdefault("CLAUSEGUARD_CHROMA_DIR", f"{_tmpdir}/chroma")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


@pytest.fixture(scope="session")
def db_session():
    from app.db.session import SessionLocal, init_db

    init_db()
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def cuad_text() -> str:
    from app.eval import cuad

    if not cuad.available():
        pytest.skip("CUAD not downloaded")
    return cuad.load_contracts("test")[0].text
