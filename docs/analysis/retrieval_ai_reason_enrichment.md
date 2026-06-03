# Retrieval AI Reason Enrichment

작성일: 2026-06-02

## 1. 현재 구조 요약

현재 `RETRIEVAL_BACKEND=pgvector` 활성화 시 ML 서버는 PostgreSQL의
`pc_monitor.retrieval_segments`를 직접 사용한다. 이 테이블은 운영 원장이 아니라
ML 내부 검색 캐시로 취급한다.

흐름은 다음과 같다.

```text
현재 메트릭 window
→ segment 생성
→ 80차원 embedding 생성
→ pgvector top-k 유사 segment 검색
→ retrieval_evidence 생성
→ pattern_result / AI agent prompt에 첨부
→ 현재 segment를 retrieval_segments에 저장
```

`retrieval_segments`에 저장되는 주요 값:

```text
pc_id
slot
embedding
verdict
score
start_ts
end_ts
```

여기서 `embedding`은 사람이 읽는 설명이 아니라 유사도 검색용 좌표다. 따라서
embedding 숫자만 보고 "왜 이 score가 높았는지"를 알 수 없다.

## 2. 현재 Retrieval 점수 게이트

`retrieval_evidence`는 내부적으로 `retrieval_score`를 계산한다.

예상 가산/감산 구조:

```text
유사 NORMAL 다수              -2
유사 HIGH_RISK 존재           +3
유사 SUSPICIOUS 존재          +2
유사 과거 사례 없음 novelty    +1
동시간대 peer mismatch         +2
최종 cap                       -2 ~ +5
```

하지만 현재 verdict 최종 점수에는 반영하지 않는다.

```python
retrieval_score = 0
if isinstance(retrieval_evidence, dict):
    retrieval_evidence["retrieval_score_effective"] = 0
    retrieval_evidence["retrieval_score_gated"] = False
```

즉 `retrieval_score_gated` 값을 `True`로 바꾸는 것만으로는 점수 계산에 영향이 없다.
실제로 점수에 반영하려면 `adjusted_score += retrieval_score` 같은 계산 변경이
필요하다.

현재 정책은 다음과 같이 해석한다.

```text
retrieval_score 원점수: 감사/설명용
retrieval_score_effective: 0
final score 기여도: 0
```

이 게이트는 false positive 방지를 위한 안전장치다. 과거에는 유사 HIGH/SUSPICIOUS
사례나 peer mismatch가 약한 단일 신호와 합쳐져 SUSPICIOUS 이상으로 승격되는
위험이 있었다.

## 3. AI Agent가 받는 Retrieval 정보

실제 Claude agent가 호출되는 경우 `retrieval_evidence`는 prompt에 포함된다.

현재 prompt에 들어가는 retrieval 정보:

```text
유사 과거 segment id
distance
과거 verdict
과거 score
same_slot_peer_count
peer_mismatch
retrieval_score
```

예시:

```text
[유사 과거 사례 top-k]
- segment_id dist=0.012 verdict=SUSPICIOUS score=10
- segment_id dist=0.018 verdict=HIGH_RISK score=15

[Peer 비교]
same_slot_peers=8 peer_mismatch=True retrieval_score=5
```

단, MockAgent는 현재 retrieval 정보를 사용하지 않는다. MockAgent는 주로
`verdict`, `scores`, `signals`, `alerts`를 기반으로 reason을 만든다.

## 4. 현재 한계

AI agent는 "비슷한 과거 사례가 높은 점수였다"는 사실은 볼 수 있지만, 그 과거
사례의 점수가 왜 높았는지는 직접 알 수 없다.

현재 알 수 있는 것:

```text
과거 segment A는 SUSPICIOUS였다.
과거 score는 10이었다.
현재 segment와 distance가 0.012다.
```

현재 알 수 없는 것:

```text
그 score가 CPU 때문인지
GPU 채굴 패턴 때문인지
프로세스 때문인지
네트워크 때문인지
어떤 alert가 있었는지
AI 판단 사유가 무엇이었는지
```

그 이유는 `retrieval_segments`가 검색 캐시이고, 상세 판정 근거는
`anomaly_history.scores`, `anomaly_history.alerts`, `ai_judgment_history.reason`
쪽에 저장되기 때문이다.

## 5. 개선 추천안

권장 방향은 **스키마 변경 없이**, **최종 점수 게이트는 유지**하면서,
AI agent prompt에만 과거 고위험 사례의 이유를 enrichment하는 것이다.

핵심 원칙:

```text
DB 스키마 변경 없음
retrieval_segments에는 기존 필드만 저장
모든 segment에 reason 저장하지 않음
SUSPICIOUS/HIGH_RISK 과거 top-k에 대해서만 이유를 붙임
final score에는 retrieval을 계속 미반영
AI agent prompt 설명력만 개선
```

