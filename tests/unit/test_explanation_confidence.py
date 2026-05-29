"""explanation_confidence — 설명 신뢰도 결합 로직 검증 (additive)."""
from __future__ import annotations

from ml_server.scorer.explanation_confidence import compute_explanation_confidence


def _rv(**over):
    base = {
        "available": True,
        "similar_normal_count": 0, "similar_suspicious_count": 0,
        "similar_high_risk_count": 0, "novelty": False,
        "peer_mismatch": False, "same_slot_peer_count": 0,
    }
    base.update(over)
    return base


def _sq(overall="FULL"):
    return {"overall": overall}


def test_missing_quality_forces_low():
    c = compute_explanation_confidence(_rv(), _sq("MISSING"))
    assert c["level"] == "LOW"
    assert c["score"] == 0


def test_full_quality_with_corroboration_is_high():
    c = compute_explanation_confidence(
        _rv(similar_high_risk_count=2, same_slot_peer_count=4),
        _sq("FULL"),
    )
    assert c["level"] == "HIGH"
    assert c["score"] >= 4


def test_novelty_and_no_retrieval_lowers():
    no_retr = compute_explanation_confidence({"available": False}, _sq("FULL"))
    assert no_retr["level"] in ("MEDIUM", "LOW")
    assert no_retr["score"] <= 2


def test_partial_quality_penalized():
    full = compute_explanation_confidence(_rv(similar_normal_count=3), _sq("FULL"))
    partial = compute_explanation_confidence(_rv(similar_normal_count=3), _sq("PARTIAL"))
    assert partial["score"] < full["score"]


def test_none_inputs_are_conservative():
    c = compute_explanation_confidence(None, None)
    # retrieval 미가용 취급 → MEDIUM 또는 LOW, 절대 예외 아님
    assert c["level"] in ("MEDIUM", "LOW")
    assert "score" in c and "reasons" in c


def test_peer_mismatch_boosts():
    base = compute_explanation_confidence(_rv(), _sq("FULL"))
    with_mismatch = compute_explanation_confidence(_rv(peer_mismatch=True), _sq("FULL"))
    assert with_mismatch["score"] > base["score"]
