"""신호 품질 등급 (ADDITIVE — verdict/final 에 영향 없음).

signal_extractor 가 이미 수집 실패/품질 저하를 표시한다
(signals_missing, gpu_metrics_missing_reason, external_connection_count_truncated,
gpu_partial_failure_reasons, *_collection_missing_reason). 본 모듈은 이를
**데이터 출처별 품질 등급**으로 종합해 응답에 노출한다.

목적: "신호가 0/False" 인 것이 *진짜 정상* 인지 *측정 불가* 인지 구분.
verdict 점수는 이미 missing 카테고리를 False 로 잠그므로(보수적), 여기서는
그 사실을 운영자/AI agent 가 읽을 수 있는 신뢰도 등급으로 표현만 한다.

등급:
    FULL      해당 출처 데이터 정상 수집
    PARTIAL   일부 sub-field 결손 (예: GPU power 만 없음)
    MISSING   출처 전체 수집 실패 → 그 카테고리 신호는 신뢰 불가

overall = 출처 등급 중 최저 (MISSING < PARTIAL < FULL).
"""
from __future__ import annotations

from typing import Any, Dict, List

_GRADE_RANK = {"MISSING": 0, "PARTIAL": 1, "FULL": 2}
_SOURCES = ("network", "process", "gpu", "derived")


def compute_signal_quality(sig_pack: Dict[str, Any]) -> Dict[str, Any]:
    """sig_pack 의 품질 표시들을 출처별 등급으로 종합. 순수 함수."""
    sig_pack = sig_pack or {}
    missing = set(sig_pack.get("signals_missing") or [])

    sources: Dict[str, str] = {}
    reasons: Dict[str, Any] = {}

    # network — 전체 결손이면 MISSING. 부분 가시성 저하(truncated)면 PARTIAL.
    if "network" in missing:
        sources["network"] = "MISSING"
        reasons["network"] = "collection_failed"
    elif sig_pack.get("external_connection_count_truncated"):
        sources["network"] = "PARTIAL"
        reasons["network"] = "connection_list_truncated"
    else:
        sources["network"] = "FULL"

    # process
    if "process" in missing:
        sources["process"] = "MISSING"
        reasons["process"] = "collection_failed"
    else:
        sources["process"] = "FULL"

    # gpu — 전체 missing reason 이 있으면 MISSING, 일부 sub-field 실패면 PARTIAL.
    gpu_missing = sig_pack.get("gpu_metrics_missing_reason")
    gpu_partial = sig_pack.get("gpu_partial_failure_reasons") or []
    if gpu_missing:
        sources["gpu"] = "MISSING"
        reasons["gpu"] = str(gpu_missing)
    elif gpu_partial or ("gpu_partial" in missing):
        sources["gpu"] = "PARTIAL"
        reasons["gpu"] = list(gpu_partial)
    else:
        sources["gpu"] = "FULL"

    # derived_features
    if "derived_features" in missing:
        sources["derived"] = "MISSING"
        reasons["derived"] = "collection_failed"
    else:
        sources["derived"] = "FULL"

    # overall = 최저 등급
    overall = min(sources.values(), key=lambda g: _GRADE_RANK[g])
    degraded: List[str] = [s for s, g in sources.items() if g != "FULL"]

    return {
        "overall": overall,
        "sources": sources,
        "degraded_sources": degraded,
        "reasons": reasons,
    }


__all__ = ["compute_signal_quality"]
