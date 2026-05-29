"""Risk-vector interpretation layer (ADDITIVE — does not alter verdict/final).

Reuses the exact same `signals` + `indicators` already computed for the
existing score path, and re-projects them onto four risk axes so the system
expresses *what kind* of anomaly, not just *how anomalous*:

    mining       무단 연산/채굴 (CPU/GPU flat, power flat, low VRAM, miner/pool)
    malfunction  오작동/runaway/루프 (고부하인데 진척 없음, dos burst)
    aging        노후화/하드웨어 이상 (stealth mismatch, mem pressure, thermal)
    threat       보안 이상/외부 통신 (persistent endpoint, unknown proc + net, exec path)

Output is attached to the response `scores.risk_vector` as a parallel block.
The legacy `verdict` / `final` path is untouched, so this can be validated in
production for a while before anything depends on it. Weights are deliberate
v0 estimates; tune against tests/integration/test_sustained_scenarios.py.

NOTE: several high-value signals (single_core_full, process_recreation,
per-core CPU, exe hash/signer, thermal trend) are not yet collected — those
axes (esp. malfunction/aging) stay conservative until Phase 2 enrichment.
"""
from __future__ import annotations

from typing import Any, Dict

# Axis weight tables — signal name → points. Kept explicit for easy tuning.
_MINING = {
    "gpu_flat": 3,
    "cpu_flat": 3,
    "vram_low": 2,
    "power_stable": 1,
    "sm_high": 1,
    "mining_pool_ip": 5,
    "known_miner": 5,
    "mining_process_or_pool": 4,
    "persistent_miner": 3,
    "single_core_full": 3,  # #3 Phase 2: 단일 코어 풀가동 = 단일 스레드 채굴 시그니처
}
# #7: episode 신호(dos_spike, persistent_ext)는 legacy 의 단일 "episode" 점수로
# 뭉뚱그려졌으나, 위험 *종류* 가 다르다. risk_vector 에서는 의미에 맞게 분리한다:
#   - dos_spike     = inbound 폭주(외부→이PC). 이 PC 의 오작동이 아니라
#                     표적/네트워크 보안 이벤트 → threat 축.
#   - persistent_ext = 지속 외부 endpoint → threat 축(이미 반영).
# malfunction 축은 "고부하인데 진척 없음(runaway/stuck)" 에 집중한다
#   - mem_critical = 메모리 포화(runaway proxy), cpu_high stuck-loop combo.
_MALFUNCTION = {
    "mem_critical": 2,
}
_AGING = {
    "stealth_mismatch_power": 3,
    "stealth_mismatch_vram": 3,
    "mem_critical": 1,
    "mem_high": 1,
}
_THREAT = {
    "persistent_ext": 2,
    "net_external_high": 1,
    "outbound_spike": 3,
    "exec_path_suspicious": 1,
    "appdata_exec": 1,
    "temp_exec": 1,
    "new_remote_ip_burst": 1,
    "mining_pool_ip": 2,
    "dos_spike": 2,  # #7: inbound 폭주 = 표적/네트워크 보안 이벤트
    # #3 Phase 2: 의심 경로(appdata/temp) 프로세스가 외부 연결을 소유.
    # 저-CPU 라 top_processes 에 안 잡혀도 직접 귀속된 강한 위협 근거.
    "external_conn_suspicious_owner": 3,
    # #6 Phase 2: PID churn(watchdog 식 재생성) = 지속성/회피 행위.
    "process_recreation": 2,
}

# Combination bonuses (signal pairs that are stronger together than apart).
def _combo(signals: Dict[str, Any]) -> Dict[str, int]:
    g = lambda k: bool(signals.get(k))
    bonus = {"mining": 0, "malfunction": 0, "aging": 0, "threat": 0}
    # mining: flat high load on both + idle user
    if g("cpu_flat") and g("gpu_flat"):
        bonus["mining"] += 2
    if g("gpu_flat") and g("power_stable") and g("vram_low"):
        bonus["mining"] += 2
    # threat: unknown/appdata process actively talking out
    if g("unknown_process_active") and g("net_out_sustained"):
        bonus["threat"] += 3
    if g("appdata_exec") and g("net_out_sustained"):
        bonus["threat"] += 2
    if g("disk_write_net_out_sustained"):
        bonus["threat"] += 2
    # #7: inbound 폭주 + 지속 외부 endpoint = 단발 spike 보다 강한 표적 신호
    if g("dos_spike") and g("persistent_ext"):
        bonus["threat"] += 2
    # #3 Phase 2: 의심 경로 소유 프로세스가 지속 outbound = 능동 유출 의심
    if g("external_conn_suspicious_owner") and g("net_out_sustained"):
        bonus["threat"] += 2
    # #3 Phase 2: 단일 코어 풀가동이 flat 하게 지속 = 채굴 루프 신뢰도 강화
    if g("single_core_full") and g("cpu_flat"):
        bonus["mining"] += 1
    # malfunction: sustained high CPU with no useful disk/net work (stuck loop proxy)
    if g("cpu_high") and not g("net_out_sustained") and not g("disk_write_net_out_sustained") \
            and not g("known_miner") and not g("mining_pool_ip"):
        bonus["malfunction"] += 2
    return bonus


_PRIMARY_LABEL = {
    "mining": "MINING_SUSPICION",
    "malfunction": "MALFUNCTION",
    "aging": "AGING",
    "threat": "THREAT_SUSPICION",
}

# An axis must clear this to be considered the primary type; otherwise NORMAL.
_PRIMARY_FLOOR = 4


def compute_risk_vector(signals: Dict[str, Any],
                        indicators: Dict[str, int] | None = None) -> Dict[str, Any]:
    """Project signals onto 4 risk axes. Pure function, no side effects."""
    signals = signals or {}
    axes = {"mining": 0, "malfunction": 0, "aging": 0, "threat": 0}

    for k, w in _MINING.items():
        if signals.get(k):
            axes["mining"] += w
    for k, w in _MALFUNCTION.items():
        if signals.get(k):
            axes["malfunction"] += w
    for k, w in _AGING.items():
        if signals.get(k):
            axes["aging"] += w
    for k, w in _THREAT.items():
        if signals.get(k):
            axes["threat"] += w

    for axis, b in _combo(signals).items():
        axes[axis] += b

    # primary type = highest axis above floor, else NORMAL
    top_axis = max(axes, key=lambda a: axes[a])
    primary = _PRIMARY_LABEL[top_axis] if axes[top_axis] >= _PRIMARY_FLOOR else "NORMAL"

    return {
        "mining":       axes["mining"],
        "malfunction":  axes["malfunction"],
        "aging":        axes["aging"],
        "threat":       axes["threat"],
        "primary_type": primary,
    }
