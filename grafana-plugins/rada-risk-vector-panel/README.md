# RADA Risk Vector Panel

위험 유형 5축(채굴/망남용/위협/노후화/오작동) 가로 막대. 지배축은 레드 강조,
나머지는 중립 회색. **점수를 바꾸지 않는 부가 해석**(additive).

## 데이터 계약 (단일 행)
```sql
SELECT
  (scores->'risk_vector'->>'mining')::float        AS mining,
  (scores->'risk_vector'->>'network_abuse')::float AS network_abuse,
  (scores->'risk_vector'->>'threat')::float        AS threat,
  (scores->'risk_vector'->>'aging')::float         AS aging,
  (scores->'risk_vector'->>'malfunction')::float   AS malfunction,
  scores->'risk_vector'->>'primary_type'           AS primary_type
FROM pc_monitor.anomaly_history
WHERE pc_id = '$pc_id'
ORDER BY detected_at DESC LIMIT 1;
```
Format as = Table. Demo mode로 데이터 없이 미리보기 가능.

## 빌드
```bash
npm install && npm run build
```
