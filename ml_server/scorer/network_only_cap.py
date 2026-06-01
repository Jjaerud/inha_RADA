"""FP-fix #1 (pilot 2026-05): network-only 약신호 verdict cap.

네트워크 신호만 활성이고 자원/시스템 시그니처·강한 프로세스 근거가 없으면
verdict 를 최대 OBSERVE 로 cap. PID 귀속 없는 EXFIL/DOS 류 FP 차단.

면제(cap 안 함):
  - known_miner / mining_pool fast-path
  - Phase2 PID 귀속(external_conn_suspicious_owner)
  - single_core_full / process_recreation
  - 채굴 자원 패턴(gpu_flat/cpu_flat/stealth mismatch 등 _RES_SYS)

cap 시 직전 verdict 를 만든 alert 들의 severity 를 LOW 로 클램프하고
``network_only_capped`` 마킹을 단다. type/detail 은 식별자/evidence 라 보존.

DB 저장 경로는 P0-1 (AlertService) 의 LOW/OBSERVE skip 으로 이미 안전 — cap 된
응답은 anomaly_history 에 들어가지 않아 Grafana 의 anomaly_type / alerts::text
ILIKE 집계에 잡히지 않는다. 그러나 실시간 API 나 LOW 도 저장하도록 바뀐 미래
경로가 alerts 를 직접 봐도 verdict 와 어긋나지 않도록 severity 를 맞춘다.
"""
from __future__ import annotations

from typing import Any, Dict

# 네트워크 카테고리 신호
_NET = (
    "net_external_high", "persistent_ext", "outbound_spike",
    "net_out_sustained", "spike_count_1m", "new_remote_ip_burst",
    "dos_spike",
)
# 자원/시스템 시그니처 — 하나라도 활성이면 network-only 가 아님
_RES_SYS = (
    "gpu_high", "gpu_flat", "cpu_high", "cpu_flat", "vram_low",
    "sm_high", "power_stable", "mem_high", "mem_critical",
    "stealth_mismatch_power", "stealth_mismatch_vram",
)
_VERDICT_RANK = {"HIGH_RISK": 3, "SUSPICIOUS": 2, "OBSERVE": 1, "NORMAL": 0}
_SEV_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "NORMAL": 0}


def apply_network_only_cap(pattern_result: Dict[str, Any]) -> bool:
    """pattern_result 를 in-place 로 cap. 발동했으면 True, 아니면 False.

    순수하게 dict 만 다룬다(부수효과는 인자 mutation 뿐). 발동 조건 미충족 시
    아무것도 바꾸지 않는다.
    """
    sig = pattern_result.get("signals", {}) or {}
    net_active = any(sig.get(k) for k in _NET)
    res_sys_active = any(sig.get(k) for k in _RES_SYS)
    fast_path = bool(sig.get("known_miner") or sig.get("mining_pool_ip"))
    strong = bool(
        sig.get("external_conn_suspicious_owner")
        or sig.get("single_core_full") or sig.get("process_recreation")
    )
    network_only = net_active and not res_sys_active
    cur_v = pattern_result.get("verdict", "NORMAL")

    if not (network_only and not fast_path and not strong
            and _VERDICT_RANK.get(cur_v, 0) > _VERDICT_RANK["OBSERVE"]):
        return False

    pattern_result["verdict"] = "OBSERVE"
    pattern_result["overall_severity"] = "LOW"
    em = pattern_result.get("evidence_meta") or {}
    em["network_only_capped"] = True
    em["network_only_capped_from"] = cur_v
    pattern_result["evidence_meta"] = em

    for al in pattern_result.get("alerts", []) or []:
        if not isinstance(al, dict):
            continue
        if _SEV_RANK.get(str(al.get("severity", "")).upper(), 0) > _SEV_RANK["LOW"]:
            al["severity"] = "LOW"
            al["network_only_capped"] = True
            d = str(al.get("detail", ""))
            if "network-only capped" not in d:
                al["detail"] = (d + " (network-only capped)").strip()
    return True


__all__ = ["apply_network_only_cap"]
