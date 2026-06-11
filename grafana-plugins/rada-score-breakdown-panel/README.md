# RADA Score Breakdown Panel

점수 구성 비중 — 카테고리별 가로 막대(%). **표시용**이며 최종 score를 만드는
경로가 아님(final = 9 레거시 카테고리 → 보정 → 이동평균). retrieval은 0 고정.

## 데이터 계약 (단일 행)
```sql
SELECT
  (scores->'score_breakdown'->>'resource')::float    AS resource,
  (scores->'score_breakdown'->>'network')::float     AS network,
  (scores->'score_breakdown'->>'process')::float     AS process,
  (scores->'score_breakdown'->>'episode')::float     AS episode,
  (scores->'score_breakdown'->>'correlation')::float AS correlation,
  (scores->'score_breakdown'->>'ml')::float          AS ml,
  (scores->>'final')::float                          AS final
FROM pc_monitor.anomaly_history
WHERE pc_id = '$pc_id'
ORDER BY detected_at DESC LIMIT 1;
```
Format as = Table. Demo mode 지원.

## 빌드
```bash
npm install && npm run build
```