개선 흐름:

```text
1. pgvector로 현재 segment와 유사한 top-k 검색
2. top-k 중 verdict가 SUSPICIOUS/HIGH_RISK인 사례만 선별
3. 같은 pc_id와 가까운 시간대의 anomaly_history를 조회
4. scores.score_breakdown, alerts, message를 요약
5. Claude prompt의 유사 과거 사례 줄에 reason_summary를 추가
```

시간 매칭은 너무 엄격한 `BETWEEN start_ts AND end_ts`보다 느슨한 기준이 낫다.
`anomaly_history`는 Spring이 ML 응답을 받은 뒤 저장하므로, segment 시간 범위와
몇 초~몇 분 차이가 날 수 있다.

권장 매칭 조건:

```sql
a.pc_id = segment.pc_id
AND a.detected_at BETWEEN segment.end_ts - interval '2 minutes'
                      AND segment.end_ts + interval '2 minutes'
AND a.severity IN ('MEDIUM', 'HIGH')
```

또는:

```sql
a.anomaly_type IN ('SUSPICIOUS', 'HIGH_RISK')
```

실제 운영 DB에서는 `anomaly_type`/`severity` 값 분포를 먼저 확인한 뒤 조건을 확정한다.

## 6. Prompt 개선 예시

현재:

```text
- seg-123 dist=0.012 verdict=SUSPICIOUS score=10
```

개선 후:

```text
- seg-123 dist=0.012 verdict=SUSPICIOUS score=10
  reason: process=6, network=2, ml=2, final=10
  alerts: SUSPICIOUS_PROCESS, EXTERNAL_CONNECTION_SPIKE
```

이렇게 하면 AI agent는 "유사한 과거 사례가 있었다"를 넘어서, "그 과거 사례가 왜
위험했는지"까지 참고할 수 있다.

## 7. 왜 스키마 변경을 피하는가

`retrieval_segments`에 `score_breakdown`, `alerts`, `reason_summary` 컬럼을 추가하는
방법도 가능하지만 현재 단계에서는 추천하지 않는다.

이유:

```text
retrieval_segments는 ML 검색 캐시이며 운영 원장이 아니다.
모든 segment에 상세 이유를 저장하면 용량과 민감 정보 노출이 증가한다.
OBSERVE/NORMAL segment에는 상세 이유가 없거나 운영상 중요도가 낮다.
현재 요구는 AI 판단 시점의 설명력 보강이지 영구 감사 테이블 확장이 아니다.
```

따라서 상세 이유는 이미 존재하는 `anomaly_history`에서 필요할 때만 가져오는 편이
더 안전하다.

## 8. 주의사항

1. 현재 사건의 reason은 바로 붙이기 어렵다.

   현재 분석 결과는 ML 서버가 반환한 뒤 Spring이 `anomaly_history`에 저장한다.
   따라서 enrichment 대상은 "현재 사건"이 아니라 "이미 저장된 과거 사건"이다.
   이는 retrieval의 목적과도 맞다.

2. 과거 reason을 현재 reason으로 오인하면 안 된다.

   prompt에는 "유사 과거 사례의 이유"라고 명확히 표시해야 한다.
   AI agent가 이를 현재 사건의 직접 원인으로 단정하지 않도록 문구를 조정한다.

3. 점수 가산은 별도 실험 후 결정한다.

   retrieval을 final score에 반영하면 다음 승격이 가능하다.

   ```text
   4 + novelty 1 = OBSERVE
   7 + SUSPICIOUS 유사 2 = SUSPICIOUS
   11 + HIGH_RISK 유사 3 = HIGH_RISK
   ```

   특히 novelty 가산은 정상적인 새 작업도 이상으로 올릴 수 있어 조심해야 한다.

## 9. 결론

현재 pgvector는 verdict 점수 엔진이 아니라 유사 과거 사례 검색 및 설명 보조
장치로 쓰이고 있다. 이 방향은 false positive를 억제하는 데 안전하다.

다음 개선은 점수 게이트를 여는 것이 아니라, SUSPICIOUS/HIGH_RISK 유사 과거 사례에
대해서만 `anomaly_history`의 이유를 prompt에 붙이는 방식이 적절하다.

권장 결론:

```text
retrieval final score 반영: 보류
retrieval evidence prompt enrichment: 진행 추천
DB 스키마 변경: 불필요
대상: top-k 중 SUSPICIOUS/HIGH_RISK 과거 사례만
효과: AI agent 판단 근거 품질 향상, 판정 민감도 변화 없음
```
