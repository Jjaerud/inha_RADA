"""Anthropic Claude API agent."""
from typing import Dict, Any
from ..model.requests import MetricsRequest


_PROFILE_DESC = {
    "general": "고부하 연산이 통상적이지 않은 환경(공용/강의장/도서관 등). 보수적으로 판단.",
    "lab_compute_allowed": ("과학연산/렌더링 등 고부하가 업무상 그럴듯한 환경(연구실). "
                            "단 이것이 채굴 면죄부는 아니며, 반드시 반증을 따질 것."),
}


def build_prompt(metrics: MetricsRequest, pattern_result: dict,
                 global_hw: dict) -> str:
    """탈앵커링 프롬프트(ai_judgment_disambiguation_design §4-4).

    룰 결론/점수/유사사례를 단정적으로 주입하지 않는다(앵커링 제거). 대신 중립
    관측 사실 + 환경 프로파일을 주고, 채굴 vs 정상 워크로드 양가설을 비교하게 한다.
    하드 신호(known_miner/mining_pool)는 환경 무관 위험으로 명시.
    """
    signals = pattern_result.get("signals", {}) or {}
    g = metrics.gpu
    if g:
        vram_t = (g.memory_total_mb or 1) or 1
        gpu_line = (f"load {g.load_percent}%, 텐서코어 {g.tensor_core_active}(0=미사용), "
                    f"VRAM {g.memory_used_mb}/{vram_t}MB(={(g.memory_used_mb or 0)/vram_t*100:.0f}%), "
                    f"전력 {g.power_draw_w}W")
    else:
        gpu_line = "(GPU 메트릭 없음/수집 실패)"
    procs = "\n".join(
        f"  - {p.get('name')} (CPU {p.get('cpu_percent')}%, 경로: {p.get('path','')})"
        for p in metrics.top_processes[:5]) or "  - (없음)"
    conn_lines = []
    for c in (metrics.external_connections or [])[:5]:
        if isinstance(c, dict):
            conn_lines.append(
                f"  - {c.get('ip','?')}:{c.get('port','?')} ← "
                f"{c.get('proc_name','?')} {c.get('proc_path','')}".rstrip())
    conns = "\n".join(conn_lines) or "  - (없음/일반)"
    profile = getattr(metrics, "workload_context", "general") or "general"
    profile_desc = _PROFILE_DESC.get(profile, _PROFILE_DESC["general"])
    global_hw_text = (f"\n- 전체 PC 노후화 신호: {global_hw.get('detail','')}"
                      if global_hw.get("detected") else "")

    return f"""당신은 공유 PC 보안·유지보수 분석가입니다. 규칙엔진이 자원 사용이 높아 이 PC를
'검토 대상'으로 표시했습니다. 그러나 높은 자원 사용 자체는 채굴과 정상 고부하 작업
(과학연산/렌더링/인코딩/빌드) 양쪽에서 동일하게 나타납니다. 당신의 임무는 점수를
재확인하는 게 아니라 이 둘을 구별하는 것입니다.

[배포 환경 프로파일]
workload_context = {profile}
  → {profile_desc}

[관측 사실]  (판정이 아니라 측정값)
PC={metrics.pc_id}, 시간표={pattern_result.get('timetable_slot','?')}
- CPU 사용률: {metrics.cpu_percent}%, 메모리: {metrics.memory_percent}%
- GPU: {gpu_line}
- Net ↑{metrics.outbound_mb}MB/5s ↓{metrics.inbound_mb}MB/5s, 외부패킷 {metrics.external_packet_count}건
- 상위 프로세스:
{procs}
- 외부 연결(소유 프로세스):
{conns}
- 알려진 채굴 프로세스명 일치: {'예' if signals.get('known_miner') else '아니오'}
- 알려진 채굴풀 IP 일치: {'예' if signals.get('mining_pool_ip') else '아니오'}{global_hw_text}

[판단 절차 — 반드시 이 순서로]
1. 악의적 채굴 가설: 지지 증거는?
2. 정상 워크로드 가설: 지지 증거는?(프로세스 정체성/설치 경로/텐서·VRAM 사용양상/환경)
3. 채굴 반증·누락 증거: 채굴풀 연결 없음 / 알려진 채굴 아님 / 텐서코어 활성(=ML학습) /
   VRAM 높음(=일반 GPU작업) / Program Files 정식 설치 등
4. 종합 판단

[중요 규칙]
- '알려진 채굴 프로세스명 일치=예' 또는 '채굴풀 IP 일치=예' 이면 환경 프로파일과
  무관하게 정상으로 판단하지 말 것.
- 그 외 자원-시그니처만 있으면, 위 반증과 프로파일을 종합해 benign_workload_likely 판단.

report_judgment 도구로 보고하세요(benign_workload_likely / benign_confidence /
contradicting_mining_evidence 포함). reason 1~2문장(≤140자), action 1문장(≤70자).""".strip()


