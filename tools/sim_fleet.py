"""RADA 가상 PC 플릿 시뮬레이터 (로컬 데모/검증 전용).

실제 클라이언트가 없는 PC 들을 대신해 메트릭을 **지속적으로** 전송한다.
대부분 정상(NORMAL), 지정한 일부는 위험(DANGEROUS) 상태가 되도록 자원 패턴을
주기적으로 보낸다. verdict 는 최근 5건 이동평균 + 게이팅의 지속시간(sustained)에
의존하므로, 일시 전송이 아니라 --interval(기본 5초)마다 반복 전송한다.

전송 경로: 실제 클라이언트와 동일하게 Spring(:8080) /api/metrics 로 POST.
인증: PC 별 등록된 API 키(X-API-Key). keys.csv(pc_id,raw_key,...)에서 읽는다.

⚠️ 실제 탐지 영향 없음(설계): 시뮬 PC 는 고유 pc_id 라 실제 PC 의 verdict/score
   에 영향을 주지 않는다(ML 은 pc_id 별 독립 history). 유일한 cross-PC 경로는
   GLOBAL_HW_DEGRADATION(전체 PC 중 고CPU 비율) 이며 alert-only(severity 불변)
   이다. 정상 PC 를 저부하(CPU~15%)로 두고 위험을 소수로 유지하면 이 비율이
   임계 밑이라 안전하다. (retrieval/peer 는 비점수 layer 라 무해.)

사용 예:
  # 실제는 PC-01~10, 시뮬은 PC-11~40, 그중 13/20/27 을 위험(시나리오 지정)
  python tools/sim_fleet.py \
      --keys ../RADA-deploy/keys.csv \
      --pcs PC-11..PC-40 \
      --danger PC-13:miner PC-20:gpu_stealth PC-27:cpu_miner

  # 한 라운드만(검증) / 페이로드만 출력
  python tools/sim_fleet.py --pcs PC-11..PC-12 --once
  python tools/sim_fleet.py --pcs PC-11..PC-12 --danger PC-11:miner --dry-run --once

시나리오(위험도/패턴):  --danger PC-XX:<scenario>
  normal       정상 저부하 (기본값 — --danger 미지정 PC 전부)
  miner        [fast-path] xmrig 채굴 프로세스 → process=10 → 즉시·지속 HIGH_RISK
  gpu_stealth  [non-fast]  GPU flat+cpu_gap+vram_low+tensor0 → 자원클러스터 SUSPICIOUS↑
  cpu_miner    [non-fast]  CPU flat 96%+unknown_process → 점수+지속 게이팅
  exfil        [non-fast]  outbound 급증 + 의심 소유 프로세스(PID귀속) → 캡 면제
  dos          [데모]      inbound flood → network-only 캡으로 OBSERVE (캡 동작 시연)
실제 결과 verdict 는 README 표/문서 §4 참고(보수적 게이팅으로 패턴별 상이).
"""
from __future__ import annotations

import argparse
import csv
import random
import signal
import sys
import threading
import time
from datetime import datetime, timezone, timedelta

import requests

KST = timezone(timedelta(hours=9))
XMRIG = r"C:\Users\Public\Downloads\xmrig.exe"
TEMP_BOT = r"C:\Users\Public\AppData\Local\Temp\svc_update.exe"
APPDATA_BOT = r"C:\Users\lab\AppData\Roaming\sys_helper.exe"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
EXPLORER = r"C:\Windows\explorer.exe"
CODE = r"C:\Users\lab\AppData\Local\Programs\Microsoft VS Code\Code.exe"

_STOP = threading.Event()


# ───────────────────────── 페이로드 프로파일 ─────────────────────────
def _base(pc_id: str, i: int) -> dict:
    """공통 골격(정상 기본값). 시나리오가 필요한 필드만 덮어쓴다."""
    return {
        "pc_id": pc_id,
        "timestamp": datetime.now(KST).isoformat(),
        "cpu_percent": 12.0 + random.uniform(-4, 8),
        "cpu_core_count": 8,
        "memory_percent": 45.0 + random.uniform(-6, 10),
        "memory_used_gb": 7.2,
        "memory_total_gb": 16.0,
        "disk_read_mb": random.uniform(0.1, 2.0),
        "disk_write_mb": random.uniform(0.1, 1.5),
        "inbound_mb": random.uniform(0.01, 0.3),
        "outbound_mb": random.uniform(0.01, 0.2),
        "inbound_total_mb": 50.0 + i,
        "outbound_total_mb": 30.0 + i,
        "external_packet_count": random.randint(0, 4),
        "external_connection_count": 2,
        "external_connections": [
            {"pid": 1200, "proc_name": "chrome.exe", "proc_path": CHROME,
             "ip": "142.250.0.1", "port": 443, "status": "ESTABLISHED"},
        ],
        "active_ports": [443],
        "gpu": {
            "name": "NVIDIA GeForce RTX 3060", "load_percent": 8.0 + random.uniform(0, 10),
            "memory_used_mb": 900.0, "memory_total_mb": 12288.0, "memory_percent": 7.3,
            "temperature": 45.0, "sm_utilization": 6, "tensor_core_active": 0,
            "power_draw_w": 45.0,
        },
        "top_processes": [
            {"pid": 1200, "name": "chrome.exe", "cpu_percent": 6.0, "memory_percent": 9.0, "path": CHROME},
            {"pid": 800, "name": "explorer.exe", "cpu_percent": 1.0, "memory_percent": 3.0, "path": EXPLORER},
            {"pid": 1500, "name": "code.exe", "cpu_percent": 3.0, "memory_percent": 5.0, "path": CODE},
        ],
        "loop_elapsed": 4.7,
        "local_alerts": [],
        "boxplot_signal": {},
        "derived_features": {
            "logical_cpu_count": 8, "physical_cpu_count": 4, "collection_interval_sec": 5,
            "top_process_cpu_sum_normalized": 0.10,
            "external_connection_count_truncated": False,
            "unique_remote_ip_count": 1, "duplicate_connection_count": 0,
            "gpu_metrics_missing_reason": None,
        },
    }


