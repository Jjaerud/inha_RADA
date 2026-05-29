"""ClientConfig mode 분기 / target_url / env override 단위 테스트."""
from __future__ import annotations

import pytest

from client_core.config import defaults
from client_core.config.loader import ClientConfig, _from_dict, load_config


def test_default_mode_is_springboot():
    cfg = ClientConfig()
    assert cfg.mode == "springboot"
    assert cfg.spring_boot_url == defaults.SPRING_BOOT_URL
    assert cfg.ml_server_url == defaults.ML_SERVER_URL
    assert cfg.api_key is None


def test_mlserver_mode_ok():
    cfg = ClientConfig(mode="mlserver")
    assert cfg.mode == "mlserver"


def test_invalid_mode_raises():
    with pytest.raises(ValueError):
        ClientConfig(mode="invalid")


def test_target_url_branches():
    sb = ClientConfig(mode="springboot",
                     spring_boot_url="http://sb:8080/api/metrics",
                     ml_server_url="http://ml:8000/analyze")
    ml = ClientConfig(mode="mlserver",
                     spring_boot_url="http://sb:8080/api/metrics",
                     ml_server_url="http://ml:8000/analyze")
    assert sb.target_url() == "http://sb:8080/api/metrics"
    assert ml.target_url() == "http://ml:8000/analyze"


def test_from_dict_parses_mode_fields():
    cfg = _from_dict({
        "mode": "mlserver",
        "ml_server_url": "http://x:8000/analyze",
        "spring_boot_url": "http://y:8080/api/metrics",
        "api_key": "K1",
    })
    assert cfg.mode == "mlserver"
    assert cfg.ml_server_url == "http://x:8000/analyze"
    assert cfg.spring_boot_url == "http://y:8080/api/metrics"
    assert cfg.api_key == "K1"


def test_env_override_mode_and_urls(monkeypatch):
    monkeypatch.setenv("RADA_MODE", "mlserver")
    monkeypatch.setenv("RADA_ML_SERVER_URL", "http://envml:8000/analyze")
    monkeypatch.setenv("RADA_SPRING_BOOT_URL", "http://envsb:8080/api/metrics")
    monkeypatch.setenv("RADA_API_KEY", "ENVKEY")
    cfg = load_config()
    assert cfg.mode == "mlserver"
    assert cfg.ml_server_url == "http://envml:8000/analyze"
    assert cfg.spring_boot_url == "http://envsb:8080/api/metrics"
    assert cfg.api_key == "ENVKEY"
    assert cfg.target_url() == "http://envml:8000/analyze"


def test_env_invalid_mode_raises(monkeypatch):
    monkeypatch.setenv("RADA_MODE", "garbage")
    with pytest.raises(ValueError):
        load_config()


# ── pc_id 오버라이드 (대시보드 고정 로스터 매칭용) ──
def test_pc_id_default_none():
    assert ClientConfig().pc_id is None


def test_from_dict_parses_pc_id():
    cfg = _from_dict({"pc_id": "PC-01"})
    assert cfg.pc_id == "PC-01"


def test_env_override_pc_id(monkeypatch):
    monkeypatch.setenv("RADA_PC_ID", "PC-03")
    cfg = load_config()
    assert cfg.pc_id == "PC-03"


def test_runtime_uses_config_pc_id():
    """config.pc_id 가 있으면 collector 가 그 id 로 페이로드를 만든다."""
    from client_core.runtime.loop import ClientRuntime
    rt = ClientRuntime(config=ClientConfig(pc_id="PC-07"))
    assert rt.collector.pc_id == "PC-07"


def test_runtime_falls_back_to_mac_pc_id():
    from client_core.runtime.loop import ClientRuntime
    from client_core.identity import PC_ID
    rt = ClientRuntime(config=ClientConfig(pc_id=None))
    assert rt.collector.pc_id == PC_ID