def call_claude_api(prompt: str) -> dict:
    import requests as req
    from ..config import (
        get_anthropic_api_key,
        get_claude_model,
        get_claude_timeout_sec,
        get_claude_max_tokens,
    )

    api_key = get_anthropic_api_key()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    # Tool use(structured output): JSON 스키마를 도구로 강제해 Claude 가 항상
    # 유효한 구조화 출력을 반환하게 한다. 텍스트 파싱 시 ```json 코드펜스나
    # escape 누락으로 깨져 mock 으로 fallback 되던 문제를 근본 제거.
    response = req.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key,
                 "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": get_claude_model(),
              "max_tokens": get_claude_max_tokens(),
              "tools": [_JUDGMENT_TOOL],
              "tool_choice": {"type": "tool", "name": "report_judgment"},
              "messages": [{"role": "user", "content": prompt}]},
        timeout=get_claude_timeout_sec(),
    )
    data = response.json()
    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "report_judgment":
            return dict(block.get("input") or {})
    # tool_use 가 없으면(이례적) 명시적 에러 — runner 가 mock 으로 fallback.
    raise ValueError(f"no tool_use in Claude response: {str(data)[:200]}")


# Structured-output 스키마. messages API 의 tools 파라미터로 전달.
_JUDGMENT_TOOL = {
    "name": "report_judgment",
    "description": "공유 PC 자원 이상의 최종 판단을 보고한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "judgment": {"type": "string", "enum": ["NORMAL", "SUSPICIOUS", "DANGEROUS"],
                         "description": "종합 판정"},
            "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"],
                         "description": "심각도"},
            "benign_workload_likely": {"type": "boolean",
                "description": "정상 고부하 워크로드(과학연산/렌더/인코딩/빌드 등)일 가능성이 높은가. "
                               "축 A(악성 여부)만 판단 — 인가 여부(축 B)는 운영자 정책이 별도로 본다."},
            "benign_confidence": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"],
                                  "description": "benign_workload_likely 의 확신도"},
            "contradicting_mining_evidence": {"type": "array", "items": {"type": "string"},
                "description": "채굴 가설을 반증하는 관측들(예: no_mining_pool, not_known_miner, "
                               "tensor_active, vram_high, progfiles_signed_path)"},
            "reason": {"type": "string", "description": "판단 근거를 한국어 1~2문장으로 간결히(최대 140자)."},
            "action": {"type": "string", "description": "구체적 추천 조치를 한국어 1문장으로(최대 70자)."},
            "hw_degradation": {"type": "string", "enum": ["NONE", "SUSPECTED", "CONFIRMED"],
                               "description": "하드웨어 노후/오류 여부"},
        },
        "required": ["judgment", "severity", "benign_workload_likely", "benign_confidence",
                     "contradicting_mining_evidence", "reason", "action", "hw_degradation"],
    },
}


class ClaudeApiAgent:
    def judge(self, metrics: MetricsRequest, pattern_result: Dict[str, Any],
              global_hw: Dict[str, Any]) -> Dict[str, Any]:
        return call_claude_api(build_prompt(metrics, pattern_result, global_hw))
