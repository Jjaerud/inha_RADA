"""설명 신뢰도 (ADDITIVE — verdict/final 에 영향 없음).

verdict 점수가 *얼마나 비정상인가* 라면, explanation_confidence 는
"우리가 이 판단을 *얼마나 자신있게 설명할 수 있는가*" 를 표현한다.
AI agent 가 근거를 제시할 때(또는 운영자가 alert 를 신뢰할 때) 함께 노출.

두 입력을 결합한다:
  1. signal_quality (#5)        — 입력 데이터 자체가 믿을 만한가
  2. retrieval_evidence (#8)    — 과거/peer 사례와 얼마나 정합적인가

등급:
    HIGH    데이터 정상 + 유사 사례가 판단을 뒷받침(또는 peer 정합)
    MEDIUM  데이터 정상이나 비교 근거 부족(novelty/cold corpus) 또는 부분 결손
    LOW     입력 데이터 결손(MISSING) — 판단 근거 자체가 빈약

순수 함수. retrieval/quality 가 없거나 형식이 달라도 보수적으로 MEDIUM 반환.
"""
from __future__ import annotations

from typing import Any, Dict


def compute_explanation_confidence(retrieval_evidence: Dict[str, Any] | None,
                                   signal_quality: Dict[str, Any] | None) -> Dict[str, Any]:
    rv = retrieval_evidence or {}
    sq = signal_quality or {}
    reasons = []

    quality = sq.get("overall", "FULL")

    # 1) 입력 데이터 품질이 바닥이면 설명 자체가 빈약 → LOW 고정
    if quality == "MISSING":
        return {
            "level": "LOW",
            "score": 0,
            "reasons": ["signal_quality=MISSING (입력 데이터 결손)"],
            "inputs": {"signal_quality": quality,
                       "retrieval_available": bool(rv.get("available"))},
        }

    # 2) 점수 누적 (0~5 스케일)
    score = 2  # 기본 MEDIUM 출발

    if quality == "PARTIAL":
        score -= 1
        reasons.append("signal_quality=PARTIAL")
    else:
        reasons.append("signal_quality=FULL")

    if rv.get("available"):
        # 유사 사례가 같은 방향(위험/정상)으로 모이면 근거 강화
        corroborating = (
            int(rv.get("similar_high_risk_count", 0))
            + int(rv.get("similar_suspicious_count", 0))
            + int(rv.get("similar_normal_count", 0))
        )
        if corroborating >= 2:
            score += 1
            reasons.append(f"retrieval 유사사례 {corroborating}건")
        if rv.get("peer_mismatch"):
            score += 1
            reasons.append("peer_mismatch (동시간대 동료 PC 대비 이상)")
        if rv.get("novelty"):
            score -= 1
            reasons.append("novelty (유사 과거사례 없음)")
        if int(rv.get("same_slot_peer_count", 0)) >= 3:
            score += 1
            reasons.append("동시간대 peer 비교 가능")
    else:
        score -= 1
        reasons.append("retrieval 미가용 (corpus cold / segment 부족)")

    score = max(0, min(5, score))
    level = "HIGH" if score >= 4 else "MEDIUM" if score >= 2 else "LOW"

    return {
        "level": level,
        "score": int(score),
        "reasons": reasons,
        "inputs": {"signal_quality": quality,
                   "retrieval_available": bool(rv.get("available"))},
    }


__all__ = ["compute_explanation_confidence"]
