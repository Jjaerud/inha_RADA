"""AI Agent 실행 — Claude 우선, 실패 시 Mock fallback."""
from .. import config
from ..model.requests import MetricsRequest
from ..silent_fail_counters import increment as _bump_silent_fail
from .claude_api_agent import call_claude_api, build_prompt
from .mock_agent import mock_agent_judgment

# 호환 alias — 기존 테스트가 monkeypatch.setattr(runner, "USE_REAL_CLAUDE", True)
# 형태로 분기를 강제하므로 모듈 변수로 노출. 실제 결정은 _should_use_claude().
USE_REAL_CLAUDE = False

# 런타임 토글 — 운영자가 비용 절감 등을 위해 실제 AI(Claude) 호출을 잠시
# 끌 수 있다. True 면 키가 있어도 mock 판정만 사용(LLM 호출 0). 컨테이너
# 재시작 시 기본(환경/키 따름)으로 복귀한다. POST /agent/enabled 로 제어.
_RUNTIME_AI_DISABLED = False


def set_ai_enabled(enabled: bool) -> None:
    global _RUNTIME_AI_DISABLED
    _RUNTIME_AI_DISABLED = not bool(enabled)


def is_ai_enabled() -> bool:
    return not _RUNTIME_AI_DISABLED


def _should_use_claude() -> bool:
    if _RUNTIME_AI_DISABLED:
        return False  # 런타임으로 꺼짐 → mock 강제(비용 0)
    if globals().get("USE_REAL_CLAUDE"):
        return True
    return config.use_real_claude()


def _normalize_hw_degradation(result: dict) -> None:
    """Claude/Mock 응답의 hw_degradation을 {NONE, SUSPECTED, CONFIRMED}로 정규화."""
    hw = result.get("hw_degradation")
    if isinstance(hw, bool):
        result["hw_degradation"] = "SUSPECTED" if hw else "NONE"
    elif hw not in ("NONE", "SUSPECTED", "CONFIRMED"):
        result["hw_degradation"] = "NONE"


def run_ai_agent(metrics: MetricsRequest, pattern_result: dict, global_hw: dict) -> dict:
    if _should_use_claude():
        try:
            result = call_claude_api(build_prompt(metrics, pattern_result, global_hw))
            result["is_mock"] = False
            _normalize_hw_degradation(result)
            return result
        except Exception as e:
            print(f"  [Claude API 호출 실패] {e} — Mock 판정으로 대체합니다.")
            # Claude 가 활성화된 상태에서 fallback 한 silent fail 만 카운트.
            # USE_REAL_CLAUDE=False (의도된 mock) 는 silent fail 이 아니므로 제외.
            _bump_silent_fail("claude_mock_count")
    result = mock_agent_judgment(metrics, pattern_result, global_hw)
    result["is_mock"] = True
    _normalize_hw_degradation(result)
    return result
