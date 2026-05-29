"""CPU + 메모리 수집기."""
from __future__ import annotations

import time
from typing import Dict

import psutil

from .base import BaseCollector


class CpuMemCollector(BaseCollector):
    """psutil 기반 CPU/메모리 측정.

    cpu_percent(interval=1)은 1초간 블로킹하므로
    메인 루프에서 1회만 호출되도록 주의.
    """

    def __init__(self, cpu_interval: float = 1.0) -> None:
        self.cpu_interval = cpu_interval
        try:
            self._boot_time = psutil.boot_time()
        except Exception:
            self._boot_time = time.time()

    def collect(self) -> Dict:
        # #3 (per-core CPU): aggregate 측정과 동일 ~1s 윈도우로 per-core 를 얻기
        # 위해 percpu 를 prime 한 뒤 1s 블로킹 aggregate 호출, 직후 percpu 측정.
        # percpu 와 aggregate 는 psutil 내부에서 독립 last-call 상태를 가진다.
        try:
            psutil.cpu_percent(interval=None, percpu=True)  # prime
        except Exception:
            pass
        cpu = psutil.cpu_percent(interval=self.cpu_interval)
        try:
            per_core = psutil.cpu_percent(interval=None, percpu=True) or []
            per_core = [round(float(c), 1) for c in per_core]
        except Exception:
            per_core = []
        single_core_max = round(max(per_core), 1) if per_core else 0.0
        mem = psutil.virtual_memory()
        logical = psutil.cpu_count(logical=True) or 0
        physical = psutil.cpu_count(logical=False) or 0
        try:
            uptime_sec = int(time.time() - self._boot_time)
            if uptime_sec < 0:
                uptime_sec = 0
        except Exception:
            uptime_sec = 0
        return {
            "cpu_percent": cpu,
            "cpu_core_count": psutil.cpu_count(),
            "memory_percent": mem.percent,
            "memory_used_gb": round(mem.used / (1024 ** 3), 2),
            "memory_total_gb": round(mem.total / (1024 ** 3), 2),
            "logical_cpu_count": logical,
            "physical_cpu_count": physical,
            "uptime_sec": uptime_sec,
            "per_core_cpu_percent": per_core,
            "single_core_max_percent": single_core_max,
        }
