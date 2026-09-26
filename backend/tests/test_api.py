"""End-to-end API surface. Uses the real app and a scratch database."""
from __future__ import annotations

import pytest


def test_health_reports_real_state(client) -> None:
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "prototype_bank" in body["models_loaded"]
    assert isinstance(body["db_contracts"], int)


def test_meta_declares_provenance(client) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["models"]["verifier"]["base"] == "microsoft/deberta-v3-base"
    assert body["models"]["extractor"]["trained"] is False
    assert body["models"]["verifier"]["trained"] is False
    assert body["datasets"]["CUAD"]["license"] == "CC BY 4.0"


def test_contract_listing_is_paginated(client) -> None:
    r = client.get("/api/v1/contracts", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items", "total"}
    assert len(body["items"]) <= 5


def test_text_ingest_creates_a_contract(client) -> None:
    text = (
        "SERVICES AGREEMENT\n\n"
        "This Agreement is made as of March 1, 2024 by and between Acme Corp and "
        "Beta Ltd.\n\n"
        "1. TERM. This Agreement shall automatically renew for successive one (1) "
        "year terms unless either party provides ninety (90) days prior written "
        "notice of its intent not to renew.\n\n"
        "2. INSURANCE. Supplier shall maintain comprehensive general liability "
        "insurance with coverage of not less than $2,000,000 per occurrence "
        "throughout the Term.\n\n"
        "3. GOVERNING LAW. This Agreement shall be governed by the laws of the "
        "State of Delaware.\n"
    )
    r = client.post("/api/v1/contracts/text",
                    json={"title": "Test Services Agreement", "text": text,
                          "analyze": False})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Test Services Agreement"
    assert body["governing_law"] == "Delaware"
    assert body["status"] == "pending"

    detail = client.get(f"/api/v1/contracts/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["char_count"] == len(text)


def test_unknown_contract_is_404(client) -> None:
    assert client.get("/api/v1/contracts/does-not-exist").status_code == 404


def test_rejects_unsupported_upload_type(client) -> None:
    r = client.post("/api/v1/contracts/upload",
                    files={"file": ("x.exe", b"MZ\x00binary", "application/octet-stream")},
                    data={"analyze": "false"})
    assert r.status_code == 415


def test_short_text_is_rejected_by_validation(client) -> None:
    r = client.post("/api/v1/contracts/text",
                    json={"title": "too short", "text": "nope", "analyze": False})
    assert r.status_code == 422


def test_obligation_filters_accept_every_documented_parameter(client) -> None:
    r = client.get("/api/v1/obligations", params={
        "status": "auto_tracked", "type": "deadline", "severity": "high",
        "verdict": "grounded", "limit": 10, "offset": 0,
    })
    assert r.status_code == 200
    assert set(r.json()) == {"items", "total"}


def test_invalid_status_patch_is_rejected(client) -> None:
    r = client.patch("/api/v1/obligations/nope/status", json={"status": "banana"})
    assert r.status_code == 422


def test_calendar_returns_a_day_bucketed_shape(client) -> None:
    body = client.get("/api/v1/obligations/calendar",
                      params={"from": "2024-01-01", "to": "2030-01-01"}).json()
    assert "days" in body and isinstance(body["days"], list)


def test_review_queue_and_stats(client) -> None:
    assert set(client.get("/api/v1/review/queue").json()) == {"items", "total"}
    stats = client.get("/api/v1/review/stats").json()
    assert set(stats) == {"open", "approved", "rejected", "mean_age_hours"}


def test_dashboard_exposes_the_headline_metric(client) -> None:
    body = client.get("/api/v1/analytics/dashboard").json()
    for key in ("contracts", "obligations", "grounded", "ungrounded", "uncertain",
                "hallucination_rate_blocked", "by_type", "by_severity",
                "by_month", "verdict_scatter"):
        assert key in body, key


def test_calibration_endpoint_is_always_answerable(client) -> None:
    body = client.get("/api/v1/analytics/calibration").json()
    assert "available" in body


def test_ablation_listing_is_a_list(client) -> None:
    assert isinstance(client.get("/api/v1/analytics/ablation").json(), list)


def test_ablation_rejects_an_unknown_mode(client) -> None:
    r = client.post("/api/v1/analytics/ablation/run",
                    json={"mode": "nonsense", "n_samples": 10})
    assert r.status_code == 422


@pytest.mark.slow
def test_seeding_loads_real_cuad_contracts(client) -> None:
    from app.eval import cuad

    if not cuad.available():
        pytest.skip("CUAD not downloaded")
    r = client.post("/api/v1/contracts/seed", json={"limit": 2, "analyze": False})
    assert r.status_code == 201, r.text
    seeded = r.json()["seeded"]
    assert len(seeded) == 2
    for c in seeded:
        assert c["source"] == "cuad"
        assert c["char_count"] > 2000
