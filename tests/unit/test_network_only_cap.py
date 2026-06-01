"""FP-fix #1 network-only cap — 발동/면제/alert 정합화 단위 검증."""
from __future__ import annotations

from ml_server.scorer.network_only_cap import apply_network_only_cap


def _pr(verdict="SUSPICIOUS", severity="MEDIUM", signals=None, alerts=None):
    return {
        "verdict": verdict,
        "overall_severity": severity,
        "signals": signals or {},
        "alerts": alerts if alerts is not None else [
            {"type": "SUSPICIOUS_EXFIL", "severity": "MEDIUM",
             "detail": "outbound burst", "score": 5},
        ],
        "evidence_meta": {},
    }


def test_network_only_caps_and_clamps_alert():
    pr = _pr(signals={"outbound_spike": True, "persistent_ext": True})
    fired = apply_network_only_cap(pr)
    assert fired is True
    assert pr["verdict"] == "OBSERVE"
    assert pr["overall_severity"] == "LOW"
    assert pr["evidence_meta"]["network_only_capped"] is True
    assert pr["evidence_meta"]["network_only_capped_from"] == "SUSPICIOUS"
    # alert 정합화: severity LOW 클램프 + 마킹 + type/detail 보존
    al = pr["alerts"][0]
    assert al["severity"] == "LOW"
    assert al["network_only_capped"] is True
    assert al["type"] == "SUSPICIOUS_EXFIL"           # 식별자 보존
    assert "network-only capped" in al["detail"]
    assert "outbound burst" in al["detail"]           # 원 detail 보존


def test_resource_signal_exempts_cap():
    # 자원 시그니처(cpu_flat)가 있으면 network-only 아님 → cap 안 함
    pr = _pr(signals={"outbound_spike": True, "cpu_flat": True})
    assert apply_network_only_cap(pr) is False
    assert pr["verdict"] == "SUSPICIOUS"
    assert pr["alerts"][0]["severity"] == "MEDIUM"


def test_pid_attribution_exempts_cap():
    # Phase2 PID 귀속(external_conn_suspicious_owner) 면제
    pr = _pr(signals={"outbound_spike": True, "external_conn_suspicious_owner": True})
    assert apply_network_only_cap(pr) is False
    assert pr["verdict"] == "SUSPICIOUS"


def test_fast_path_exempts_cap():
    pr = _pr(signals={"net_external_high": True, "mining_pool_ip": True})
    assert apply_network_only_cap(pr) is False


def test_single_core_full_exempts_cap():
    pr = _pr(signals={"dos_spike": True, "single_core_full": True})
    assert apply_network_only_cap(pr) is False


def test_already_observe_not_capped():
    # 이미 OBSERVE 이하면 발동 안 함 (낮출 게 없음)
    pr = _pr(verdict="OBSERVE", severity="LOW",
             signals={"outbound_spike": True})
    assert apply_network_only_cap(pr) is False


def test_no_network_signal_not_capped():
    pr = _pr(signals={})  # 네트워크 신호 없음
    assert apply_network_only_cap(pr) is False


def test_low_alert_not_remarked():
    # 이미 LOW 인 alert 는 클램프/마킹 대상 아님
    pr = _pr(signals={"outbound_spike": True},
             alerts=[{"type": "X", "severity": "LOW", "detail": "d"}])
    apply_network_only_cap(pr)
    assert pr["alerts"][0].get("network_only_capped") is None
    assert pr["alerts"][0]["detail"] == "d"
