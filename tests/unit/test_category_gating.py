"""카테고리 게이팅 단위 테스트."""
from __future__ import annotations

from ml_server.scorer.pattern_categories import CategoryResult
from ml_server.scorer import category_gating


def _state():
    return {
        "all_three_since": None,
        "any_two_since": None,
        "any_one_since": None,
        "last_cats_count": 0,
        "last_ts": 0.0,
    }


CFG = {"gating": {
    "mining_confirmed": {"categories_required": 3, "sustained_minutes": 180},
    "suspicious":       {"categories_required": 2, "sustained_minutes": 30},
    "observe":          {"categories_required": 1, "sustained_minutes": 5},
}}


def _abn(triggered=("X",)):
    return CategoryResult(abnormal=True, triggered_patterns=list(triggered))


def _ok():
    return CategoryResult(abnormal=False, triggered_patterns=[])


def test_normal_when_no_categories_abnormal():
    s = _state()
    r = category_gating.evaluate(_ok(), _ok(), _ok(), s, CFG, now=1000.0)
    assert r.verdict == "NORMAL"
    assert r.cats_count == 0


def test_one_category_not_yet_sustained_is_normal():
    s = _state()
    # First call sets any_one_since = now, sustained=0 → no verdict yet (under 5min)
    r = category_gating.evaluate(_abn(), _ok(), _ok(), s, CFG, now=1000.0)
    assert r.verdict == "NORMAL"
    assert r.cats_count == 1


def _run(resource, network, system, s, minutes, step=60.0, start=1000.0):
    """sustained 시간을 작은 스텝(step<gap_reset)으로 연속 누적 시뮬레이션.

    실제 운영(5초 주기 연속 보고)을 모사 — 단일 큰 점프(예전 방식)는 #5
    gap-reset 에 의해 연속성 단절로 간주되므로 사용하지 않는다.
    """
    r = None
    t = start
    end = start + minutes * 60
    while t <= end + 1e-6:
        r = category_gating.evaluate(resource, network, system, s, CFG, now=t)
        t += step
    return r


def test_one_category_observe_after_5min():
    s = _state()
    r = _run(_abn(), _ok(), _ok(), s, minutes=6)
    assert r.verdict == "OBSERVE"


def test_two_categories_suspicious_after_30min():
    s = _state()
    r = _run(_abn(), _abn(), _ok(), s, minutes=31)
    assert r.verdict == "SUSPICIOUS"
    assert r.cats_count == 2


def test_three_categories_below_180min_is_suspicious():
    s = _state()
    r = _run(_abn(), _abn(), _abn(), s, minutes=60)
    # sustained = 60 < 180 → not HIGH_RISK; 60 >= 30 + cats>=2 → SUSPICIOUS
    assert r.verdict == "SUSPICIOUS"


def test_three_categories_above_180min_is_high_risk():
    s = _state()
    r = _run(_abn(), _abn(), _abn(), s, minutes=181)
    assert r.verdict == "HIGH_RISK"
    assert r.cats_count == 3
    assert r.detail.get("alert_type") == "MINING_CONFIRMED_BY_BEHAVIOR"


def test_sustained_resets_when_count_drops():
    s = _state()
    # 작은 스텝으로 cats3 누적 → cats1 로 drop → 다시 cats3.
    category_gating.evaluate(_abn(), _abn(), _abn(), s, CFG, now=1000.0)
    category_gating.evaluate(_abn(), _abn(), _abn(), s, CFG, now=1060.0)
    # Drop to 1 — should reset 2 and 3 since states (gap 60s < reset 임계).
    category_gating.evaluate(_abn(), _ok(), _ok(), s, CFG, now=1120.0)
    assert s["all_three_since"] is None
    assert s["any_two_since"] is None
    # Going back to 3 starts new "all_three_since"
    r = category_gating.evaluate(_abn(), _abn(), _abn(), s, CFG, now=1180.0)
    assert r.cats_count == 3
    assert s["all_three_since"] == 1180.0


# ── #5: gap-reset + cap ──────────────────────────────────────────────────
def test_gap_reset_breaks_sustained_continuity():
    """관측 공백(>gap_reset)이 있으면 sustained 누적이 끊긴다 (offline/재시작)."""
    s = _state()
    # cats2 를 35분 연속 누적 → SUSPICIOUS 직전/도달
    _run(_abn(), _abn(), _ok(), s, minutes=35)
    # 큰 공백(1시간) 후 재개 → 앵커 리셋 → 단일 호출 sustained 0 → NORMAL
    r = category_gating.evaluate(_abn(), _abn(), _ok(), s, CFG, now=1000.0 + 35 * 60 + 3600)
    assert r.sustained_minutes == 0
    assert r.verdict == "NORMAL"


def test_sustained_minutes_capped():
    """연속 보고로 누적이 cap(720)을 넘어도 sustained_minutes 는 720 으로 상한."""
    now = 1_000_000_000.0
    # any_one_since 가 1666분 전, 직전 관측은 30초 전(gap 없음) → 리셋 안 됨.
    s = {"all_three_since": None, "any_two_since": None,
         "any_one_since": now - 100000.0, "last_cats_count": 1, "last_ts": now - 30.0}
    sustained = category_gating.update_sustained_state(s, cats_count=1, now=now)
    assert sustained == 720  # min(1666, 720)


def test_detail_includes_triggered_patterns():
    s = _state()
    r = category_gating.evaluate(
        _abn(["R1"]), _abn(["N2"]), _abn(["S1"]), s, CFG, now=1000.0)
    assert "R1" in r.detail["triggered_patterns"]
    assert "N2" in r.detail["triggered_patterns"]
    assert "S1" in r.detail["triggered_patterns"]
    assert r.detail["resource_abnormal"] is True
    assert r.detail["network_abnormal"] is True
    assert r.detail["system_abnormal"] is True
