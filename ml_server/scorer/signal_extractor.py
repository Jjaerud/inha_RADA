"""Layer 1 — 24개 원자 단위 신호 추출 (판단 없음).

네트워크 규칙 기반 신호 단독 + GPU/CPU/메모리/프로세스/스텔스 모순 신호 포함.
"""
import statistics
from typing import Dict, Any
from collections import deque

from ..config import (
    GAME_RENDER_PROCESSES, COMPILE_ENCODE_PROCESSES,
    MINING_PROCESSES, MINING_POOL_IPS, SUSPICIOUS_PATHS, WHITELIST_PROCESSES,
)
from ..model.requests import MetricsRequest
from ..policy import get_allowlist


def _effective_whitelist() -> set:
    """기존 WHITELIST_PROCESSES + YAML allowlist union (대소문자 무시)."""
    base = {p.lower() for p in WHITELIST_PROCESSES}
    try:
        al = get_allowlist()
        base |= {p.lower() for p in al.whitelist_processes}
    except Exception:
        pass
    return base


def _detect_process_recreation(history_list: list, whitelist_eff: set) -> bool:
    """#6 (process_recreation): 동일 프로세스(name+path)가 동시 인스턴스는 적은데
    PID 만 계속 바뀌며 재등장 = watchdog 식 재생성(채굴/악성 지속성) 의심.

    multi-process 앱(chrome/svchost 등 동시 다수 PID)과 구분하기 위해
    'concurrent_max ≤ 2' 조건을 둔다. 화이트리스트/PID 없는 항목은 제외.
    ADDITIVE — legacy 점수 미반영(risk_vector 전용).
    """
    from collections import defaultdict

    snaps = [h.get("top_processes", []) for h in history_list]
    snaps = [s for s in snaps if isinstance(s, list)]
    if len(snaps) < 6:
        return False

    concurrent_max: dict = defaultdict(int)
    pids_over_time: dict = defaultdict(set)
    presence: dict = defaultdict(int)
    for s in snaps:
        per_snap: dict = defaultdict(set)
        for p in s:
            if not isinstance(p, dict):
                continue
            name = (p.get("name", "") or "").lower()
            if not name or name in whitelist_eff:
                continue
            pid = p.get("pid")
            if pid is None:
                continue
            ident = (name, (p.get("path", "") or "").lower())
            per_snap[ident].add(pid)
        for ident, pidset in per_snap.items():
            concurrent_max[ident] = max(concurrent_max[ident], len(pidset))
            pids_over_time[ident] |= pidset
            presence[ident] += 1

    n = len(snaps)
    for ident, pids in pids_over_time.items():
        if (concurrent_max[ident] <= 2
                and len(pids) >= 3
                and presence[ident] >= max(3, n // 2)):
            return True
    return False


def extract_signals(metrics: MetricsRequest, history: deque, slot: str,
                    ml_weighted_score: float = 0.0) -> Dict[str, Any]:
    """원자 단위 24신호 + 컨텍스트 메타 반환.

    반환값에 signals(dict)와 메타(known_miners, mining_pool_ip_str, avg_inbound, dos_ratio)를
    함께 묶어 indicator/verdict 단계에서 재사용한다.
    """
    history_list = list(history)
    has_history  = len(history_list) >= 12
    whitelist_eff = _effective_whitelist()

    gpu = metrics.gpu

    running_procs = {p.get("name","").lower() for p in metrics.top_processes}
    is_gaming    = bool(running_procs & {g.lower() for g in GAME_RENDER_PROCESSES})
    is_compiling = bool(running_procs & {c.lower() for c in COMPILE_ENCODE_PROCESSES})

    # GPU 기초값
    gpu_pct    = gpu.load_percent      if gpu else 0.0
    vram_mb    = gpu.memory_used_mb    if gpu else 0.0
    vram_total = (gpu.memory_total_mb  if gpu else 0.0) or 8192.0
    tensor     = gpu.tensor_core_active if gpu else None
    power      = gpu.power_draw_w      if gpu else None
    sm         = gpu.sm_utilization    if gpu else None
    vram_ratio = vram_mb / vram_total
    gpu_active = gpu_pct >= 30.0

    gpu_stddev = vram_stddev = power_stddev = avg_power = avg_gpu_pct = None
    if has_history and gpu:
        gpu_vals = [h["gpu_percent"] for h in history_list if h.get("gpu_percent") is not None]
        if len(gpu_vals) >= 12:
            gpu_stddev  = statistics.stdev(gpu_vals)
            avg_gpu_pct = statistics.mean(gpu_vals)
        vram_vals = [h["gpu_vram_mb"] for h in history_list if h.get("gpu_vram_mb") is not None]
        if len(vram_vals) >= 12:
            vram_stddev = statistics.stdev(vram_vals)
        power_vals = [h["gpu_power_w"] for h in history_list if h.get("gpu_power_w")]
        if len(power_vals) >= 12:
            avg_power    = statistics.mean(power_vals)
            power_stddev = statistics.stdev(power_vals)

    cpu_stddev = avg_cpu = None
    if has_history:
        cpu_vals   = [h["cpu_percent"] for h in history_list]
        cpu_stddev = statistics.stdev(cpu_vals)
        avg_cpu    = statistics.mean(cpu_vals)

    avg_inbound = avg_outbound = avg_ext_count = 0.0
    outbound_stddev = None
    if has_history:
        avg_inbound  = statistics.mean([h["inbound_mb"]  for h in history_list])
        avg_outbound = statistics.mean([h["outbound_mb"] for h in history_list])
        avg_ext_count= statistics.mean([h["external_packet_count"] for h in history_list])
        ob_vals = [h["outbound_mb"] for h in history_list]
        if len(ob_vals) >= 2:
            outbound_stddev = statistics.stdev(ob_vals)

    # 네트워크 — 규칙 기반 (ML과 분리)
    mining_pool_hit = any(
        conn.get("ip","").startswith(prefix)
        for conn in metrics.external_connections
        for prefix in MINING_POOL_IPS
    )
    mining_pool_ip_str = next(
        (conn.get("ip","") for conn in metrics.external_connections
         if any(conn.get("ip","").startswith(p) for p in MINING_POOL_IPS)), ""
    )

    dos_ratio     = {"class": 30, "free": 15}.get(slot, 15)
    # P1-2 (docs/fp_field_analysis_v0.6.md §7-P1-2): dos_spike 조건에
    # 절대값 floor + 연속 발생 횟수 추가. baseline 0.03MB 일 때
    # 2.5MB 도 80배 ratio 가 되어 정상 download burst 가 dos 로 잡히는
    # 문제를 차단. 두 조건 모두 만족하지 못하면 streak reset.
    ratio_hit = avg_inbound > 0 and metrics.inbound_mb > avg_inbound * dos_ratio
    try:
        from ..policy import get_scoring_policy
        dd = get_scoring_policy().dos_detection
        floor_mb = float(dd.min_inbound_mb_per_5s)
        min_sustained = int(dd.min_sustained_count)
    except Exception:
        floor_mb = 0.0
        min_sustained = 1
    absolute_hit = metrics.inbound_mb >= floor_mb if floor_mb > 0 else True
    from ..storage import pc_history_store as _phs
    pc_id_for_streak = metrics.pc_id
    if ratio_hit and absolute_hit:
        new_streak = _phs.dos_spike_streak.get(pc_id_for_streak, 0) + 1
    else:
        new_streak = 0
    _phs.dos_spike_streak[pc_id_for_streak] = new_streak
    dos_spike_hit = (ratio_hit and absolute_hit and new_streak >= min_sustained)

    outbound_spike = (avg_outbound > 0.01
                      and metrics.outbound_mb > avg_outbound * 5
                      and metrics.outbound_mb > 1.0)

    # 프로세스
    known_miners = [p for p in metrics.top_processes
                    if p.get("name","").lower() in MINING_PROCESSES]
    temp_exec    = [p for p in metrics.top_processes
                    if any(sp in p.get("path","").lower() for sp in SUSPICIOUS_PATHS)
                    and p.get("name","").lower() not in whitelist_eff]

    # appdata 실행 (Roaming/Local AppData) — temp 와 별도 추적
    appdata_exec = [p for p in metrics.top_processes
                    if "\\appdata\\" in p.get("path","").lower()
                    and "\\appdata\\local\\temp\\" not in p.get("path","").lower()
                    and p.get("name","").lower() not in whitelist_eff]

    # exec_path_suspicious = temp 또는 appdata
    exec_path_suspicious = bool(temp_exec) or bool(appdata_exec)

    # unknown_process_active = top_processes 중 화이트리스트/마이너 외 cpu 80+ 프로세스
    # (50→80: 정상 고부하 앱이 50~80% 쓰는 구간을 제외해 FP 저감. 채굴은 거의
    #  100% 점유라 80 임계로도 탐지된다.)
    unknown_process_active = any(
        (p.get("name","").lower() not in whitelist_eff
         and p.get("name","").lower() not in MINING_PROCESSES
         and float(p.get("cpu_percent", 0) or 0) >= 80.0)
        for p in metrics.top_processes
    )

    # ── #3 (PID 귀속): 외부 연결의 소유 프로세스 경로로 직접 판단 ──
    # 저-CPU 백도어/채굴은 top_processes(상위 10 CPU)에 안 잡혀도, 외부 연결을
    # 소유한 프로세스의 경로(appdata/temp)가 의심스러우면 강한 위협 근거.
    # ADDITIVE: signals 에만 노출, legacy indicator 점수에는 미반영(risk_vector 전용).
    def _suspicious_owner_path(path: str) -> bool:
        pl = (path or "").lower()
        if not pl:
            return False
        if "\\appdata\\" in pl:
            return True
        return any(sp in pl for sp in SUSPICIOUS_PATHS)

    external_conn_suspicious_owner = any(
        _suspicious_owner_path(conn.get("proc_path", ""))
        and (conn.get("proc_name", "").lower() not in whitelist_eff)
        for conn in metrics.external_connections
        if isinstance(conn, dict)
    )

    persistent_miner = has_history and len(known_miners) > 0 and any(
        sum(1 for h in history_list
            if any(p.get("name","").lower() == m.get("name","").lower()
                   for p in h.get("top_processes",[]))) >= 6
        for m in known_miners
    )

    # 스텔스 모순(Mismatch)
    stealth_mismatch_power = (avg_power    is not None
                               and avg_gpu_pct is not None
                               and avg_power    >= 80.0
                               and avg_gpu_pct  < 30.0)
    stealth_mismatch_vram  = (vram_ratio > 0.7
                               and gpu_pct < 20.0)

    # ── 파생 신호 (3단계 신규) ──
    # net_out_sustained: 평균 대비 outbound 가 1.5배 이상 유지 + 절대값 임계
    net_out_sustained = (avg_outbound > 0.005
                          and metrics.outbound_mb >= max(avg_outbound * 1.5, 0.5))

    # disk_write 와 동시 발생
    disk_write_net_out_sustained = (
        metrics.disk_write_mb >= 1.0 and net_out_sustained
    )

    # derived_features 활용
    df = getattr(metrics, "derived_features", None) or {}
    if not isinstance(df, dict):
        df = {}
    top_cpu_norm = float(df.get("top_process_cpu_sum_normalized") or 0.0)
    ext_truncated = bool(df.get("external_connection_count_truncated") or False)
    unique_remote_ip_count = int(df.get("unique_remote_ip_count") or 0)
    duplicate_connection_count = int(df.get("duplicate_connection_count") or 0)
    gpu_missing_reason = df.get("gpu_metrics_missing_reason")
    # GPU partial failure: collector 가 반환하는 sub-field 별 실패 사유 리스트.
    # signal_extractor 는 None 인 sub-field 를 0 으로 잠그지 않고 skip 해야 한다.
    gpu_partial_failure_reasons: list = []
    if gpu is not None:
        raw = getattr(gpu, "gpu_partial_failure_reasons", None)
        if isinstance(raw, list):
            gpu_partial_failure_reasons = list(raw)
    network_missing_reason = df.get("network_collection_missing_reason")
    process_missing_reason = df.get("process_collection_missing_reason")
    derived_missing_reasons = df.get("derived_missing_reasons") or {}

    # signals_missing: 수집 실패한 카테고리. 점수 0 으로 잠그는 게 아니라
    # "측정 불가" 임을 명시해 silent fail 을 방지한다.
    signals_missing: list = []
    if network_missing_reason:
        signals_missing.append("network")
    if process_missing_reason:
        signals_missing.append("process")
    if derived_missing_reasons:
        signals_missing.append("derived_features")
    if gpu_partial_failure_reasons:
        signals_missing.append("gpu_partial")

    # new_remote_ip_burst: unique ip 가 급증 (>=8 또는 duplicate 적고 unique 많음)
    new_remote_ip_burst = (
        unique_remote_ip_count >= 8 and duplicate_connection_count < unique_remote_ip_count
    )

    mining_process_or_pool = (len(known_miners) > 0) or mining_pool_hit

    # ── #3 (per-core CPU): single-core-pegged 채굴 시그니처 ──
    # 한 코어만 ~100% 인데 전체 CPU 는 낮음 = 단일 스레드 채굴/루프 의심.
    # ADDITIVE: signals 에만 노출, legacy 점수 미반영(risk_vector 전용).
    single_core_max_pct = float(df.get("single_core_max_percent") or 0.0)
    _cores = int(getattr(metrics, "cpu_core_count", 0) or 0)
    if _cores <= 0:
        _per_core = df.get("per_core_cpu_percent") or []
        _cores = len(_per_core) if isinstance(_per_core, list) else 1
    _cores = max(_cores, 1)
    # 코어 1개 풀가동 시 기대 aggregate ≈ 100/cores. 최대 2코어 분량 이하일 때만 발화.
    _one_core_aggregate = 100.0 / _cores
    single_core_full = (
        single_core_max_pct >= 90.0
        and metrics.cpu_percent <= _one_core_aggregate * 2.0
    )

    # #6 (process_recreation): history 기반 PID churn 탐지 (ADDITIVE).
    process_recreation = _detect_process_recreation(history_list, whitelist_eff)

    # spike_count_1m: external_packet_count 의 1분(12건) 합 ≥ 60 일 때 trigger
    # 단독 신호로는 0점 (indicator_calculator 에서 처리)
    spike_count_1m = metrics.external_packet_count >= 8  # 기존 net_external_high 와 동치

    signals: Dict[str, Any] = {
        "is_gaming":        is_gaming,
        "is_compiling":     is_compiling,
        "gpu_active":       gpu_active,
        "gpu_high":         gpu_pct >= 70,
        "gpu_flat":         (gpu_stddev is not None
                             and gpu_stddev < 5.0
                             and gpu_active),
        "gpu_cpu_gap":      gpu_pct >= 70 and metrics.cpu_percent < 20,
        "vram_low":         vram_ratio < 0.3 and gpu_active,
        "vram_stable":      (vram_stddev is not None
                             and vram_stddev < 50
                             and gpu_active),
        "power_stable":     (power_stddev is not None
                             and power_stddev < 10.0
                             and gpu_active
                             and avg_power is not None
                             and avg_power >= 60.0),
        "tensor_inactive":  tensor is not None and tensor == 0 and gpu_active,
        "sm_high":          sm is not None and sm >= 70,
        "stealth_mismatch_power": stealth_mismatch_power,
        "stealth_mismatch_vram":  stealth_mismatch_vram,
        "cpu_high":         metrics.cpu_percent >= 80,
        "cpu_flat":         (cpu_stddev is not None
                             and cpu_stddev < 5.0
                             and metrics.cpu_percent >= 60),
        "mem_critical":     metrics.memory_percent >= 95,
        "mem_high":         metrics.memory_percent >= 85,
        "net_external_high": metrics.external_packet_count >= 8,
        "mining_pool_ip":    mining_pool_hit,
        "outbound_spike":    outbound_spike,
        "dos_spike":         dos_spike_hit,
        "known_miner":       len(known_miners) > 0,
        "temp_exec":         len(temp_exec) > 0,
        "appdata_exec":      len(appdata_exec) > 0,
        "exec_path_suspicious": exec_path_suspicious,
        "unknown_process_active": unknown_process_active,
        "persistent_miner":  persistent_miner,
        "persistent_ext":    avg_ext_count >= 8,
        "ml_anomaly":        ml_weighted_score < -0.1,
        # 3단계 신규
        "net_out_sustained": net_out_sustained,
        "disk_write_net_out_sustained": disk_write_net_out_sustained,
        "new_remote_ip_burst": new_remote_ip_burst,
        "mining_process_or_pool": mining_process_or_pool,
        "spike_count_1m":    spike_count_1m,
        # #3 (Phase 2) ADDITIVE 신호 — legacy 점수 미반영, risk_vector 전용.
        "external_conn_suspicious_owner": external_conn_suspicious_owner,
        "single_core_full":  single_core_full,
        "process_recreation": process_recreation,  # #6 (Phase 2) ADDITIVE
    }

    # 수집 실패한 카테고리의 신호는 0/False 대신 명시적으로 drop (False 로 잠금).
    # 점수 산정 시 missing signal 을 "실제 0" 으로 오인하지 않도록 함.
    if network_missing_reason:
        for k in (
            "net_external_high", "mining_pool_ip", "outbound_spike", "dos_spike",
            "persistent_ext", "net_out_sustained",
            "disk_write_net_out_sustained", "new_remote_ip_burst",
            "spike_count_1m", "external_conn_suspicious_owner",
        ):
            if k in signals:
                signals[k] = False
    if process_missing_reason:
        for k in (
            "known_miner", "temp_exec", "appdata_exec", "exec_path_suspicious",
            "unknown_process_active", "persistent_miner", "mining_process_or_pool",
            "process_recreation",
        ):
            if k in signals:
                signals[k] = False

    return {
        "signals":            signals,
        "signals_missing":    signals_missing,
        "is_gaming":          is_gaming,
        "is_compiling":       is_compiling,
        "known_miners":       known_miners,
        "mining_pool_ip_str": mining_pool_ip_str,
        "avg_inbound":        avg_inbound,
        "dos_ratio":          dos_ratio,
        "ml_weighted_score":  ml_weighted_score,
        # derived features 노출 (indicator_calculator 에서 사용)
        "top_process_cpu_sum_normalized": top_cpu_norm,
        "external_connection_count_truncated": ext_truncated,
        "unique_remote_ip_count": unique_remote_ip_count,
        "duplicate_connection_count": duplicate_connection_count,
        "gpu_metrics_missing_reason": gpu_missing_reason,
        "gpu_partial_failure_reasons": gpu_partial_failure_reasons,
    }
