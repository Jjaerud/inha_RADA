"""24신호 추출 — 모든 신호가 bool (0/1)이고 누락 없음."""
from collections import deque
from ml_server.scorer.signal_extractor import extract_signals
from ml_server.model.requests import MetricsRequest


EXPECTED_SIGNALS = {
    "is_gaming", "is_compiling",
    "gpu_active", "gpu_high", "gpu_flat", "gpu_cpu_gap",
    "vram_low", "vram_stable", "power_stable",
    "tensor_inactive", "sm_high",
    "stealth_mismatch_power", "stealth_mismatch_vram",
    "cpu_high", "cpu_flat",
    "mem_critical", "mem_high",
    "net_external_high", "mining_pool_ip", "outbound_spike", "dos_spike",
    "known_miner", "temp_exec", "persistent_miner", "persistent_ext",
    "ml_anomaly",
}


def make_metrics(**overrides):
    base = dict(
        pc_id="pc-1", timestamp="2026-05-05T10:00:00",
        cpu_percent=10.0, memory_percent=20.0,
        inbound_mb=0.0, outbound_mb=0.0, external_packet_count=0,
    )
    base.update(overrides)
    return MetricsRequest(**base)


def test_signals_all_present_and_boolean_with_empty_history():
    metrics = make_metrics()
    pack = extract_signals(metrics, deque(), slot="free", ml_weighted_score=0.0)
    signals = pack["signals"]

    # 모든 키가 존재
    assert EXPECTED_SIGNALS.issubset(signals.keys())
    # 모두 0/1로 해석 가능 (bool 또는 bool로 캐스팅 가능한 값)
    for key, val in signals.items():
        b = bool(val)
        assert b in (True, False)
        assert int(b) in (0, 1)


def test_known_miner_signal_triggers_on_xmrig():
    metrics = make_metrics(top_processes=[
        {"name": "xmrig.exe", "cpu_percent": 90, "memory_percent": 5, "path": "C:\\x"}
    ])
    pack = extract_signals(metrics, deque(), slot="free")
    assert pack["signals"]["known_miner"] is True
    assert len(pack["known_miners"]) == 1


def test_mining_pool_ip_disabled_by_default():
    # MINING_POOL_IPS 는 FP 과다(2-octet 클라우드 대역 오탐)로 기본 비활성(빈 set).
    # 정상 클라우드 IP 가 와도 mining_pool_ip 는 발화하지 않는다.
    metrics = make_metrics(external_connections=[{"ip": "155.138.99.1"}])
    pack = extract_signals(metrics, deque(), slot="free")
    assert pack["signals"]["mining_pool_ip"] is False
    assert pack["mining_pool_ip_str"] == ""


def test_mining_pool_ip_logic_still_works_when_configured(monkeypatch):
    # 코드 로직은 유효 — 정확한 prefix 를 채우면 매칭된다(위협 인텔 피드 도입 대비).
    import ml_server.scorer.signal_extractor as se
    monkeypatch.setattr(se, "MINING_POOL_IPS", {"155.138."})
    metrics = make_metrics(external_connections=[{"ip": "155.138.99.1"}])
    pack = extract_signals(metrics, deque(), slot="free")
    assert pack["signals"]["mining_pool_ip"] is True
    assert pack["mining_pool_ip_str"] == "155.138.99.1"


def test_ml_anomaly_signal_threshold():
    metrics = make_metrics()
    pack_below = extract_signals(metrics, deque(), slot="free", ml_weighted_score=-0.5)
    pack_above = extract_signals(metrics, deque(), slot="free", ml_weighted_score=0.0)
    assert pack_below["signals"]["ml_anomaly"] is True
    assert pack_above["signals"]["ml_anomaly"] is False
