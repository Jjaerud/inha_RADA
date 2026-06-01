"""Mock vs Claude 분기 검증 — runner.py."""
from __future__ import annotations

import pytest

from ml_server.agent import runner

from .fixtures import seed_history, normal_metrics, anomaly_metrics

pytestmark = pytest.mark.integration


AGENT_KEYS = {"judgment", "severity", "reason", "action", "hw_degradation"}


def test_mock_agent_when_no_api_key(client, monkeypatch):
    """ANTHROPIC_API_KEY 미설정 → Mock agent 사용. agent dict 키 검증."""
    monkeypatch.setattr(runner, "USE_REAL_CLAUDE", False, raising=True)

    seed_history(client, pc_id="pc-AG1", slot="class", n=60)
    # known_miner 포함 → MEDIUM 이상 보장(agent 는 점검 이상만 호출).
    payload = anomaly_metrics(pc_id="pc-AG1", slot="class", idx=300, top_processes=[
        {"name": "xmrig.exe", "cpu_percent": 95.0,
         "memory_percent": 40.0, "path": "C:\\Temp\\xmrig.exe"},
    ])
    client.post("/analyze", json=payload)
    r = client.post("/analyze", json=payload)
    body = r.json()
    assert body["agent"] is not None
    missing = AGENT_KEYS - set(body["agent"].keys())
    assert not missing, f"agent missing keys: {missing}"


def test_agent_skipped_on_normal(client, monkeypatch):
    """overall_severity == NORMAL 이면 agent 호출되지 않고 None."""
    monkeypatch.setattr(runner, "USE_REAL_CLAUDE", False, raising=True)

    r = client.post("/analyze",
                    json=normal_metrics(pc_id="pc-AG2", slot="class", idx=0))
    body = r.json()
    assert body["overall_severity"] == "NORMAL"
    assert body["agent"] is None


def test_agent_skipped_on_observe(client, monkeypatch):
    """관찰(LOW/OBSERVE)에선 agent 미호출 — 점검(MEDIUM) 이상만 AI 판단.

    anomaly_metrics(known_miner 없음)는 final≈7 → OBSERVE/LOW 로 떨어진다.
    새 정책상 MEDIUM 미만은 LLM 을 돌리지 않는다(Spring P0-1 이 어차피
    LOW/OBSERVE 를 저장하지 않으므로 호출=낭비)."""
    monkeypatch.setattr(runner, "USE_REAL_CLAUDE", False, raising=True)

    seed_history(client, pc_id="pc-AGo", slot="class", n=60)
    payload = anomaly_metrics(pc_id="pc-AGo", slot="class", idx=300)
    client.post("/analyze", json=payload)
    body = client.post("/analyze", json=payload).json()
    # MEDIUM/HIGH 가 아니면(=관찰/정상) agent 는 호출되지 않는다.
    assert body["overall_severity"] not in ("MEDIUM", "HIGH")
    assert body["agent"] is None


def test_claude_branch_invoked_when_enabled(client, monkeypatch):
    """USE_REAL_CLAUDE=True 일 때 call_claude_api 가 호출되어야 한다."""
    called = {"n": 0}

    def fake_call(prompt: str) -> dict:
        called["n"] += 1
        return {"judgment": "SUSPICIOUS", "severity": "HIGH",
                "reason": "테스트 가짜 응답.",
                "action": "테스트 권고.",
                "hw_degradation": "NONE"}

    monkeypatch.setattr(runner, "USE_REAL_CLAUDE", True, raising=True)
    monkeypatch.setattr(runner, "call_claude_api", fake_call, raising=True)

    seed_history(client, pc_id="pc-AG3", slot="class", n=60)
    # known_miner 포함 → MEDIUM 이상 보장(agent 는 점검 이상만 호출).
    payload = anomaly_metrics(pc_id="pc-AG3", slot="class", idx=300, top_processes=[
        {"name": "xmrig.exe", "cpu_percent": 95.0,
         "memory_percent": 40.0, "path": "C:\\Temp\\xmrig.exe"},
    ])
    client.post("/analyze", json=payload)
    r = client.post("/analyze", json=payload)
    body = r.json()
    assert called["n"] >= 1
    assert body["agent"]["judgment"] == "SUSPICIOUS"
