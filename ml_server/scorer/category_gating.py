"""카테고리 게이팅 로직.

명세: ``docs/cryptojacking_detection_patterns.md`` 6절 + 8.3 절 ``gating:``.

resource_abnormal / network_abnormal / system_abnormal 의 조합과
"동시 만족 연속 시간 (sustained_minutes)" 으로 verdict 결정.

verdict 4단계:
- HIGH_RISK   ("MINING_CONFIRMED_BY_BEHAVIOR")   : cats >= 3 AND sustained >= 180min
- SUSPICIOUS                                      : cats >= 2 AND sustained >= 30min
- OBSERVE                                          : cats >= 1 AND sustained >= 5min
- NORMAL                                           : otherwise
"""
from __future__ import annotations

import time as _time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .pattern_categories import CategoryResult


@dataclass
class GatingResult:
    verdict: str
    cats_count: int
    sustained_minutes: int
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "cats_count": int(self.cats_count),
            "sustained_minutes": int(self.sustained_minutes),
            "detail": dict(self.detail),
        }


def _read_gating_config(config: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """gating section 을 normalize. config 가 None 이면 기본값."""
    g = (config or {}).get("gating") or {}
    return {
        "mining_confirmed": dict((g.get("mining_confirmed") or {})),
        "suspicious":       dict((g.get("suspicious") or {})),
        "observe":          dict((g.get("observe") or {})),
    }


# FP-fix #5 (pilot 2026-05): sustained 누적 보정.
# - GAP_RESET_SEC: 직전 관측 이후 이 시간(초)을 초과하면 연속성 단절로 보고
#   누적 앵커를 리셋. sustained 는 wall-clock(now - since)이므로, PC 가
#   offline/재시작으로 보고를 멈춘 공백까지 "지속"으로 세던 버그를 막는다.
#   (정상 채굴은 5초 주기 연속 보고라 gap 없음 → 180분 게이팅 영향 없음.)
# - SUSTAINED_CAP_MIN: 정상 장기연결(연속 보고)이 며칠씩 누적(pilot 4949분)
#   되는 것을 막는 상한. 채굴 임계(180분)보다 충분히 커서 탐지엔 무영향.
_GAP_RESET_SEC = 120.0
_SUSTAINED_CAP_MIN = 720  # 12h


def update_sustained_state(state: Dict[str, Any], cats_count: int,
                           now: Optional[float] = None,
                           gap_reset_sec: float = _GAP_RESET_SEC,
                           cap_minutes: int = _SUSTAINED_CAP_MIN) -> int:
    """카테고리 상태 dict 를 갱신 후 ``sustained_minutes`` 반환.

    state 키: all_three_since / any_two_since / any_one_since / last_cats_count / last_ts.
    """
    if now is None:
        now = _time.time()

    # 연속성 단절 감지: 직전 관측(last_ts) 이후 gap_reset_sec 초과 → 앵커 리셋.
    # 관측되지 않은 공백을 sustained 로 세지 않는다.
    prev_ts = state.get("last_ts")
    if prev_ts is not None and (now - float(prev_ts)) > gap_reset_sec:
        state["all_three_since"] = None
        state["any_two_since"] = None
        state["any_one_since"] = None

    # cats_count 별 시작 시각 갱신:
    if cats_count >= 3:
        if not state.get("all_three_since"):
            state["all_three_since"] = now
        if not state.get("any_two_since"):
            state["any_two_since"] = now
        if not state.get("any_one_since"):
            state["any_one_since"] = now
    elif cats_count >= 2:
        state["all_three_since"] = None
        if not state.get("any_two_since"):
            state["any_two_since"] = now
        if not state.get("any_one_since"):
            state["any_one_since"] = now
    elif cats_count >= 1:
        state["all_three_since"] = None
        state["any_two_since"] = None
        if not state.get("any_one_since"):
            state["any_one_since"] = now
    else:
        state["all_three_since"] = None
        state["any_two_since"] = None
        state["any_one_since"] = None

    state["last_cats_count"] = int(cats_count)
    state["last_ts"] = float(now)

    # sustained_minutes 는 현재 cats_count 에 해당하는 가장 강한 윈도우 시작점 기반.
    # cap_minutes 상한 적용 (무한 누적 방지; 채굴 임계보다 큼).
    if cats_count >= 3 and state.get("all_three_since"):
        return min(int((now - state["all_three_since"]) / 60), cap_minutes)
    if cats_count >= 2 and state.get("any_two_since"):
        return min(int((now - state["any_two_since"]) / 60), cap_minutes)
    if cats_count >= 1 and state.get("any_one_since"):
        return min(int((now - state["any_one_since"]) / 60), cap_minutes)
    return 0


def evaluate(resource_cat: CategoryResult,
             network_cat: CategoryResult,
             system_cat: CategoryResult,
             state: Dict[str, Any],
             config: Optional[Dict[str, Any]] = None,
             now: Optional[float] = None) -> GatingResult:
    """3 카테고리 결과 + 상태 dict 로 verdict 결정."""
    cats_count = int(resource_cat.abnormal) + int(network_cat.abnormal) + int(system_cat.abnormal)
    sustained = update_sustained_state(state, cats_count, now=now)

    cfg = _read_gating_config(config or {})
    mc = cfg["mining_confirmed"]
    su = cfg["suspicious"]
    ob = cfg["observe"]
    mc_cats = int(mc.get("categories_required", 3))
    mc_min = int(mc.get("sustained_minutes", 180))
    su_cats = int(su.get("categories_required", 2))
    su_min = int(su.get("sustained_minutes", 30))
    ob_cats = int(ob.get("categories_required", 1))
    ob_min = int(ob.get("sustained_minutes", 5))

    verdict = "NORMAL"
    alert_type: Optional[str] = None
    if cats_count >= mc_cats and sustained >= mc_min:
        verdict = "HIGH_RISK"
        alert_type = "MINING_CONFIRMED_BY_BEHAVIOR"
    elif cats_count >= su_cats and sustained >= su_min:
        verdict = "SUSPICIOUS"
    elif cats_count >= ob_cats and sustained >= ob_min:
        verdict = "OBSERVE"

    detail = {
        "resource_abnormal": bool(resource_cat.abnormal),
        "network_abnormal":  bool(network_cat.abnormal),
        "system_abnormal":   bool(system_cat.abnormal),
        "triggered_patterns": (
            list(resource_cat.triggered_patterns)
            + list(network_cat.triggered_patterns)
            + list(system_cat.triggered_patterns)
        ),
    }
    if alert_type:
        detail["alert_type"] = alert_type

    return GatingResult(
        verdict=verdict,
        cats_count=cats_count,
        sustained_minutes=sustained,
        detail=detail,
    )


__all__ = ["GatingResult", "evaluate", "update_sustained_state"]
