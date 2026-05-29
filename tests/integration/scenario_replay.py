"""Sustained-scenario replay harness.

The ML server aggregates by the *payload* timestamp (pc_history_store._parse_ts
reads snapshot["timestamp"]), not wall-clock. So we can fabricate a 30~180 min
time-series with 5~30s cadence and replay it through /analyze in seconds —
exercising the sustained behavior path (R1~R8 + category gating) that the
30-second smoke triggers never reach.

Each scenario is a callable producing per-sample metric values; replay() POSTs
the whole series and returns the *final* analyze response so a test can assert
the resulting verdict / score / signals.
"""
from __future__ import annotations

import datetime
from typing import Callable, Dict, List, Optional

import numpy as np

# Free slot (평일 22시) — avoids class-time context discount surprises.
_BASE = datetime.datetime(2026, 5, 4, 22, 0, 0)


def _iso(dt: datetime.datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def build_snapshot(
    pc_id: str,
    ts: datetime.datetime,
    *,
    cpu: float,
    gpu: float,
    gpu_power: float = 50.0,
    vram_mb: float = 800.0,
    mem: float = 40.0,
    mem_used_gb: float = 4.0,
    out_mb: float = 0.03,
    in_mb: float = 0.05,
    ext_packets: int = 2,
    external_connections: Optional[List[dict]] = None,
    active_ports: Optional[List[int]] = None,
    top_processes: Optional[List[dict]] = None,
    user_idle_ms: Optional[int] = None,
    disk_write: float = 0.3,
    disk_read: float = 0.5,
    sm_util: Optional[float] = None,
    tensor_active: int = 0,
) -> dict:
    """Schema-valid 22-key snapshot (matches fixtures.normal_metrics shape)."""
    snap: dict = {
        "pc_id":                 pc_id,
        "timestamp":             _iso(ts),
        "cpu_percent":           float(np.clip(cpu, 0, 100)),
        "cpu_core_count":        8,
        "memory_percent":        float(np.clip(mem, 0, 100)),
        "memory_used_gb":        float(mem_used_gb),
        "memory_total_gb":       16.0,
        "inbound_mb":            float(max(0.0, in_mb)),
        "outbound_mb":           float(max(0.0, out_mb)),
        "inbound_total_mb":      0.0,
        "outbound_total_mb":     0.0,
        "external_packet_count": int(max(0, ext_packets)),
        "external_connections":  external_connections or [],
        "active_ports":          active_ports or [80, 443],
        "disk_read_mb":          float(max(0.0, disk_read)),
        "disk_write_mb":         float(max(0.0, disk_write)),
        "gpu": {
            "name":               "GeForce RTX 3060",
            "load_percent":       float(np.clip(gpu, 0, 100)),
            "memory_used_mb":     float(vram_mb),
            "memory_total_mb":    8192.0,
            "memory_percent":     float(vram_mb) / 8192.0 * 100,
            "temperature":        62.0,
            "sm_utilization":     float(sm_util if sm_util is not None else gpu),
            "tensor_core_active": tensor_active,
            "power_draw_w":       float(gpu_power),
        },
        "top_processes":  top_processes or [
            {"name": "chrome.exe", "cpu_percent": 4.0, "memory_percent": 8.0,
             "path": "C:\\Program Files\\Chrome\\chrome.exe"},
        ],
        "local_alerts":   [],
        "boxplot_signal": {},
    }
    if user_idle_ms is not None:
        # carried via derived_features so signal_extractor / history store see it
        snap["derived_features"] = {"user_idle_ms": int(user_idle_ms)}
        snap["user_idle_ms"] = int(user_idle_ms)
    return snap


# A scenario maps (sample_index, rng) -> dict of build_snapshot kwargs.
ScenarioFn = Callable[[int, np.random.Generator], Dict]


def replay(
    client,
    pc_id: str,
    scenario: ScenarioFn,
    *,
    duration_min: int = 35,
    cadence_sec: int = 20,
    seed: int = 7,
) -> dict:
    """POST a full synthetic time-series; return the final /analyze response.

    duration_min=35 with cadence 20s → 105 samples spanning 35 minutes, enough
    to cross the 30-min sustained threshold.
    """
    rng = np.random.default_rng(seed)
    n = int(duration_min * 60 // cadence_sec)
    last_body: dict = {}
    for i in range(n):
        ts = _BASE + datetime.timedelta(seconds=i * cadence_sec)
        kwargs = scenario(i, rng)
        snap = build_snapshot(pc_id, ts, **kwargs)
        r = client.post("/analyze", json=snap)
        assert r.status_code == 200, r.text
        last_body = r.json()
    return last_body


# ──────────────────────────────────────────────────────────────────────
# Scenario library — values approximate the 2nd-evaluation test table.
# ──────────────────────────────────────────────────────────────────────

XMRIG = "C:\\Users\\Public\\xmrig.exe"
APPDATA_EXE = "C:\\Users\\Public\\AppData\\Roaming\\Microsoft\\wuauclt_helper.exe"
POOL_IP = "155.138.1.50"   # matches MINING_POOL_IPS prefix 155.138.


def sc_normal_idle(i: int, rng: np.random.Generator) -> Dict:
    """정상 idle/브라우징 — 낮고 변동성 있는 CPU/GPU."""
    return dict(
        cpu=float(np.clip(rng.normal(12, 6), 0, 100)),
        gpu=float(np.clip(rng.normal(6, 4), 0, 100)),
        gpu_power=float(np.clip(rng.normal(45, 8), 20, 120)),
        vram_mb=float(np.clip(rng.normal(900, 120), 400, 8000)),
        mem=float(np.clip(rng.normal(42, 5), 10, 90)),
    )


def sc_game_render(i: int, rng: np.random.Generator) -> Dict:
    """게임/렌더링 — GPU 높음, VRAM 높음, 네트워크 거의 없음 (정상 고부하)."""
    return dict(
        cpu=float(np.clip(rng.normal(45, 12), 0, 100)),
        gpu=float(np.clip(rng.normal(93, 4), 0, 100)),
        gpu_power=float(np.clip(rng.normal(165, 15), 80, 250)),
        vram_mb=float(np.clip(rng.normal(6800, 400), 3000, 8000)),
        mem=float(np.clip(rng.normal(65, 6), 20, 95)),
        sm_util=float(np.clip(rng.normal(92, 5), 0, 100)),
        tensor_active=0,
        top_processes=[
            {"name": "game.exe", "cpu_percent": 40.0, "memory_percent": 30.0,
             "path": "C:\\Program Files\\Game\\game.exe"},
        ],
    )


def sc_cpu_mining(i: int, rng: np.random.Generator) -> Dict:
    """CPU-only 채굴 유사 — CPU 90~100% flat, GPU 낮음, 외부 연결 지속."""
    return dict(
        cpu=float(np.clip(rng.normal(97, 1.5), 0, 100)),  # flat high
        gpu=float(np.clip(rng.normal(5, 2), 0, 100)),
        gpu_power=float(np.clip(rng.normal(45, 5), 20, 120)),
        vram_mb=float(np.clip(rng.normal(700, 50), 400, 1000)),
        mem=float(np.clip(rng.normal(35, 3), 10, 80)),
        out_mb=float(np.clip(rng.normal(0.8, 0.2), 0, 5)),
        ext_packets=int(np.clip(rng.normal(60, 10), 10, 200)),
        external_connections=[
            {"ip": "104.21.66.207", "port": 5555, "status": "ESTABLISHED", "pid": 6001},
        ],
        active_ports=[5555],
        user_idle_ms=45 * 60 * 1000,  # 45 min idle
        top_processes=[
            {"name": "svc_host32.exe", "cpu_percent": 95.0, "memory_percent": 4.0,
             "path": "C:\\ProgramData\\svc_host32.exe"},
        ],
    )


def sc_gpu_mining(i: int, rng: np.random.Generator) -> Dict:
    """GPU 채굴 유사 — GPU 90%+ flat, power stable, VRAM 낮음, 외부 연결."""
    return dict(
        cpu=float(np.clip(rng.normal(20, 4), 0, 100)),
        gpu=float(np.clip(rng.normal(96, 1.5), 0, 100)),   # flat high
        gpu_power=float(np.clip(rng.normal(168, 3), 80, 250)),  # power flat
        vram_mb=float(np.clip(rng.normal(850, 60), 400, 1200)),  # low VRAM
        mem=float(np.clip(rng.normal(30, 3), 10, 80)),
        out_mb=float(np.clip(rng.normal(0.6, 0.15), 0, 5)),
        ext_packets=int(np.clip(rng.normal(50, 8), 10, 200)),
        external_connections=[
            {"ip": "104.21.66.207", "port": 7777, "status": "ESTABLISHED", "pid": 6002},
        ],
        active_ports=[7777],
        user_idle_ms=40 * 60 * 1000,
        sm_util=float(np.clip(rng.normal(95, 2), 0, 100)),
        tensor_active=0,
        top_processes=[
            {"name": "miner_x.exe", "cpu_percent": 18.0, "memory_percent": 5.0,
             "path": "C:\\Users\\Public\\AppData\\Roaming\\miner_x.exe"},
        ],
    )


def sc_known_miner(i: int, rng: np.random.Generator) -> Dict:
    """known miner — top process 에 xmrig.exe + mining pool IP/port."""
    return dict(
        cpu=float(np.clip(rng.normal(96, 2), 0, 100)),
        gpu=float(np.clip(rng.normal(95, 3), 0, 100)),
        gpu_power=float(np.clip(rng.normal(165, 5), 80, 250)),
        vram_mb=7800.0,
        mem=82.0,
        out_mb=12.0,
        ext_packets=int(np.clip(rng.normal(1200, 50), 800, 2000)),
        external_connections=[
            {"ip": POOL_IP, "port": 3333, "status": "ESTABLISHED", "pid": 6666,
             "process_name": "xmrig.exe"},
        ],
        active_ports=[3333],
        top_processes=[
            {"name": "xmrig.exe", "cpu_percent": 92.0, "memory_percent": 5.2,
             "path": XMRIG},
        ],
    )


def sc_network_load_only(i: int, rng: np.random.Generator) -> Dict:
    """단순 네트워크 부하 (iperf/대용량 전송) — CPU/GPU 낮음. HIGH 뜨면 오탐."""
    return dict(
        cpu=float(np.clip(rng.normal(18, 5), 0, 100)),
        gpu=float(np.clip(rng.normal(5, 2), 0, 100)),
        out_mb=float(np.clip(rng.normal(40, 8), 0, 100)),
        in_mb=float(np.clip(rng.normal(2, 0.5), 0, 50)),
        ext_packets=int(np.clip(rng.normal(40, 8), 10, 200)),
        external_connections=[
            {"ip": "13.107.42.14", "port": 443, "status": "ESTABLISHED", "pid": 7100},
        ],
        top_processes=[
            {"name": "chrome.exe", "cpu_percent": 12.0, "memory_percent": 14.0,
             "path": "C:\\Program Files\\Chrome\\chrome.exe"},
        ],
    )
