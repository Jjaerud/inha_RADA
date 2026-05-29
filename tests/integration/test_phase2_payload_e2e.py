"""Phase 2 페이로드 ↔ /analyze 전체 경로 호환성 검증 (배포 안전).

클라이언트가 새로 보내는 필드(external_connections 에 pid/proc_name/proc_path,
derived_features 에 per_core_cpu_percent/single_core_max_percent)가
서버 MetricsRequest 에서 거부되지 않고, additive 해석 레이어까지 흐르는지 확인.
legacy 응답 키는 그대로 보존돼야 한다.
"""
from __future__ import annotations

import pytest

from .fixtures import normal_metrics

pytestmark = pytest.mark.integration


def _phase2_payload(pc_id: str) -> dict:
    """Phase 2 신규 sub-dict 필드를 포함한 정상 베이스 페이로드."""
    p = normal_metrics(pc_id=pc_id, slot="free", idx=0)
    # #3 외부 연결 소유 프로세스 (appdata 소유 = 의심)
    p["external_connections"] = [
        {"ip": "203.0.113.9", "port": 4444, "status": "ESTABLISHED",
         "pid": 9999, "proc_name": "svhost.exe",
         "proc_path": "C:\\Users\\u\\AppData\\Roaming\\svhost.exe"},
    ]
    p["external_packet_count"] = 9
    # #3 per-core (한 코어 풀가동, 전체는 낮음 ≈ per_core 평균 13%)
    p["cpu_percent"] = 13.0
    p["cpu_core_count"] = 8
    p["derived_features"] = {
        "per_core_cpu_percent": [99, 3, 1, 0, 2, 0, 1, 0],
        "single_core_max_percent": 99.0,
    }
    return p


def test_phase2_fields_accepted_and_additive_layers_present(client):
    r = client.post("/analyze", json=_phase2_payload("pc-p2-1"))
    assert r.status_code == 200, r.text
    body = r.json()

    # additive 레이어 노출
    assert "signal_quality" in body
    assert "explanation_confidence" in body
    assert "risk_vector" in body["scores"]
    rv = body["scores"]["risk_vector"]
    assert set(rv.keys()) >= {"mining", "malfunction", "aging", "threat", "primary_type"}

    # Phase 2 신호가 signals 에 노출
    sig = body["signals"]
    assert sig.get("external_conn_suspicious_owner") is True
    assert sig.get("single_core_full") is True

    # 의심 소유 연결 → threat, single_core → mining 으로 재투영
    assert rv["threat"] >= 3
    assert rv["mining"] >= 3


def test_phase2_legacy_keys_preserved(client):
    """신규 필드가 와도 기존 응답 계약(22키 계열) 보존."""
    r = client.post("/analyze", json=_phase2_payload("pc-p2-2"))
    body = r.json()
    for k in ("overall_severity", "verdict", "alerts", "scores",
              "signals", "category_signals", "policy_version"):
        assert k in body, f"missing legacy key: {k}"
    # score_breakdown 9키 보존
    for k in ("resource", "network", "process", "episode",
              "correlation", "ml", "retrieval", "context_discount", "final"):
        assert k in body["scores"]["score_breakdown"]


def test_payload_without_phase2_fields_still_works(client):
    """구버전 클라이언트(신규 필드 없음)도 그대로 동작 — 하위호환."""
    r = client.post("/analyze", json=normal_metrics(pc_id="pc-p2-3", slot="free"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["signals"].get("external_conn_suspicious_owner") is False
    assert body["signals"].get("single_core_full") is False