def _miner(p: dict, i: int) -> dict:
    """[fast-path] 알려진 채굴 프로세스 + 고 CPU/GPU. process=10 → 즉시 HIGH_RISK."""
    p["cpu_percent"] = 96.0 + (i % 3)
    p["memory_percent"] = 78.0
    p["disk_write_mb"] = 4.0
    p["outbound_mb"] = 8.0 + (i % 4)
    p["external_packet_count"] = 60 + i
    p["gpu"].update(load_percent=95.0 + (i % 4), memory_used_mb=1500.0, memory_percent=12.2,
                    sm_utilization=96, tensor_core_active=0, power_draw_w=165.0, temperature=80.0)
    p["top_processes"] = [
        {"pid": 6666, "name": "xmrig.exe", "cpu_percent": 94.0, "memory_percent": 5.0, "path": XMRIG},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["external_connections"] = [
        {"pid": 6666, "proc_name": "xmrig.exe", "proc_path": XMRIG,
         "ip": "51.222.40.10", "port": 3333, "status": "ESTABLISHED"},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.94, unique_remote_ip_count=1)
    p["local_alerts"] = [{"type": "unknown_process_active", "severity": "HIGH",
                          "detail": "xmrig.exe CPU 94%"}]
    return p


def _gpu_stealth(p: dict, i: int) -> dict:
    """[non-fast] GPU 고정 고부하 + CPU 낮음 + VRAM 낮음 + 텐서0. 자원 클러스터."""
    p["cpu_percent"] = 8.0 + random.uniform(0, 4)          # gpu_cpu_gap (gpu high, cpu<20)
    p["gpu"].update(load_percent=92.0 + (i % 3),           # gpu_high + gpu_flat(stddev<5)
                    memory_used_mb=1400.0, memory_percent=11.4,  # vram_low (<30%)
                    sm_utilization=95, tensor_core_active=0,     # tensor_inactive
                    power_draw_w=150.0, temperature=76.0)
    p["external_packet_count"] = 9 + (i % 3)               # net_external_high(>=8) → cat 2개
    p["outbound_mb"] = 1.2
    p["derived_features"].update(top_process_cpu_sum_normalized=0.15, unique_remote_ip_count=3)
    # 비 fast-path: 알려진 채굴 프로세스 이름을 쓰지 않는다(자원 신호만으로 탐지).
    p["top_processes"] = [
        {"pid": 7001, "name": "gpu_worker.exe", "cpu_percent": 4.0, "memory_percent": 3.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    return p


def _cpu_miner(p: dict, i: int) -> dict:
    """[non-fast] CPU flat 96% + unknown_process_active. 점수+지속 게이팅 경로."""
    p["cpu_percent"] = 96.0 + (i % 3)                      # cpu_high + cpu_flat
    p["gpu"].update(load_percent=5.0, sm_utilization=3)    # GPU 비활성 → cpu_mining +가산
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7777, "name": "miner64.exe", "cpu_percent": 95.0, "memory_percent": 4.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.95, unique_remote_ip_count=3,
                                 single_core_max_percent=99.0)
    p["local_alerts"] = [{"type": "cpu_sustained_high", "severity": "MEDIUM", "detail": "CPU 96%"}]
    return p


def _exfil(p: dict, i: int) -> dict:
    """[non-fast] outbound 급증 + 의심 경로 소유 프로세스(PID귀속) → network-only 캡 면제."""
    p["cpu_percent"] = 35.0 + random.uniform(0, 10)
    p["outbound_mb"] = 15.0 + i                            # outbound_spike (>avg*5, >1MB)
    p["disk_write_mb"] = 3.0
    p["external_packet_count"] = 40 + i
    p["external_connection_count"] = 6
    p["external_connections"] = [
        {"pid": 9100, "proc_name": "sys_helper.exe", "proc_path": APPDATA_BOT,
         "ip": "193.43.10.22", "port": 8443, "status": "ESTABLISHED"},
        {"pid": 9100, "proc_name": "sys_helper.exe", "proc_path": APPDATA_BOT,
         "ip": "45.137.21.9", "port": 443, "status": "ESTABLISHED"},
    ]
    p["top_processes"] = [
        {"pid": 9100, "name": "sys_helper.exe", "cpu_percent": 30.0, "memory_percent": 4.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 5.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.4, unique_remote_ip_count=8,
                                 duplicate_connection_count=0)
    return p


def _dos(p: dict, i: int) -> dict:
    """[데모] inbound flood → dos_spike. network-only 라 OBSERVE 로 캡(캡 동작 시연)."""
    p["inbound_mb"] = 120.0 + i * 5                        # 절대 floor 100 + ratio
    p["external_packet_count"] = 200 + i
    p["external_connection_count"] = 10
    p["derived_features"].update(unique_remote_ip_count=15, duplicate_connection_count=1)
    return p


def _miner_gpu(p: dict, i: int) -> dict:
    """[fast-path] GPU 채굴자(t-rex) + GPU 풀가동. CONFIRMED_MINING(GPU 측)."""
    p["cpu_percent"] = 25.0 + random.uniform(0, 6)
    p["gpu"].update(load_percent=97.0 + (i % 3), memory_used_mb=9800.0, memory_percent=79.7,
                    sm_utilization=98, tensor_core_active=0, power_draw_w=195.0, temperature=83.0)
    p["outbound_mb"] = 6.0 + (i % 3)
    p["external_packet_count"] = 40 + i
    p["top_processes"] = [
        {"pid": 6700, "name": "t-rex", "cpu_percent": 20.0, "memory_percent": 6.0, "path": XMRIG},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["external_connections"] = [
        {"pid": 6700, "proc_name": "t-rex", "proc_path": XMRIG,
         "ip": "172.65.220.7", "port": 4444, "status": "ESTABLISHED"},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.3)
    return p


def _gpu_cpu_both(p: dict, i: int) -> dict:
    """[non-fast] CPU·GPU 동시 고정 고부하(R3). 자원 클러스터 강함."""
    p["cpu_percent"] = 93.0 + (i % 3)                      # cpu_high + cpu_flat
    p["gpu"].update(load_percent=94.0 + (i % 3), memory_used_mb=1300.0, memory_percent=10.6,
                    sm_utilization=95, tensor_core_active=0, power_draw_w=150.0, temperature=78.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7100, "name": "compute_worker.exe", "cpu_percent": 90.0, "memory_percent": 8.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.9, unique_remote_ip_count=3)
    return p


def _cpu_single_core(p: dict, i: int) -> dict:
    """[non-fast] 단일 코어 99% 고정, 전체 CPU 는 낮음(single_core_full, 단일스레드 루프)."""
    p["cpu_percent"] = 14.0 + random.uniform(0, 3)         # 전체 낮음 (1코어/8 ≈ 12.5%)
    p["gpu"].update(load_percent=5.0, sm_utilization=2)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7300, "name": "loop_svc.exe", "cpu_percent": 99.0, "memory_percent": 3.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(single_core_max_percent=99.0, top_process_cpu_sum_normalized=0.5,
                                 unique_remote_ip_count=3)
    return p


def _temp_dropper(p: dict, i: int) -> dict:
    """[non-fast] 임시폴더(\\temp\\) 실행 + 고부하(temp_exec + danger override)."""
    p["cpu_percent"] = 88.0 + (i % 4)
    p["gpu"].update(load_percent=10.0)
    p["external_packet_count"] = 10
    p["outbound_mb"] = 2.0
    p["top_processes"] = [
        {"pid": 7400, "name": "update_x86.exe", "cpu_percent": 86.0, "memory_percent": 6.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.86, unique_remote_ip_count=4)
    return p


def _appdata_beacon(p: dict, i: int) -> dict:
    """[non-fast] AppData 실행 + 지속 outbound + 의심 소유(상관/PID귀속)."""
    p["cpu_percent"] = 45.0 + random.uniform(0, 8)
    p["disk_write_mb"] = 2.5
    p["outbound_mb"] = 3.0
    p["external_packet_count"] = 20 + i
    p["external_connection_count"] = 5
    p["external_connections"] = [
        {"pid": 9200, "proc_name": "sys_helper.exe", "proc_path": APPDATA_BOT,
         "ip": "194.26.135.5", "port": 8080, "status": "ESTABLISHED"},
    ]
    p["top_processes"] = [
        {"pid": 9200, "name": "sys_helper.exe", "cpu_percent": 40.0, "memory_percent": 5.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 4.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.4, unique_remote_ip_count=5)
    return p


def _stealth_power(p: dict, i: int) -> dict:
    """[non-fast] 전력은 높은데 GPU 부하는 낮음(stealth_mismatch_power)."""
    p["cpu_percent"] = 20.0 + random.uniform(0, 6)
    p["gpu"].update(load_percent=12.0 + random.uniform(0, 5),   # avg_gpu < 30
                    memory_used_mb=1200.0, memory_percent=9.8,
                    sm_utilization=15, tensor_core_active=0,
                    power_draw_w=90.0 + (i % 5))                 # avg_power >= 80
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7500, "name": "gfx_host.exe", "cpu_percent": 12.0, "memory_percent": 5.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _stealth_vram(p: dict, i: int) -> dict:
    """[non-fast] VRAM 점유 높은데 GPU 부하는 낮음(stealth_mismatch_vram)."""
    p["cpu_percent"] = 18.0 + random.uniform(0, 6)
    p["gpu"].update(load_percent=12.0 + random.uniform(0, 5),   # gpu < 20
                    memory_used_mb=9200.0, memory_percent=74.9,  # vram_ratio > 0.7
                    sm_utilization=10, tensor_core_active=0, power_draw_w=60.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _mem_leak(p: dict, i: int) -> dict:
    """[관찰] 메모리 임계인데 CPU 낮음(누수/좀비 의심). 보안위협보단 유지보수 신호."""
    p["cpu_percent"] = 10.0 + random.uniform(0, 5)
    p["memory_percent"] = 96.0 + (i % 3)
    p["memory_used_gb"] = 15.4
    p["gpu"].update(load_percent=6.0)
    p["top_processes"] = [
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 5.0, "memory_percent": 70.0, "path": CHROME},
        {"pid": 800, "name": "explorer.exe", "cpu_percent": 1.0, "memory_percent": 10.0, "path": EXPLORER},
    ]
    p["local_alerts"] = [{"type": "mem_pressure", "severity": "HIGH", "detail": "메모리 96%"}]
    return p


def _port_scan(p: dict, i: int) -> dict:
    """[데모] 다수 고유 IP 로 단시간 연결(new_remote_ip_burst). 네트워크 단독→억제."""
    p["external_packet_count"] = 30 + i
    p["external_connection_count"] = 25
    p["outbound_mb"] = 0.8
    p["derived_features"].update(unique_remote_ip_count=22, duplicate_connection_count=1)
    return p


def _gpu_cpu_heavy(p: dict, i: int) -> dict:
    """[non-fast] GPU 채굴 클러스터 + CPU 도 flat 고부하 → 점수 높아 HIGH 가능(MINING)."""
    p["cpu_percent"] = 90.0 + (i % 4)                      # cpu_high + cpu_flat
    p["gpu"].update(load_percent=93.0 + (i % 3), memory_used_mb=1300.0, memory_percent=10.6,
                    sm_utilization=96, tensor_core_active=0, power_draw_w=160.0, temperature=80.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7600, "name": "render_node.exe", "cpu_percent": 88.0, "memory_percent": 7.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.9, unique_remote_ip_count=3)
    return p


def _vram_miner(p: dict, i: int) -> dict:
    """[non-fast] GPU flat + VRAM 낮음 + 전력 안정(R7형 채굴). power_stable 포함."""
    p["cpu_percent"] = 10.0 + random.uniform(0, 5)
    p["gpu"].update(load_percent=91.0 + (i % 3), memory_used_mb=1000.0, memory_percent=8.1,
                    sm_utilization=93, tensor_core_active=0, power_draw_w=140.0, temperature=75.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 7700, "name": "cuda_svc.exe", "cpu_percent": 6.0, "memory_percent": 3.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _runaway(p: dict, i: int) -> dict:
    """[risk=MALFUNCTION] CPU flat 고부하인데 디스크/네트워크 진척 없음(stuck loop)."""
    p["cpu_percent"] = 97.0 + (i % 3)                      # cpu_high + cpu_flat
    p["memory_percent"] = 96.0 + (i % 3)                   # mem_critical (malfunction)
    p["memory_used_gb"] = 15.4
    p["gpu"].update(load_percent=4.0, sm_utilization=2)
    p["disk_write_mb"] = 0.1; p["outbound_mb"] = 0.05      # 진척 없음
    p["external_packet_count"] = 1
    p["top_processes"] = [
        {"pid": 7800, "name": "calc_engine.exe", "cpu_percent": 96.0, "memory_percent": 60.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.96, unique_remote_ip_count=1)
    return p


def _aging(p: dict, i: int) -> dict:
    """[risk=AGING] 전력·VRAM 모순 동시 + 고온(노후/하드웨어 이상)."""
    p["cpu_percent"] = 18.0 + random.uniform(0, 6)
    p["gpu"].update(load_percent=14.0 + random.uniform(0, 4),   # gpu<20/<30
                    memory_used_mb=9200.0, memory_percent=74.9,  # vram>0.7 (mismatch_vram)
                    sm_utilization=12, tensor_core_active=0,
                    power_draw_w=88.0 + (i % 4), temperature=92.0)  # power>=80 (mismatch_power), 고온
    p["memory_percent"] = 86.0                                    # mem_high (aging +1)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _netabuse(p: dict, i: int) -> dict:
    """[risk=NETWORK_ABUSE] inbound 폭주 + 지속 외부 endpoint(볼류메트릭 남용)."""
    p["inbound_mb"] = 130.0 + i * 4
    p["external_packet_count"] = 12                              # persistent_ext (avg>=8)
    p["external_connection_count"] = 12
    p["derived_features"].update(unique_remote_ip_count=10, duplicate_connection_count=2)
    return p


def _gpu_asymmetric(p: dict, i: int) -> dict:
    """[non-fast] GPU 96% 고정인데 CPU 거의 0(R4 극단 비대칭). 전형적 GPU 채굴."""
    p["cpu_percent"] = 3.0 + random.uniform(0, 3)
    p["gpu"].update(load_percent=96.0 + (i % 3), memory_used_mb=1200.0, memory_percent=9.8,
                    sm_utilization=97, tensor_core_active=0, power_draw_w=170.0, temperature=82.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.1
    p["top_processes"] = [
        {"pid": 8100, "name": "gpu_svc.exe", "cpu_percent": 2.0, "memory_percent": 3.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _sm_mining(p: dict, i: int) -> dict:
    """[non-fast] SM 사용률 높음+텐서0+VRAM낮음(연산은 도는데 텐서 미사용 = 채굴 시그니처)."""
    p["cpu_percent"] = 9.0 + random.uniform(0, 4)
    p["gpu"].update(load_percent=90.0 + (i % 4), memory_used_mb=900.0, memory_percent=7.3,
                    sm_utilization=95, tensor_core_active=0, power_draw_w=145.0, temperature=77.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _cpu_idle_load(p: dict, i: int) -> dict:
    """[non-fast] 사용자 자리비움(40분)인데 CPU 풀가동(S1, 야간 무단 연산 의심)."""
    p["cpu_percent"] = 95.0 + (i % 3)
    p["gpu"].update(load_percent=6.0, sm_utilization=3)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 8200, "name": "svc_worker.exe", "cpu_percent": 93.0, "memory_percent": 5.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(user_idle_ms=2_400_000, top_process_cpu_sum_normalized=0.93,
                                 unique_remote_ip_count=3)
    return p


def _cpu_disk_idle(p: dict, i: int) -> dict:
    """[non-fast] CPU 고부하인데 디스크 입출력 거의 0(S3, 연산만/입출력 없음)."""
    p["cpu_percent"] = 95.0 + (i % 3)
    p["gpu"].update(load_percent=6.0)
    p["disk_read_mb"] = 0.05; p["disk_write_mb"] = 0.05
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 8300, "name": "calc_node.exe", "cpu_percent": 93.0, "memory_percent": 4.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.93, unique_remote_ip_count=3)
    return p


def _wintemp_exec(p: dict, i: int) -> dict:
    """[non-fast] Windows\\Temp 에서 실행 + 고부하(다른 의심 경로)."""
    p["cpu_percent"] = 90.0 + (i % 4)
    p["gpu"].update(load_percent=8.0)
    p["external_packet_count"] = 10
    p["outbound_mb"] = 1.5
    wt = r"C:\Windows\Temp\msupd_helper.exe"
    p["top_processes"] = [
        {"pid": 8400, "name": "msupd_helper.exe", "cpu_percent": 88.0, "memory_percent": 5.0, "path": wt},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.88, unique_remote_ip_count=4)
    return p


def _recreation(p: dict, i: int) -> dict:
    """[risk=THREAT] watchdog 식 PID 재생성(동시 1개인데 PID 계속 바뀜)."""
    p["cpu_percent"] = 30.0 + random.uniform(0, 8)
    p["gpu"].update(load_percent=8.0)
    p["external_packet_count"] = 6
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 9000 + i, "name": "persist_svc.exe", "cpu_percent": 25.0, "memory_percent": 4.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _power_mismatch(p: dict, i: int) -> dict:
    """[risk=AGING] 전력만 높고 GPU 부하 낮음(전력 센서 이상/노후)."""
    p["cpu_percent"] = 16.0 + random.uniform(0, 5)
    p["gpu"].update(load_percent=12.0 + random.uniform(0, 4), memory_used_mb=1100.0, memory_percent=9.0,
                    sm_utilization=12, tensor_core_active=0, power_draw_w=92.0 + (i % 4), temperature=70.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _mem_runaway(p: dict, i: int) -> dict:
    """[risk=MALFUNCTION] 메모리 임계 + CPU 고부하 동시(폭주/누수 진행)."""
    p["cpu_percent"] = 92.0 + (i % 3)
    p["memory_percent"] = 97.0 + (i % 2)
    p["memory_used_gb"] = 15.6
    p["gpu"].update(load_percent=5.0)
    p["disk_write_mb"] = 0.1; p["outbound_mb"] = 0.05
    p["top_processes"] = [
        {"pid": 8600, "name": "proc_host.exe", "cpu_percent": 90.0, "memory_percent": 75.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.9, unique_remote_ip_count=1)
    return p


def _c2_beacon(p: dict, i: int) -> dict:
    """[risk=THREAT] 동일 외부 endpoint 지속 통신(C2 비콘 의심, 저대역)."""
    p["cpu_percent"] = 22.0 + random.uniform(0, 6)
    p["outbound_mb"] = 0.4
    p["external_packet_count"] = 10
    p["external_connection_count"] = 3
    p["external_connections"] = [
        {"pid": 9300, "proc_name": "svc_net.exe", "proc_path": APPDATA_BOT,
         "ip": "192.0.2.66", "port": 8443, "status": "ESTABLISHED"},
    ]
    p["top_processes"] = [
        {"pid": 9300, "name": "svc_net.exe", "cpu_percent": 18.0, "memory_percent": 4.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=1, duplicate_connection_count=11)
    return p


# ───────── 엣지케이스 (탐지 경계·FP 회피 검증, 전부 non-fast-path) ─────────
def _edge_gaming(p: dict, i: int) -> dict:
    """[edge] 게임으로 GPU·CPU 고부하 → 채굴처럼 보이나 is_gaming 감점(×0.4)으로 억제돼야."""
    p["cpu_percent"] = 75.0 + (i % 6)
    p["gpu"].update(load_percent=96.0 + (i % 3), memory_used_mb=7000.0, memory_percent=57.0,
                    sm_utilization=92, tensor_core_active=30, power_draw_w=190.0, temperature=74.0)
    p["top_processes"] = [
        {"pid": 5001, "name": "cyberpunk2077.exe", "cpu_percent": 70.0, "memory_percent": 40.0,
         "path": r"C:\Games\Cyberpunk2077\bin\x64\Cyberpunk2077.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 4.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["external_packet_count"] = 6
    p["derived_features"].update(top_process_cpu_sum_normalized=0.7, unique_remote_ip_count=4)
    return p


def _edge_compiling(p: dict, i: int) -> dict:
    """[edge] 빌드로 CPU flat 고부하 → CPU채굴처럼 보이나 is_compiling 감점(×0.5)으로 억제돼야."""
    p["cpu_percent"] = 97.0 + (i % 3)
    p["gpu"].update(load_percent=8.0)
    p["disk_write_mb"] = 6.0   # 빌드 산출물
    p["top_processes"] = [
        {"pid": 5002, "name": "cl.exe", "cpu_percent": 92.0, "memory_percent": 12.0,
         "path": r"C:\Program Files\MSVC\bin\cl.exe"},
        {"pid": 5003, "name": "link.exe", "cpu_percent": 30.0, "memory_percent": 6.0,
         "path": r"C:\Program Files\MSVC\bin\link.exe"},
    ]
    p["external_packet_count"] = 4
    p["derived_features"].update(top_process_cpu_sum_normalized=0.95, unique_remote_ip_count=2)
    return p


def _edge_ml_training(p: dict, i: int) -> dict:
    """[edge] 실제 ML 학습: GPU 고부하지만 텐서코어 활성 + VRAM 높음 + CPU도 씀(채굴과 구분)."""
    p["cpu_percent"] = 45.0 + random.uniform(0, 10)        # 데이터 로딩(gap 아님)
    p["gpu"].update(load_percent=95.0 + (i % 3), memory_used_mb=10500.0, memory_percent=85.4,  # VRAM 높음
                    sm_utilization=90, tensor_core_active=80,   # 텐서 활성 = 진짜 학습
                    power_draw_w=210.0, temperature=80.0)
    p["disk_read_mb"] = 12.0   # 데이터셋 읽기
    p["top_processes"] = [
        {"pid": 5004, "name": "python.exe", "cpu_percent": 42.0, "memory_percent": 30.0,
         "path": r"C:\Users\lab\miniconda3\python.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 4.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["external_packet_count"] = 6
    p["derived_features"].update(top_process_cpu_sum_normalized=0.42, unique_remote_ip_count=3)
    return p


def _edge_whitelist_highcpu(p: dict, i: int) -> dict:
    """[edge] 화이트리스트 앱(IDE)이 CPU 96% → unknown_process_active 면제되는지."""
    p["cpu_percent"] = 96.0 + (i % 3)
    p["gpu"].update(load_percent=10.0)
    p["top_processes"] = [
        {"pid": 5005, "name": "idea64.exe", "cpu_percent": 94.0, "memory_percent": 25.0,
         "path": r"C:\Program Files\JetBrains\IDEA\bin\idea64.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["external_packet_count"] = 5
    p["derived_features"].update(top_process_cpu_sum_normalized=0.94, unique_remote_ip_count=3)
    return p


def _edge_gpu_missing(p: dict, i: int) -> dict:
    """[edge] GPU 수집 실패 → GPU 신호가 0/False 로 잠기지 않고 '측정 불가' 처리되는지."""
    p["cpu_percent"] = 30.0 + random.uniform(0, 8)
    p["gpu"] = None
    p["derived_features"]["gpu_metrics_missing_reason"] = "nvml_init_failed"
    p["external_packet_count"] = 5
    return p


def _edge_net_missing(p: dict, i: int) -> dict:
    """[edge] 네트워크 수집 실패 → network 신호 잠금(측정 불가). 고부하만 있어도 net 미발화."""
    p["cpu_percent"] = 96.0 + (i % 3)                      # 자원 신호는 정상
    p["gpu"].update(load_percent=8.0)
    p["external_packet_count"] = 0
    p["derived_features"]["network_collection_missing_reason"] = "pcap_permission_denied"
    p["top_processes"] = [
        {"pid": 5006, "name": "calc.exe", "cpu_percent": 94.0, "memory_percent": 5.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.94)
    return p


def _edge_truncated_conns(p: dict, i: int) -> dict:
    """[edge] 외부 연결 목록 truncated → network 점수 0(가시성 저하)으로 안전 처리되는지."""
    p["cpu_percent"] = 25.0 + random.uniform(0, 6)
    p["gpu"].update(load_percent=8.0)
    p["external_packet_count"] = 50 + i
    p["external_connection_count"] = 500
    p["derived_features"].update(external_connection_count_truncated=True,
                                 unique_remote_ip_count=200, duplicate_connection_count=5)
    return p


def _edge_flapping(p: dict, i: int) -> dict:
    """[edge] CPU 가 40↔96 으로 요동 → cpu_flat(stddev<5) 미발화. 불안정 부하는 채굴 아님."""
    p["cpu_percent"] = 96.0 if i % 2 == 0 else 38.0        # 큰 진폭 → stddev 큼
    p["gpu"].update(load_percent=70.0 if i % 3 == 0 else 12.0)
    p["external_packet_count"] = 6
    p["top_processes"] = [
        {"pid": 5007, "name": "build_agent.exe", "cpu_percent": 90.0 if i % 2 == 0 else 30.0,
         "memory_percent": 8.0, "path": APPDATA_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _edge_dos_under_floor(p: dict, i: int) -> dict:
    """[edge] inbound 가 절대 floor(100MB) 바로 아래(95) → dos_spike 미발화(정상 대용량 다운로드)."""
    p["inbound_mb"] = 95.0 + (i % 4)                       # floor 100 미만
    p["external_packet_count"] = 60 + i
    p["external_connection_count"] = 3
    p["derived_features"].update(unique_remote_ip_count=2, duplicate_connection_count=1)
    return p


def _edge_cap_exempt(p: dict, i: int) -> dict:
    """[edge] 네트워크 신호 + single_core_full(캡 면제) → network-only 캡이 적용 안 되는지."""
    p["cpu_percent"] = 13.0 + random.uniform(0, 3)         # 전체 낮음
    p["gpu"].update(load_percent=6.0)
    p["outbound_mb"] = 12.0 + i                            # outbound_spike 노림
    p["external_packet_count"] = 40 + i
    p["external_connection_count"] = 8
    p["top_processes"] = [
        {"pid": 5008, "name": "single_loop.exe", "cpu_percent": 99.0, "memory_percent": 4.0, "path": TEMP_BOT},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(single_core_max_percent=99.0, unique_remote_ip_count=8,
                                 duplicate_connection_count=0)
    return p


def _edge_idle(p: dict, i: int) -> dict:
    """[edge] 완전 유휴(거의 0) → 정상 baseline. 어떤 신호도 안 떠야."""
    p["cpu_percent"] = 1.0 + random.uniform(0, 2)
    p["memory_percent"] = 20.0
    p["gpu"].update(load_percent=1.0, sm_utilization=0, power_draw_w=15.0)
    p["disk_read_mb"] = 0.01; p["disk_write_mb"] = 0.01
    p["inbound_mb"] = 0.0; p["outbound_mb"] = 0.0
    p["external_packet_count"] = 0
    p["top_processes"] = [
        {"pid": 800, "name": "explorer.exe", "cpu_percent": 0.5, "memory_percent": 3.0, "path": EXPLORER},
    ]
    return p


# ───── 레드팀: 정상인데 오탐 유발 노림 (adversarial FP, fast-path 없음) ─────
# 모두 "합법적 사용"을 표현하되, 시스템의 자원-신호 한계/화이트리스트 누락을 공략.
PROGFILES = r"C:\Program Files"
APPDATA_LOCAL = r"C:\Users\lab\AppData\Local"
APPDATA_ROAM = r"C:\Users\lab\AppData\Roaming"


def _fp_gpu_compute(p: dict, i: int) -> dict:
    """[FP노림] 정상 분산컴퓨팅(BOINC/folding) — GPU flat 95%, VRAM 낮음, 텐서0, CPU 낮음.
    채굴 시그니처와 동일. 화이트리스트에 없는 정상 과학연산 → 채굴로 오인 노림."""
    p["cpu_percent"] = 8.0 + random.uniform(0, 4)          # gpu_cpu_gap
    p["gpu"].update(load_percent=96.0 + (i % 3), memory_used_mb=700.0, memory_percent=5.7,  # vram_low
                    sm_utilization=97, tensor_core_active=0, power_draw_w=175.0, temperature=81.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.2
    p["top_processes"] = [
        {"pid": 6001, "name": "boinc.exe", "cpu_percent": 6.0, "memory_percent": 4.0,
         "path": PROGFILES + r"\BOINC\boinc.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.1, unique_remote_ip_count=3)
    return p


def _fp_render_both(p: dict, i: int) -> dict:
    """[FP노림] 정상 3D 렌더(V-Ray/Octane — 화이트리스트 없음) — CPU+GPU flat 동시 고부하."""
    p["cpu_percent"] = 92.0 + (i % 4)
    p["gpu"].update(load_percent=95.0 + (i % 3), memory_used_mb=1200.0, memory_percent=9.8,
                    sm_utilization=96, tensor_core_active=0, power_draw_w=165.0, temperature=80.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 6002, "name": "vray.exe", "cpu_percent": 89.0, "memory_percent": 18.0,
         "path": PROGFILES + r"\Chaos\V-Ray\vray.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 2.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.89, unique_remote_ip_count=3)
    return p


def _fp_cpu_science(p: dict, i: int) -> dict:
    """[FP노림] 정상 과학연산(MATLAB/시뮬, 화이트리스트 없음) — CPU flat 97% 야간 지속."""
    p["cpu_percent"] = 97.0 + (i % 3)
    p["gpu"].update(load_percent=4.0, sm_utilization=2)
    p["disk_write_mb"] = 0.2
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 6003, "name": "matlab.exe", "cpu_percent": 95.0, "memory_percent": 22.0,
         "path": PROGFILES + r"\MATLAB\R2025a\bin\matlab.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 1.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.95, user_idle_ms=2_700_000,  # 야간 자리비움
                                 unique_remote_ip_count=3)
    return p


def _fp_vram_hog(p: dict, i: int) -> dict:
    """[FP노림] 정상인데 VRAM 가득(다중 디스플레이/캐시) + GPU 거의 idle → stealth_mismatch_vram."""
    p["cpu_percent"] = 15.0 + random.uniform(0, 5)
    p["gpu"].update(load_percent=12.0 + random.uniform(0, 4),   # gpu<20
                    memory_used_mb=9600.0, memory_percent=78.1,  # vram>0.7
                    sm_utilization=10, tensor_core_active=0, power_draw_w=55.0, temperature=58.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 6004, "name": "chrome.exe", "cpu_percent": 10.0, "memory_percent": 20.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _fp_power_idle(p: dict, i: int) -> dict:
    """[FP노림] 워크스테이션 GPU 가 idle 인데 전력 높게 유지(하드웨어 특성) → stealth_mismatch_power."""
    p["cpu_percent"] = 16.0 + random.uniform(0, 5)
    p["gpu"].update(load_percent=14.0 + random.uniform(0, 5),   # avg<30
                    memory_used_mb=1100.0, memory_percent=9.0,
                    sm_utilization=12, tensor_core_active=0,
                    power_draw_w=95.0 + (i % 4), temperature=62.0)  # avg_power>=80
    p["external_packet_count"] = 9
    p["outbound_mb"] = 1.0
    p["top_processes"] = [
        {"pid": 6005, "name": "chrome.exe", "cpu_percent": 12.0, "memory_percent": 14.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=3)
    return p


def _fp_appdata_upload(p: dict, i: int) -> dict:
    """[FP노림] 정상 AppData 앱(Teams — 화이트리스트 누락)이 대용량 업로드 → 의심소유+exfil 노림."""
    teams = APPDATA_LOCAL + r"\Microsoft\Teams\current\Teams.exe"
    p["cpu_percent"] = 35.0 + random.uniform(0, 8)
    p["outbound_mb"] = 14.0 + i                            # 회의 녹화/파일 업로드
    p["disk_write_mb"] = 2.0
    p["external_packet_count"] = 30 + i
    p["external_connection_count"] = 6
    p["external_connections"] = [
        {"pid": 6006, "proc_name": "teams.exe", "proc_path": teams,
         "ip": "52.112.10.5", "port": 443, "status": "ESTABLISHED"},
    ]
    p["top_processes"] = [
        {"pid": 6006, "name": "teams.exe", "cpu_percent": 30.0, "memory_percent": 15.0, "path": teams},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 4.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=6, duplicate_connection_count=2)
    return p


def _fp_backup_burst(p: dict, i: int) -> dict:
    """[FP노림] 정상 클라우드 백업(주기적 대용량 업로드 버스트) → outbound_spike 반복 발화 노림."""
    # 짝수 라운드만 폭주 → 평균 대비 spike 가 계속 살아있게
    p["cpu_percent"] = 25.0 + random.uniform(0, 6)
    p["outbound_mb"] = 30.0 if i % 2 == 0 else 0.05
    p["disk_read_mb"] = 20.0 if i % 2 == 0 else 0.1
    p["external_packet_count"] = 20 + i
    p["external_connection_count"] = 4
    p["external_connections"] = [
        {"pid": 6007, "proc_name": "backup_agent.exe", "proc_path": PROGFILES + r"\Acronis\backup_agent.exe",
         "ip": "13.107.42.14", "port": 443, "status": "ESTABLISHED"},
    ]
    p["top_processes"] = [
        {"pid": 6007, "name": "backup_agent.exe", "cpu_percent": 20.0, "memory_percent": 6.0,
         "path": PROGFILES + r"\Acronis\backup_agent.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(unique_remote_ip_count=2, duplicate_connection_count=0)
    return p


def _fp_video_encode(p: dict, i: int) -> dict:
    """[FP노림] 정상 스트리밍 인코딩(OBS — 화이트리스트 없음) — GPU 인코더 풀가동+flat."""
    p["cpu_percent"] = 30.0 + random.uniform(0, 8)
    p["gpu"].update(load_percent=93.0 + (i % 3), memory_used_mb=1500.0, memory_percent=12.2,  # vram 낮음
                    sm_utilization=88, tensor_core_active=0, power_draw_w=150.0, temperature=76.0)
    p["external_packet_count"] = 9
    p["outbound_mb"] = 6.0                                 # 스트리밍 송출
    p["top_processes"] = [
        {"pid": 6008, "name": "obs64.exe", "cpu_percent": 28.0, "memory_percent": 10.0,
         "path": PROGFILES + r"\obs-studio\bin\64bit\obs64.exe"},
        {"pid": 1200, "name": "chrome.exe", "cpu_percent": 3.0, "memory_percent": 9.0, "path": CHROME},
    ]
    p["derived_features"].update(top_process_cpu_sum_normalized=0.3, unique_remote_ip_count=3)
    return p


SCENARIOS = {
    "normal":          lambda p, i: p,
    # ── 채굴(fast-path, 알려진 프로세스 → 즉시 HIGH) ──
    "miner":           _miner,           # CPU 채굴(xmrig)
    "miner_gpu":       _miner_gpu,       # GPU 채굴(t-rex)
    # ── 자원 클러스터(non-fast, 점수+게이팅) ──
    "gpu_stealth":     _gpu_stealth,     # GPU 고정고부하+CPU낮음
    "gpu_cpu_both":    _gpu_cpu_both,    # CPU·GPU 동시 고부하
    "gpu_cpu_heavy":   _gpu_cpu_heavy,   # GPU+CPU 둘 다 강함(HIGH 노림)
    "vram_miner":      _vram_miner,      # GPU flat+VRAM낮음+전력안정
    "gpu_asymmetric":  _gpu_asymmetric,  # GPU 96% / CPU≈0 극단 비대칭
    "sm_mining":       _sm_mining,       # SM 높음+텐서0(채굴 연산)
    "cpu_miner":       _cpu_miner,       # CPU flat + 미상 프로세스
    "cpu_single_core": _cpu_single_core, # 단일코어 풀가동
    "cpu_idle_load":   _cpu_idle_load,   # 자리비움+CPU풀가동(S1)
    "cpu_disk_idle":   _cpu_disk_idle,   # CPU고부하+디스크0(S3)
    # ── 프로세스 경로/은닉 ──
    "temp_dropper":    _temp_dropper,    # 임시폴더 실행 고부하
    "wintemp_exec":    _wintemp_exec,    # Windows\\Temp 실행 고부하
    "appdata_beacon":  _appdata_beacon,  # AppData + 지속 outbound
    "recreation":      _recreation,      # watchdog PID 재생성
    "c2_beacon":       _c2_beacon,       # 동일 endpoint 지속(C2)
    # ── 스텔스/노후(AGING) ──
    "stealth_power":   _stealth_power,   # 전력↔부하 모순
    "stealth_vram":    _stealth_vram,    # VRAM↔부하 모순
    "power_mismatch":  _power_mismatch,  # 전력만 높음(센서 이상)
    "aging":           _aging,           # 전력/VRAM 모순+고온(AGING)
    # ── 유지보수/오작동(MALFUNCTION) ──
    "mem_leak":        _mem_leak,        # 메모리 누수 의심
    "runaway":         _runaway,         # 고부하 무진척
    "mem_runaway":     _mem_runaway,     # 메모리임계+CPU고부하
    # ── 네트워크 단독(의도적 억제) ──
    "exfil":           _exfil,
    "dos":             _dos,
    "port_scan":       _port_scan,
    "netabuse":        _netabuse,        # inbound 폭주+지속endpoint
    # ── 엣지케이스(탐지 경계·FP 회피 검증, non-fast-path) ──
    "edge_gaming":        _edge_gaming,        # 게임 고부하 → 감점 억제
    "edge_compiling":     _edge_compiling,     # 빌드 고부하 → 감점 억제
    "edge_ml_training":   _edge_ml_training,   # ML 학습(텐서활성) vs 채굴 구분
    "edge_wl_highcpu":    _edge_whitelist_highcpu,  # 화이트리스트 앱 고CPU
    "edge_gpu_missing":   _edge_gpu_missing,   # GPU 수집 실패
    "edge_net_missing":   _edge_net_missing,   # 네트워크 수집 실패
    "edge_truncated":     _edge_truncated_conns,  # 연결 목록 truncated
    "edge_flapping":      _edge_flapping,      # CPU 요동(flat 미발화)
    "edge_dos_floor":     _edge_dos_under_floor,  # inbound floor 바로 아래
    "edge_cap_exempt":    _edge_cap_exempt,    # 캡 면제(single_core)
    "edge_idle":          _edge_idle,          # 완전 유휴 baseline
    # ── 레드팀: 정상인데 오탐 유발 노림(adversarial FP, fast-path 없음) ──
    "fp_gpu_compute":  _fp_gpu_compute,   # 분산컴퓨팅(BOINC) ↔ GPU채굴 구분불가
    "fp_render_both":  _fp_render_both,   # 3D 렌더(V-Ray) CPU+GPU
    "fp_cpu_science":  _fp_cpu_science,   # MATLAB 야간 연산
    "fp_vram_hog":     _fp_vram_hog,      # VRAM 가득(정상) → 스텔스 오인
    "fp_power_idle":   _fp_power_idle,    # GPU idle 고전력(HW특성) → 스텔스 오인
    "fp_appdata_upload": _fp_appdata_upload,  # Teams(WL누락) AppData 업로드
    "fp_backup_burst": _fp_backup_burst,  # 클라우드 백업 주기 업로드
    "fp_video_encode": _fp_video_encode,  # OBS 스트리밍 인코딩
}


# ───────────────────────── 유틸 ─────────────────────────
def load_keys(path: str) -> dict:
    keys = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) >= 2 and row[0].strip():
                keys[row[0].strip()] = row[1].strip()
    if not keys:
        raise SystemExit(f"키를 못 읽음: {path}")
    return keys


def parse_pcs(spec: str) -> list:
    """'PC-11..PC-40' 범위 또는 'PC-11,PC-12' 목록."""
    spec = spec.strip()
    if ".." in spec:
        a, b = spec.split("..", 1)
        pre = a.rsplit("-", 1)[0]
        lo = int(a.rsplit("-", 1)[1]); hi = int(b.rsplit("-", 1)[1])
        w = len(a.rsplit("-", 1)[1])
        return [f"{pre}-{str(n).zfill(w)}" for n in range(lo, hi + 1)]
    return [s.strip() for s in spec.split(",") if s.strip()]


def parse_danger(items: list) -> dict:
    """['PC-13:miner', 'PC-20:gpu_stealth'] → {pc: scenario}."""
    out = {}
    for it in items or []:
        if ":" not in it:
            raise SystemExit(f"--danger 형식은 PC-XX:scenario (받음: {it})")
        pc, sc = it.split(":", 1)
        if sc not in SCENARIOS:
            raise SystemExit(f"알 수 없는 시나리오 '{sc}'. 가능: {', '.join(SCENARIOS)}")
        out[pc.strip()] = sc.strip()
    return out


def build_payload(pc_id: str, scenario: str, i: int) -> dict:
    return SCENARIOS[scenario](_base(pc_id, i), i)


def send(url: str, key: str, payload: dict, timeout: float = 5.0):
    return requests.post(url, json=payload,
                         headers={"X-API-Key": key, "Content-Type": "application/json"},
                         timeout=timeout)


# ───────────────────────── 메인 루프 ─────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description="RADA 가상 PC 플릿 시뮬레이터(로컬 전용)")
    ap.add_argument("--keys", default="../RADA-deploy/keys.csv", help="keys.csv 경로(pc_id,raw_key,...)")
    ap.add_argument("--url", default="http://localhost:8080/api/metrics", help="Spring 수집 엔드포인트")
    ap.add_argument("--pcs", required=True, help="시뮬 대상: 'PC-11..PC-40' 또는 'PC-11,PC-12'")
    ap.add_argument("--danger", nargs="*", default=[], help="위험 PC 지정: PC-13:miner PC-20:gpu_stealth ...")
    ap.add_argument("--interval", type=float, default=5.0, help="전송 주기 초(기본 5, 실제 클라이언트와 동일)")
    ap.add_argument("--once", action="store_true", help="한 라운드만 전송 후 종료")
    ap.add_argument("--dry-run", action="store_true", help="전송하지 않고 대상/시나리오만 출력")
    args = ap.parse_args(argv)

    pcs = parse_pcs(args.pcs)
    danger = parse_danger(args.danger)
    bad = [pc for pc in danger if pc not in pcs]
    if bad:
        raise SystemExit(f"--danger 의 PC 가 --pcs 범위 밖: {bad}")

    keys = load_keys(args.keys) if not args.dry_run else {}
    if not args.dry_run:
        missing = [pc for pc in pcs if pc not in keys]
        if missing:
            raise SystemExit(f"keys.csv 에 키 없는 PC: {missing}\n(provision_pcs.py 로 발급 필요)")

    plan = [(pc, danger.get(pc, "normal")) for pc in pcs]
    n_danger = sum(1 for _, s in plan if s != "normal")
    print(f"대상 {len(pcs)}대 | 위험 {n_danger}대 | 주기 {args.interval}s | {args.url}")
    for pc, sc in plan:
        if sc != "normal":
            print(f"  [!] {pc}: {sc}")
    if args.dry_run:
        import json
        pc0, sc0 = plan[0]
        print(f"\n[dry-run] {pc0}({sc0}) 샘플 페이로드:")
        print(json.dumps(build_payload(pc0, sc0, 0), ensure_ascii=False, indent=2)[:1400])
        return 0

    def handle_sigint(*_):
        _STOP.set()
    try:
        signal.signal(signal.SIGINT, handle_sigint)
    except Exception:
        pass

    rounds = 0
    while not _STOP.is_set():
        ok = err = 0
        t0 = time.time()
        for pc, sc in plan:
            if _STOP.is_set():
                break
            try:
                r = send(args.url, keys[pc], build_payload(pc, sc, rounds))
                if r.status_code in (200, 202):
                    ok += 1
                else:
                    err += 1
                    if err <= 3:
                        print(f"  ERR {pc} {r.status_code} {r.text[:120]}")
            except Exception as e:
                err += 1
                if err <= 3:
                    print(f"  EXC {pc} {e}")
        rounds += 1
        ts = datetime.now(KST).strftime("%H:%M:%S")
        print(f"[{ts}] round {rounds}: 전송 OK={ok} ERR={err} ({time.time()-t0:.1f}s)")
        if args.once:
            break
        _STOP.wait(max(0.0, args.interval - (time.time() - t0)))
    print("종료.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
