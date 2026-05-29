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
    assert body["verdict"] != "HIGH_RISK", _summary(body)


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
