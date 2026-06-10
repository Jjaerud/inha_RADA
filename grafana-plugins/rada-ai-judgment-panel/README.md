# RADA AI Judgment Panel

PC 상세 대시보드의 **AI 판단 & 권고 + 신뢰도** 통합 카드. 4구역:

- **A 판단 본문** (다크 Claude) — 자연어 판단 + 근거 신호 칩(카테고리 색) + fast-path 근거
- **B 신뢰도** — signal_quality(FULL/PARTIAL/NONE) · explanation_confidence(LOW/MED/HIGH) 세그먼트
- **C 탈앵커링** — benign 신뢰도 + 반대 증거. *현재 mock이라 데이터 없으면 "실 AI 적용 시 표시" 플레이스홀더*
- **D 조치** — 권고 + "운영자 승인 필요 · AI 단독 실행 금지" + 운영자 조치 버튼

> 설계: [`docs/analysis/operator_feedback_loop_design.md`], 통합 패널 사양은 세션 기록 참조.

## 데이터 계약 (단일 행 쿼리)

대시보드 변수 `$pc_id`로 최신 1건을 가져온다. `anomaly_history` + `ai_judgment_history` 조인:

```sql
SELECT
  a.anomaly_type                                   AS verdict,
  a.severity                                       AS severity,
  (a.scores->>'final')::float                      AS score,
  a.scores->'risk_vector'->>'primary_type'         AS primary_type,
  a.scores->'evidence_meta'->>'fast_path_match'    AS fast_path,
  a.scores->'evidence_meta'->'active_signals'      AS active_signals,   -- json array (text)
  a.scores->'signal_quality'->>'overall'           AS signal_quality,
  a.scores->'signal_quality'->'sources'            AS sq_sources,        -- json object (text)
  a.scores->'explanation_confidence'->>'level'     AS explanation_confidence,
  a.scores->'explanation_confidence'->'reasons'    AS expl_reasons,      -- json array (text)
  j.is_mock                                        AS is_mock,
  j.details->>'reason'                             AS reason,
  j.details->>'action'                             AS action,
  j.details->>'benign_confidence'                  AS benign_confidence,        -- optional (현재 mock=없음)
  j.details->>'contradicting_mining_evidence'      AS contradicting_evidence,   -- optional
  to_char(a.detected_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS judged_at
FROM pc_monitor.anomaly_history a
LEFT JOIN pc_monitor.ai_judgment_history j ON j.anomaly_id = a.id
WHERE a.pc_id = '$pc_id'
ORDER BY a.detected_at DESC
LIMIT 1;
```

- **Format as = Table**, 패널 옵션의 `Field mapping` 기본값이 위 alias와 일치한다.
- JSON 컬럼(active_signals/expl_reasons/sq_sources)은 text로 와서 패널이 `JSON.parse` 한다.
- `benign_confidence`/`contradicting_evidence`는 현재 mock이라 비어 있음 → C구역이 자동으로 플레이스홀더 표시. 실 AI + 저장 추가(backlog) 후 채워진다.

## 빌드

```bash
cd grafana-plugins/rada-ai-judgment-panel
npm install
npm run build        # → dist/module.js + dist/plugin.json
```

## Grafana에 마운트 (docker-compose)

```yaml
grafana:
  volumes:
    - ./grafana-plugins/rada-ai-judgment-panel/dist:/var/lib/grafana/plugins/rada-ai-judgment-panel:ro
  environment:
    GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: >-
      ...,rada-ai-judgment-panel
```
재기동: `docker compose up -d grafana` (마운트라 빌드만 새로 하면 restart로 반영).

## Demo mode
데이터 연결 전 디자인 미리보기: 패널 옵션 `Demo > Demo mode` 켜기 (PC-07 채굴 확정 예시 렌더).
