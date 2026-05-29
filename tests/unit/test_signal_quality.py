"""signal_quality 등급 — additive 신호 품질 종합 검증."""
from __future__ import annotations

from ml_server.scorer.signal_quality import compute_signal_quality


def test_all_full_when_nothing_missing():
    q = compute_signal_quality({})
    assert q["overall"] == "FULL"
    assert q["degraded_sources"] == []
    assert all(g == "FULL" for g in q["sources"].values())


def test_network_collection_failed_is_missing():
    q = compute_signal_quality({"signals_missing": ["network"]})
    assert q["sources"]["network"] == "MISSING"
    assert q["overall"] == "MISSING"
    assert "network" in q["degraded_sources"]


def test_truncated_connections_is_partial_not_missing():
    q = compute_signal_quality({"external_connection_count_truncated": True})
    assert q["sources"]["network"] == "PARTIAL"
    assert q["overall"] == "PARTIAL"


def test_gpu_full_missing_vs_partial():
    full_missing = compute_signal_quality({"gpu_metrics_missing_reason": "no_nvml"})
    assert full_missing["sources"]["gpu"] == "MISSING"

    partial = compute_signal_quality({"gpu_partial_failure_reasons": ["power_unavailable"]})
    assert partial["sources"]["gpu"] == "PARTIAL"
    assert partial["reasons"]["gpu"] == ["power_unavailable"]


def test_overall_is_lowest_grade():
    # process MISSING + gpu PARTIAL → overall MISSING
    q = compute_signal_quality({
        "signals_missing": ["process"],
        "gpu_partial_failure_reasons": ["sm_unavailable"],
    })
    assert q["sources"]["process"] == "MISSING"
    assert q["sources"]["gpu"] == "PARTIAL"
    assert q["overall"] == "MISSING"


def test_partial_overall_when_only_partial():
    q = compute_signal_quality({
        "external_connection_count_truncated": True,
        "gpu_partial_failure_reasons": ["power_unavailable"],
    })
    assert q["overall"] == "PARTIAL"
    assert set(q["degraded_sources"]) == {"network", "gpu"}
