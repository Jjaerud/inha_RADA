"""Sustained behavior-path scenario suite.

Fills the gap the 30-second smoke triggers can't reach: R1~R8 + category
gating that require 30~180 min of sustained signal. Each scenario replays a
synthetic time-series (timestamp-driven aggregation) and asserts the verdict
tier band.

NOTE: these assertions encode the *intended* behavior. A failing test here is
a finding, not necessarily a bug — it tells us where the sustained path under-
or over-fires versus design intent. Run with `-s` to see the verdict table.
"""
from __future__ import annotations

import pytest

from . import scenario_replay as sr

pytestmark = pytest.mark.integration


def _summary(body: dict) -> str:
    return (
        f"verdict={body.get('verdict')} severity={body.get('overall_severity')} "
        f"final={(body.get('scores') or {}).get('final')} "
        f"top_alert={((body.get('alerts') or [{}])[0] or {}).get('type')}"
    )


# ── Negative scenarios — must NOT escalate (FP guards) ──────────────────

def test_normal_idle_stays_normal(client, capsys):
    body = sr.replay(client, "pc-sc-normal", sr.sc_normal_idle, duration_min=35)
    print(f"\n[normal_idle] {_summary(body)}")
    assert body["verdict"] in ("NORMAL", "OBSERVE"), _summary(body)
    assert body["overall_severity"] in ("NORMAL", "LOW"), _summary(body)


def test_game_render_not_high(client):
    """정상 GPU 고부하 (게임/렌더) — HIGH_RISK 면 오탐."""
    body = sr.replay(client, "pc-sc-game", sr.sc_game_render, duration_min=35)
    print(f"\n[game_render] {_summary(body)}")
    assert body["verdict"] != "HIGH_RISK", _summary(body)


def test_network_load_only_not_high(client):
    """순수 네트워크 부하 — CPU/GPU 낮은데 HIGH 면 오탐."""
    body = sr.replay(client, "pc-sc-netload", sr.sc_network_load_only, duration_min=35)
    print(f"\n[network_load_only] {_summary(body)}")
    # FP-fix #1: network-only 는 SUSPICIOUS 로도 안 가야 한다 (최대 OBSERVE).
    assert body["verdict"] in ("NORMAL", "OBSERVE"), _summary(body)


def test_network_only_exfil_capped_to_observe(client):
    """pilot FP 재현 (PC-01/03 EXFIL/DOS) — network-only 약신호가 SUSPICIOUS 까지
    올라가도 #1 cap 으로 OBSERVE 이하. 자원/채굴/PID귀속 근거가 없을 때.

    긴 저부하 history(IF 학습 + 낮은 평균) 뒤 말미 네트워크 버스트로 구성:
    outbound_spike/dos_spike 는 baseline 대비 transient 라야 발화하므로.
    """
    import datetime
    base = datetime.datetime(2026, 5, 4, 22, 0, 0)
    pc = "pc-netfp"
    last: dict = {}
    n_seed, n_burst = 66, 6
    for i in range(n_seed + n_burst):
        ts = base + datetime.timedelta(seconds=i * 20)
        burst = i >= n_seed
        dos = i >= (n_seed + n_burst - 3)  # 말미 3개 inbound 급증 → dos_spike
        snap = sr.build_snapshot(
            pc, ts,
            cpu=float(14 + (i % 5)), gpu=float(4 + (i % 3)),  # 낮음 (network-only)
            out_mb=(3.0 if burst else 0.02),       # 버스트에서 outbound_spike
            in_mb=(60.0 if dos else 0.04),         # 말미 dos_spike (낮은 avg 대비)
            ext_packets=(40 if burst else 2),       # net_external_high + persistent
            external_connections=[{"ip": "203.0.113.50", "port": 443,
                                   "status": "ESTABLISHED", "pid": 7300}],
            top_processes=[{"name": "chrome.exe", "cpu_percent": 10.0,
                            "memory_percent": 12.0,
                            "path": "C:\\Program Files\\Chrome\\chrome.exe"}],
        )
        r = client.post("/analyze", json=snap)
        assert r.status_code == 200, r.text
        last = r.json()
    em = last.get("evidence_meta", {})
    print(f"\n[network_only_exfil] {_summary(last)} "
          f"capped={em.get('network_only_capped')} from={em.get('network_only_capped_from')}")
    # 핵심 불변식: network-only 는 SUSPICIOUS 로 승격되지 않는다.
    assert last["verdict"] in ("NORMAL", "OBSERVE"), _summary(last)
    assert last["overall_severity"] in ("NORMAL", "LOW"), _summary(last)


# ── Positive scenarios — should escalate ───────────────────────────────

def test_known_miner_high_risk(client):
    """known miner (xmrig + pool) — fast-path 즉시 HIGH_RISK."""
    body = sr.replay(client, "pc-sc-known", sr.sc_known_miner, duration_min=10)
    print(f"\n[known_miner] {_summary(body)}")
    assert body["verdict"] == "HIGH_RISK", _summary(body)


def test_cpu_mining_sustained_escalates(client):
    """CPU-only 채굴 유사, 35분 지속 — SUSPICIOUS 이상 기대."""
    body = sr.replay(client, "pc-sc-cpumine", sr.sc_cpu_mining, duration_min=35)
    print(f"\n[cpu_mining_sustained] {_summary(body)}")
    assert body["verdict"] in ("SUSPICIOUS", "HIGH_RISK"), _summary(body)


def test_gpu_mining_sustained_escalates(client):
    """GPU 채굴 유사 (flat high + power flat + low VRAM), 35분 — SUSPICIOUS 이상."""
    body = sr.replay(client, "pc-sc-gpumine", sr.sc_gpu_mining, duration_min=35)
    print(f"\n[gpu_mining_sustained] {_summary(body)}")
    assert body["verdict"] in ("SUSPICIOUS", "HIGH_RISK"), _summary(body)
