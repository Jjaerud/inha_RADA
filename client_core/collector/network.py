"""네트워크 수집기 (5초 증분 + 외부 연결 필터)."""
from __future__ import annotations

import ipaddress
from typing import Dict, Iterable, Optional, Set

import psutil

from .base import BaseCollector


def is_internal_ip(ip: str) -> bool:
    """ipaddress.is_private 기반. 사설망(10/8, 172.16-31, 192.168/16 등)이면 True."""
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


class NetworkCollector(BaseCollector):
    """net_io_counters 증분 + 외부 연결 카운트.

    - 첫 호출은 이전 누적값이 없어 0을 리턴(워밍업).
    - 외부 IP & 비표준 포트만 의심 트래픽으로 카운트.
    """

    CAP = 10

    def __init__(self, normal_ports: Optional[Iterable[int]] = None) -> None:
        self._prev = None
        self.normal_ports: Set[int] = set(normal_ports or [])

    @staticmethod
    def _resolve_owner(pid: int) -> Dict[str, str]:
        """pid → {name, path}. 권한/소멸 예외는 빈 값으로 흡수 (best-effort)."""
        try:
            p = psutil.Process(pid)
            name = ""
            path = ""
            try:
                name = p.name() or ""
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                pass
            try:
                path = p.exe() or ""
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                pass
            return {"name": name, "path": path}
        except Exception:
            return {"name": "", "path": ""}

    def collect(self) -> Dict:
        net = psutil.net_io_counters()
        if self._prev is None:
            inbound_delta = outbound_delta = 0.0
        else:
            inbound_delta = max(
                0.0, round((net.bytes_recv - self._prev.bytes_recv) / (1024 ** 2), 4)
            )
            outbound_delta = max(
                0.0, round((net.bytes_sent - self._prev.bytes_sent) / (1024 ** 2), 4)
            )
        self._prev = net

        external_connections_raw = []
        active_ports: Set[int] = set()
        unique_ips: Set[str] = set()
        unique_ports: Set[int] = set()
        unique_pids: Set[int] = set()
        missing_reason: Optional[str] = None
        try:
            for conn in psutil.net_connections(kind="inet"):
                if conn.laddr:
                    active_ports.add(conn.laddr.port)
                if conn.raddr and conn.raddr.ip:
                    rip = conn.raddr.ip
                    rport = conn.raddr.port
                    active_ports.add(rport)
                    if is_internal_ip(rip) or rport in self.normal_ports:
                        continue
                    pid = getattr(conn, "pid", None)
                    external_connections_raw.append(
                        {"ip": rip, "port": rport, "status": conn.status, "pid": pid}
                    )
                    unique_ips.add(rip)
                    unique_ports.add(rport)
                    if pid is not None:
                        unique_pids.add(pid)
        except PermissionError:
            missing_reason = "permission_error"
        except OSError:
            missing_reason = "os_error"
        except Exception:
            missing_reason = "unknown"

        raw_count = len(external_connections_raw)
        # 중복: (ip, port, pid) 3중쌍 동일 → 중복 1건
        seen_triples = set()
        duplicate_count = 0
        for c in external_connections_raw:
            key = (c["ip"], c["port"], c.get("pid"))
            if key in seen_triples:
                duplicate_count += 1
            else:
                seen_triples.add(key)

        # #3 (PID 귀속): cap 적용 응답에 pid + owner(name/path) 부착.
        # 기존 키(ip/port/status)는 보존하고 sub-dict 만 확장(22키 top-level 불변).
        # owner 해석은 capped (≤CAP) 항목에 한해 best-effort — 채굴/백도어가
        # 저-CPU 라 top_processes(상위 10) 에 안 잡혀도, 외부 연결의 소유
        # 프로세스 경로(appdata/temp 등)를 서버가 직접 볼 수 있게 한다.
        owner_cache: Dict[int, Dict[str, str]] = {}
        capped = []
        for c in external_connections_raw[: self.CAP]:
            entry = {"ip": c["ip"], "port": c["port"], "status": c["status"]}
            pid = c.get("pid")
            entry["pid"] = pid
            if pid is not None:
                if pid not in owner_cache:
                    owner_cache[pid] = self._resolve_owner(pid)
                entry["proc_name"] = owner_cache[pid].get("name", "")
                entry["proc_path"] = owner_cache[pid].get("path", "")
            else:
                entry["proc_name"] = ""
                entry["proc_path"] = ""
            capped.append(entry)

        return {
            "inbound_delta_mb": inbound_delta,
            "outbound_delta_mb": outbound_delta,
            "inbound_total_mb": round(net.bytes_recv / (1024 ** 2), 2),
            "outbound_total_mb": round(net.bytes_sent / (1024 ** 2), 2),
            "external_connection_count": raw_count,
            "external_connections": capped,
            "active_ports": list(active_ports),
            "external_connection_count_raw": raw_count,
            "external_connection_count_truncated": raw_count > self.CAP,
            "unique_remote_ip_count": len(unique_ips),
            "unique_remote_port_count": len(unique_ports),
            "unique_remote_process_count": len(unique_pids),
            "duplicate_connection_count": duplicate_count,
            "network_collection_missing_reason": missing_reason,
        }
