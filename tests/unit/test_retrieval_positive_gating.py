"""Retrieval 은 final score 에 기여하지 않는다 (FP-fix #4, pilot 2026-05).

과거 P1-4 는 positive retrieval 을 "2개 이상 다른 카테고리"가 있을 때만
가산하는 gating 이었으나, pilot 에서 약한 네트워크 신호 + retrieval 조합이
여전히 SUSPICIOUS 로 승격하는 FP 가 관찰됨. 이제 retrieval 은 verdict 점수에서
완전히 분리하고, 유사도 근거는 explanation_confidence(설명 신뢰도)로만 노출한다.

본 테스트는 "retrieval_score 가 무엇이든 final/breakdown 에 0 으로만 반영된다"는
새 계약을 고정한다. retrieval_evidence 본문(top_k 등)은 그대로 보존돼야 한다.
"""
from __future__ import annotations

from collections import deque

import pytest

from ml_server.model.requests import MetricsRequest
from ml_server.policy import reload_policies
from ml_server.scorer.verdict_classifier import analyze_pattern
from ml_server.storage import pc_history_store
from ml_server.storage.score_history_store import reset_rule_score_history


@pytest.fixture(autouse=True)
def _reset():
    reload_policies()
    pc_history_store.reset_all_state()
    reset_rule_score_history()
    yield
    pc_history_store.reset_all_state()
    reset_rule_score_history()


def _make_metrics(cpu_pct: float = 5.0, mem_pct: float = 30.0,
                  gpu_pct: float = 0.0) -> MetricsRequest:
    return MetricsRequest(
        pc_id="pc-retr",
        timestamp="2026-05-23T10:00:00+09:00",
        cpu_percent=cpu_pct,
        memory_percent=mem_pct,
        disk_read_mb=0.1, disk_write_mb=0.1,
        inbound_mb=0.1, outbound_mb=0.1,
        external_packet_count=0,
        gpu={"name": "x", "load_percent": gpu_pct, "memory_used_mb": 0,
             "memory_total_mb": 1, "memory_percent": 0},
        local_alerts=[],
    )


@pytest.mark.parametrize("rscore", [5, 3, 2, -2])
def test_retrieval_never_contributes_to_final(rscore):
    """positive/negative 무관하게 retrieval 은 breakdown·effective 에서 0."""
    m = _make_metrics()
    ev = {"available": True, "retrieval_score": rscore}
    result = analyze_pattern(m, deque(), slot="free", retrieval_evidence=ev)
    breakdown = result["scores"]["score_breakdown"]
    assert breakdown["retrieval"] == 0
    assert ev["retrieval_score_effective"] == 0
    assert ev["retrieval_score_gated"] is False


def test_retrieval_evidence_body_preserved():
    """top_k 등 evidence 본문은 보존(검색/감사 + explanation_confidence 용)."""
    m = _make_metrics()
    ev = {"available": True, "retrieval_score": 5,
          "top_k": [{"pc_id": "pc-x", "verdict": "HIGH_RISK", "distance": 0.01}]}
    analyze_pattern(m, deque(), slot="free", retrieval_evidence=ev)
    assert ev["available"] is True
    assert ev["top_k"] and ev["top_k"][0]["verdict"] == "HIGH_RISK"
    # 원본 retrieval_score 는 보존(explanation_confidence 가 참조)
    assert ev["retrieval_score"] == 5


def test_retrieval_unavailable_yields_zero():
    m = _make_metrics()
    result = analyze_pattern(m, deque(), slot="free", retrieval_evidence=None)
    assert result["scores"]["score_breakdown"]["retrieval"] == 0
