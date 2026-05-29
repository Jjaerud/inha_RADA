"""risk_vector 해석 레이어 — additive 4축 분류 검증."""
from __future__ import annotations

from collections import defaultdict

from ml_server.scorer.risk_vector import compute_risk_vector


def _sig(**over):
    s = defaultdict(lambda: False)
    s.update(over)
    return s


def test_all_quiet_is_normal():
    rv = compute_risk_vector(_sig())
    assert rv["primary_type"] == "NORMAL"
    assert rv["mining"] == 0 and rv["threat"] == 0


def test_gpu_mining_signals_pick_mining():
    rv = compute_risk_vector(_sig(
        gpu_flat=True, cpu_flat=True, vram_low=True, power_stable=True, sm_high=True,
    ))
    assert rv["primary_type"] == "MINING_SUSPICION"
    assert rv["mining"] >= rv["threat"]


def test_known_miner_dominates_mining():
    rv = compute_risk_vector(_sig(known_miner=True, mining_process_or_pool=True))
    assert rv["primary_type"] == "MINING_SUSPICION"
    assert rv["mining"] >= 9


def test_unknown_process_outbound_picks_threat():
    rv = compute_risk_vector(_sig(
        unknown_process_active=True, net_out_sustained=True,
        appdata_exec=True, persistent_ext=True, net_external_high=True,
    ))
    assert rv["primary_type"] == "THREAT_SUSPICION"
    assert rv["threat"] >= rv["mining"]


def test_stealth_mismatch_picks_aging():
    rv = compute_risk_vector(_sig(
        stealth_mismatch_power=True, stealth_mismatch_vram=True,
    ))
    assert rv["primary_type"] == "AGING"


def test_below_floor_stays_normal():
    # single weak signal under the primary floor → NORMAL
    rv = compute_risk_vector(_sig(net_external_high=True))
    assert rv["primary_type"] == "NORMAL"


def test_dos_spike_routes_to_threat_not_malfunction():
    # #7: dos_spike(inbound 폭주)는 이 PC의 오작동이 아니라 표적 보안 이벤트 → threat 축
    rv = compute_risk_vector(_sig(dos_spike=True))
    assert rv["threat"] == 2
    assert rv["malfunction"] == 0


def test_dos_plus_persistent_ext_picks_threat():
    # #7: inbound 폭주 + 지속 외부 endpoint = combo 가산으로 threat 우세
    rv = compute_risk_vector(_sig(dos_spike=True, persistent_ext=True))
    # dos_spike(2) + persistent_ext(2) + combo(2) = 6 ≥ floor
    assert rv["threat"] >= 4
    assert rv["primary_type"] == "THREAT_SUSPICION"


def test_mem_critical_still_malfunction_axis():
    # malfunction 축은 mem pressure(runaway proxy)를 유지
    rv = compute_risk_vector(_sig(mem_critical=True))
    assert rv["malfunction"] == 2
