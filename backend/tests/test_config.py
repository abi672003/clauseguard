"""Settings parsing, including the forms real deployments actually use.

The docker-compose file passes CLAUSEGUARD_CORS_ORIGINS as a comma-separated
string. pydantic-settings JSON-decodes complex-typed fields in EnvSettingsSource
*before* any validator runs, so without NoDecode that raised SettingsError at
import time and the container crash-looped on boot. No test covered it because
the test suite never set that variable.
"""
from __future__ import annotations

import pytest

from app.core.config import Settings


@pytest.mark.parametrize("raw,expected", [
    ("http://a.com,http://b.com", ["http://a.com", "http://b.com"]),
    ("http://a.com, http://b.com ", ["http://a.com", "http://b.com"]),
    ("http://only.com", ["http://only.com"]),
    ('["http://a.com","http://b.com"]', ["http://a.com", "http://b.com"]),
])
def test_cors_origins_accepts_every_documented_form(monkeypatch, raw, expected) -> None:
    monkeypatch.setenv("CLAUSEGUARD_CORS_ORIGINS", raw)
    assert Settings().cors_origins == expected


def test_cors_origins_default_is_local_dev(monkeypatch) -> None:
    monkeypatch.delenv("CLAUSEGUARD_CORS_ORIGINS", raising=False)
    assert "http://localhost:5173" in Settings().cors_origins


def test_the_compose_file_value_actually_boots(monkeypatch) -> None:
    """Guard the exact string docker-compose.yml ships."""
    monkeypatch.setenv("CLAUSEGUARD_CORS_ORIGINS",
                       "http://localhost:7860,http://localhost:5173")
    assert Settings().cors_origins == ["http://localhost:7860", "http://localhost:5173"]


def test_thresholds_are_floats_from_env(monkeypatch) -> None:
    monkeypatch.setenv("CLAUSEGUARD_ENTAILMENT_THRESHOLD", "0.42")
    assert Settings().entailment_threshold == pytest.approx(0.42)


def test_has_llm_requires_both_key_and_enabled(monkeypatch) -> None:
    monkeypatch.setenv("CLAUSEGUARD_ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("CLAUSEGUARD_AGENT_ENABLED", "true")
    assert Settings().has_llm is True
    monkeypatch.setenv("CLAUSEGUARD_AGENT_ENABLED", "false")
    assert Settings().has_llm is False
    monkeypatch.delenv("CLAUSEGUARD_ANTHROPIC_API_KEY")
    monkeypatch.setenv("CLAUSEGUARD_AGENT_ENABLED", "true")
    assert Settings().has_llm is False
