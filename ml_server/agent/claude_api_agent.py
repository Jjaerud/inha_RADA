"""Anthropic Claude API agent."""
from typing import Dict, Any
from ..model.requests import MetricsRequest


def build_prompt(metrics: MetricsRequest, pattern_result: dict,
                 global_hw: dict) -> str:
    alerts_text = "\n".join(
        [f"- [{a['severity']}] {a['type']}: {a['detail']}" for a in pattern_result["alerts"]]
    )
    procs_text = "\n".join(
        [f"- {p['name']} (CPU {p['cpu_percent']}%, MEM {p['memory_percent']}%, {p['path']})"
         for p in metrics.top_processes[:5]]
    )
    # #3 (PID 귀속): 외부 연결을 소유한 프로세스 경로. 저-CPU 라 top_processes 에
    # 안 잡혀도 백도어/채굴 소유 프로세스를 AI 가 직접 볼 수 있게 한다.
    conn_owner_text = ""
    conn_lines = []
    for c in (metrics.external_connections or [])[:5]:
        if not isinstance(c, dict):
            continue
        owner = c.get("proc_name") or "?"
        opath = c.get("proc_path") or ""
        conn_lines.append(f"- {c.get('ip','?')}:{c.get('port','?')} ← {owner} {opath}".rstrip())
    if conn_lines:
        conn_owner_text = "\n[외부 연결 소유 프로세스]\n" + "\n".join(conn_lines)
    gpu_text = ""
    if metrics.gpu:
        gpu_text = (f"GPU {metrics.gpu.load_percent}%, VRAM {metrics.gpu.memory_used_mb}MB, "
                    f"SM {metrics.gpu.sm_utilization}%, 텐서코어 {metrics.gpu.tensor_core_active}%, "
                    f"전력 {metrics.gpu.power_draw_w}W")

    global_hw_text = ""
    if global_hw.get("detected"):
        global_hw_text = f"\n[전체 PC 노후화 신호]\n{global_hw.get('detail','')}"

    retrieval_text = ""
    ev = pattern_result.get("retrieval_evidence")
    if isinstance(ev, dict) and ev.get("available"):
        top_k_lines = []
        for c in ev.get("top_k", [])[:3]:
            top_k_lines.append(
                f"- {c.get('segment_id')} dist={c.get('distance')} "
                f"verdict={c.get('verdict')} score={c.get('score')}"
            )
        topk_block = "\n".join(top_k_lines) if top_k_lines else "- 없음"
        retrieval_text = (
            f"\n[유사 과거 사례 top-k]\n{topk_block}\n"
            f"[Peer 비교] same_slot_peers={ev.get('same_slot_peer_count',0)} "
            f"peer_mismatch={ev.get('peer_mismatch',False)} "
            f"retrieval_score={ev.get('retrieval_score',0)}\n"
        )

    scores   = pattern_result.get("scores", {})
    verdict  = pattern_result.get("verdict", "NORMAL")
    signals  = pattern_result.get("signals", {})
    active_s = [k for k, v in signals.items() if v and k not in ("is_gaming","is_compiling")]

    # 해석 레이어 (additive — 점수 미반영, 판단 참고용)
    interp_text = ""
    rv = scores.get("risk_vector") if isinstance(scores, dict) else None
    if isinstance(rv, dict):
        interp_text += (
            f"\n[위험 벡터 해석] primary={rv.get('primary_type','NORMAL')} "
            f"(채굴:{rv.get('mining',0)} 오작동:{rv.get('malfunction',0)} "
            f"노후화:{rv.get('aging',0)} 보안위협:{rv.get('threat',0)} "
            f"네트워크남용:{rv.get('network_abuse',0)})"
        )
    sq = pattern_result.get("signal_quality")
    if isinstance(sq, dict) and sq.get("overall") and sq.get("overall") != "FULL":
        interp_text += (
            f"\n[신호 품질] overall={sq.get('overall')} "
            f"저하출처={sq.get('degraded_sources', [])} "
            f"(품질 저하 시 해당 신호의 0/False 는 '정상'이 아니라 '측정 불가'일 수 있음)"
        )
    ec = pattern_result.get("explanation_confidence")
    if isinstance(ec, dict) and ec.get("level"):
        interp_text += (
            f"\n[설명 신뢰도] level={ec.get('level')} score={ec.get('score',0)}/5 "
            f"근거={ec.get('reasons', [])}"
        )

    return f"""당신은 공용 PC 보안 및 유지보수 분석 전문가입니다.
아래 데이터를 분석해 이상 여부를 판단하고 report_judgment 도구로 보고하세요.

[현재 메트릭]
PC={metrics.pc_id}, 시각={metrics.timestamp}, 시간표={pattern_result['timetable_slot']}
CPU={metrics.cpu_percent}%, 메모리={metrics.memory_percent}%
{gpu_text}
외부연결={metrics.external_packet_count}건, Net ↑{metrics.outbound_mb}MB/5s ↓{metrics.inbound_mb}MB/5s
{global_hw_text}
{retrieval_text}
[규칙 기반 스코어링 결과]
verdict={verdict} (NORMAL|OBSERVE|SUSPICIOUS|HIGH_RISK), 최종점수={scores.get('final',0):.1f}
(GPU채굴:{scores.get('gpu_mining',0)} CPU채굴:{scores.get('cpu_mining',0)} 스텔스:{scores.get('stealth',0)} 유출:{scores.get('exfil',0)} 프로세스:{scores.get('process',0)})
컨텍스트배율={scores.get('context_multiplier',1.0)} (게임={signals.get('is_gaming',False)}, 컴파일={signals.get('is_compiling',False)})
활성신호={active_s}
{interp_text}
[탐지 알람]
{alerts_text if alerts_text else "- 이상 없음"}

[프로세스]
{procs_text}
{conn_owner_text}

판단 결과를 report_judgment 도구로 보고하세요.
(reason 은 1~2문장 간결히, action 은 1문장)""".strip()


def call_claude_api(prompt: str) -> dict:
    import requests as req, json
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
    "description": "공용 PC 이상 분석의 최종 판단을 보고한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "judgment": {"type": "string", "enum": ["NORMAL", "SUSPICIOUS", "DANGEROUS"],
                         "description": "종합 판정"},
            "severity": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH"],
                         "description": "심각도"},
            "reason": {"type": "string", "description": "판단 근거를 한국어 1~2문장으로 간결히(최대 120자)."},
            "action": {"type": "string", "description": "구체적 추천 조치를 한국어 1문장으로(최대 60자)."},
            "hw_degradation": {"type": "string", "enum": ["NONE", "SUSPECTED", "CONFIRMED"],
                               "description": "하드웨어 노후/오류 여부"},
        },
        "required": ["judgment", "severity", "reason", "action", "hw_degradation"],
    },
}


class ClaudeApiAgent:
    def judge(self, metrics: MetricsRequest, pattern_result: Dict[str, Any],
              global_hw: Dict[str, Any]) -> Dict[str, Any]:
        return call_claude_api(build_prompt(metrics, pattern_result, global_hw))
