"""Phase 2 (#3 PID 귀속 / per-core / #6 process_recreation) ADDITIVE 신호 검증.

모든 Phase 2 신호는 signals dict 에만 노출되고 legacy indicator 점수에는
반영되지 않는다(risk_vector 전용). 여기서는 신호 발화 로직 + risk_vector
재투영을 검증한다.
"""
from collections import deque

from ml_server.scorer.signal_extractor import extract_signals
from ml_server.scorer.risk_vector import compute_risk_vector
from ml_server.model.requests import MetricsRequest


def make_metrics(**overrides):
    base = dict(
        pc_id="pc-1", timestamp="2026-05-05T10:00:00",
        cpu_percent=10.0, memory_percent=20.0,
        inbound_mb=0.0, outbound_mb=0.0, external_packet_count=0,
    )
    base.update(overrides)
    return MetricsRequest(**base)


# ── #3: 외부 연결 소유 프로세스 경로 귀속 ──
def test_external_conn_suspicious_owner_fires_on_appdata_owner():
    m = make_metrics(external_connections=[
        {"ip": "8.8.8.8", "port": 4444, "status": "ESTABLISHED",
         "pid": 1234, "proc_name": "svhost.exe",
         "proc_path": "C:\\Users\\u\\AppData\\Roaming\\svhost.exe"},
    ])
    sig = extract_signals(m, deque(), slot="free")["signals"]
    assert sig["external_conn_suspicious_owner"] is True


def test_external_conn_clean_owner_does_not_fire():
    m = make_metrics(external_connections=[
        {"ip": "8.8.8.8", "port": 443, "status": "ESTABLISHED",
         "pid": 10, "proc_name": "chrome.exe",
         "proc_path": "C:\\Program Files\\Google\\Chrome\\chrome.exe"},
    ])
    sig = extract_signals(m, deque(), slot="free")["signals"]
    assert sig["external_conn_suspicious_owner"] is False


def test_suspicious_owner_routes_to_threat_axis():
    rv = compute_risk_vector({"external_conn_suspicious_owner": True})
    assert rv["threat"] >= 3


# ── #3: single-core-pegged ──
def test_single_core_full_fires_when_one_core_pegged():
    # 8코어, 한 코어 99%, 전체 CPU 13% (≈ 1코어 분량)
    m = make_metrics(
        cpu_percent=13.0, cpu_core_count=8,
        derived_features={"single_core_max_percent": 99.0,
                          "per_core_cpu_percent": [99, 2, 1, 0, 0, 1, 0, 0]},
    )
    sig = extract_signals(m, deque(), slot="free")["signals"]
    assert sig["single_core_full"] is True


def test_single_core_full_silent_when_all_cores_busy():
    # 모든 코어 풀가동(전체 95%) → single-core 시그니처 아님
    m = make_metrics(
        cpu_percent=95.0, cpu_core_count=8,
        derived_features={"single_core_max_percent": 99.0},
    )
    sig = extract_signals(m, deque(), slot="free")["signals"]
    assert sig["single_core_full"] is False


def test_single_core_full_feeds_mining_axis():
    rv = compute_risk_vector({"single_core_full": True})
    assert rv["mining"] >= 3


# ── #6: process_recreation ──
def _hist_with_pid_churn():
    """동일 (name, path) 가 매 스냅샷 다른 PID 로 단일 인스턴스 재등장."""
    hist = deque()
    for i in range(8):
        hist.append({
            "cpu_percent": 10.0, "memory_percent": 20.0,
            "gpu_percent": None, "inbound_mb": 0.0, "outbound_mb": 0.0,
            "external_packet_count": 0, "disk_read_mb": 0.0, "disk_write_mb": 0.0,
            "top_processes": [
                {"name": "miner.exe", "pid": 1000 + i,
                 "path": "C:\\Users\\u\\AppData\\Local\\Temp\\miner.exe",
                 "cpu_percent": 5.0},
            ],
        })
    return hist


def test_process_recreation_detects_pid_churn():
    m = make_metrics()
    sig = extract_signals(m, _hist_with_pid_churn(), slot="free")["signals"]
    assert sig["process_recreation"] is True


def test_process_recreation_silent_on_stable_pid():
    hist = deque()
    for _ in range(8):
        hist.append({
            "cpu_percent": 10.0, "memory_percent": 20.0, "gpu_percent": None,
            "inbound_mb": 0.0, "outbound_mb": 0.0, "external_packet_count": 0,
            "disk_read_mb": 0.0, "disk_write_mb": 0.0,
            "top_processes": [
                {"name": "stable.exe", "pid": 4242,
                 "path": "C:\\app\\stable.exe", "cpu_percent": 5.0},
            ],
        })
    m = make_metrics()
    sig = extract_signals(m, hist, slot="free")["signals"]
    assert sig["process_recreation"] is False


def test_process_recreation_feeds_threat_axis():
    rv = compute_risk_vector({"process_recreation": True})
    assert rv["threat"] >= 2


# ── 회귀: Phase 2 신호 부재 시 기존 동작 불변 ──
def test_phase2_signals_default_false_when_absent():
    sig = extract_signals(make_metrics(), deque(), slot="free")["signals"]
    assert sig["external_conn_suspicious_owner"] is False
    assert sig["single_core_full"] is False
    assert sig["process_recreation"] is False
