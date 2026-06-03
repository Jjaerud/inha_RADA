# RADA 탐지 흐름, 최종 점수 체계, AI 안내 정보

작성일: 2026-06-02

## 1. 사용자에게 정보가 전달되는 전체 흐름

RADA는 5초 주기 Agent 메트릭을 Spring 서버가 수신하고, FastAPI ML 서버가 분석한
결과를 Spring이 저장한 뒤 Grafana/API로 사용자에게 보여준다.

```text
Agent
→ Spring Boot /api/metrics
→ metrics_history 즉시 저장
→ Spring이 ML 서버 /analyze 비동기 호출
→ ML 서버가 rule/ML/retrieval/category/AI 분석 수행
→ Spring AlertService가 저장 여부 판단
→ anomaly_history / ai_judgment_history 저장
→ Grafana Dashboard / REST API에서 사용자 확인
```

저장 정책:

```text
metrics_history
  모든 정상 수신 메트릭 저장

anomaly_history
  NORMAL 저장 안 함
  OBSERVE + LOW 저장 안 함
  SUSPICIOUS + MEDIUM 저장
  HIGH_RISK + HIGH 저장

ai_judgment_history
  anomaly_history가 저장되는 MEDIUM/HIGH 상황에서 AI 판단 결과 저장
```

즉 운영자가 Grafana나 API에서 보는 이상 이력은 모든 약신호가 아니라,
**SUSPICIOUS 이상 중심으로 압축된 이력**이다. LOW/OBSERVE는 ML 응답에는 존재할 수
있지만 운영 이력 테이블에는 저장하지 않는다.

## 2. ML 서버 내부 탐지 단계

ML 서버 `/analyze`는 한 번의 메트릭을 받으면 다음 순서로 처리한다.

```text
1. 현재 PC history에 snapshot 누적
2. IsolationForest/LOF ML ensemble 점수 계산
3. retrieval segment 생성 및 pgvector top-k 유사 사례 검색
4. rule 기반 signal 추출
5. signal을 category별 점수로 변환
6. 게임/컴파일 context multiplier 적용
7. 최근 5건 adjusted score 가중 평균으로 final score 산출
8. final score로 verdict 분류
9. promotion gating으로 단일 신호 승격 차단
10. category pattern gating으로 장기 지속 패턴 반영
11. network-only cap으로 네트워크 단독 오탐 완화
12. retrieval / signal quality / risk vector / explanation confidence 첨부
13. MEDIUM/HIGH이면 AI agent 호출
14. ML 응답 반환
```

## 3. `scores`, `score_breakdown`, `final` 비교

이름이 비슷해서 헷갈리기 쉬운 부분이다.

| 항목 | 정체 | 최종 점수인가? | 설명 |
|---|---|---:|---|
| `scores` | 전체 점수 묶음 | 아니오 | ML 서버가 반환하는 점수/근거 JSON 전체 |
| `scores.final` | 최종 점수 | 예 | 실제 verdict 판정에 쓰인 최종 점수 |
| `scores.score_breakdown` | 설명용 분해표 | 아니오 | 카테고리별 원인 해석용 점수표 |
| `scores.score_breakdown.final` | 최종 점수 복사본 | 예 | `scores.final`과 같은 값 |

예시:

```json
{
  "scores": {
    "final": 5.8,
    "gpu_mining": 0,
    "cpu_mining": 1,
    "process": 0,
    "ml": 3,
    "score_breakdown": {
      "resource": 1,
      "network": 2,
      "process": 0,
      "episode": 0,
      "correlation": 0,
      "ml": 3,
      "retrieval": 0,
      "context_discount": -1,
      "final": 5.8
    }
  }
}
```

핵심:

```text
scores.final == scores.score_breakdown.final
```

하지만:

```text
score_breakdown의 나머지 항목 단순 합 != 항상 final
```

`score_breakdown`은 실제 최종 산식을 그대로 펼친 것이 아니라, 운영자가 원인을
이해하기 쉽도록 재분류한 설명표다. Grafana 패널은 보통
`scores->'score_breakdown'->>'final'`을 우선 읽어 anomaly score로 표시한다.

## 4. 최종 점수 산식

실제 최종 점수는 다음 흐름으로 만들어진다.

```text
raw_score =
  gpu_mining
+ cpu_mining
+ stealth
+ exfil
+ process
+ dos
+ backdoor
+ mem
+ ml

context_multiplier =
  기본 1.0
  게임 실행 중이면 ×0.4
  컴파일 실행 중이면 ×0.5
  둘 다면 ×0.2

adjusted_score =
  process_score + (raw_score - process_score) × context_multiplier

final_score =
  최근 5개 adjusted_score의 가중 평균
```

최근 값일수록 가중치가 크다.

```text
5개 기준 가중치: 0.2, 0.4, 0.6, 0.8, 1.0
```

프로세스 점수는 게임/컴파일 배율에서 제외된다. 즉 채굴 프로세스처럼 명확한 증거는
게임 중이어도 약하게 만들지 않는다.

## 5. 최종 verdict 체계

점수 기반 1차 verdict:

| final score | verdict | severity | 저장/AI |
|---:|---|---|---|
| `< 5` | `NORMAL` | `NORMAL` | anomaly 저장 안 함, AI 호출 안 함 |
| `>= 5` | `OBSERVE` | `LOW` | anomaly 저장 안 함, AI 호출 안 함 |
| `>= 9` | `SUSPICIOUS` | `MEDIUM` | anomaly 저장, AI 호출 |
| `>= 14` | `HIGH_RISK` | `HIGH` | anomaly 저장, AI 호출 |

이후 promotion gating이 한 번 더 적용된다.

```text
SUSPICIOUS 유지 조건:
  active signal >= 3
  active category >= 2

HIGH_RISK 유지 조건:
  active signal >= 4
  active category >= 2
```

조건을 못 채우면 강등된다.

```text
HIGH_RISK → SUSPICIOUS 또는 OBSERVE
SUSPICIOUS → OBSERVE
```

단, 아래 fast-path는 게이트를 우회한다.

```text
known_miner
CONFIRMED_MINING alert
category_gating confirmed_sustained
```

## 6. 최종 점수에 사용되는 정보와 점수

### 6.1 GPU Mining

| 정보 | 조건 | 점수 |
|---|---|---:|
| `gpu_high` | GPU 사용률 70% 이상 | `+1` |
| `gpu_flat` | 12개 이상 history에서 GPU 표준편차 < 5, GPU 활성 | `+3` |
| `gpu_cpu_gap` | GPU 70% 이상, CPU 20% 미만 | `+3` |
| `net_external_high` | 외부 패킷 수 8 이상 | `+1` |
| `mining_pool_ip` | 채굴풀 IP prefix 매칭 | `+5` |
| `tensor_inactive AND vram_low` | GPU 활성인데 tensor inactive, VRAM ratio < 0.3 | `+3` |
| `is_gaming` | 게임 프로세스 감지 | `-5` |
| 조건 없음 | 위 조건 미발화 | `0` |

### 6.2 CPU Mining

| 정보 | 조건 | 점수 |
|---|---|---:|
| `cpu_high` | CPU 80% 이상 | `+1` |
| `cpu_flat` | 12개 이상 history에서 CPU 표준편차 < 5, CPU 60% 이상 | `+3` |
| `not gpu_high` | GPU high가 아님 | `+1` |
| `mining_pool_ip` | 채굴풀 IP prefix 매칭 | `+5` |
| `not gpu_active AND cpu_high AND cpu_flat` | GPU 비활성 + CPU 고부하 평탄 | `+2` |
| `is_compiling` | 컴파일/인코딩 프로세스 감지 | `-5` |
| `is_gaming` | 게임 프로세스 감지 | `-3` |
| 조건 없음 | 위 조건 미발화 | `0` |

### 6.3 Stealth

Stealth는 mismatch가 있어야 점수가 열린다. mismatch가 없으면 전체 `0`이다.

| 정보 | 조건 | 점수 |
|---|---|---:|
| `stealth_mismatch_power` | 평균 전력 80W 이상, 평균 GPU < 30% | `+5` |
| `stealth_mismatch_vram` | VRAM ratio > 0.7, GPU < 20% | `+5` |
| `vram_stable` | VRAM 표준편차 < 50, GPU 활성 | `+1` |
| `gpu_flat` | GPU 평탄 고부하 | `+1` |
| `power_stable` | 전력 표준편차 < 10, 평균 전력 60W 이상 | `+1` |
| `is_gaming` | 게임 프로세스 감지 | `-3` |
| `is_compiling` | 컴파일/인코딩 프로세스 감지 | `-2` |
| mismatch 없음 | stealth mismatch 미발화 | `0` |

### 6.4 Exfil

| 정보 | 조건 | 점수 |
|---|---|---:|
| `outbound_spike` | 평균 outbound 대비 5배 초과, 1MB 초과 | `+5` |
| `net_external_high` | 외부 패킷 수 8 이상 | `+1` |
| 조건 없음 | 위 조건 미발화 | `0` |

### 6.5 Process

| 정보 | 조건 | 점수 |
|---|---|---:|
| `known_miner` | 알려진 채굴 프로세스명 매칭 | `+10` |
| `persistent_miner` | history에서 채굴 프로세스 6회 이상 지속 | `+3` |
| `temp_exec` | temp 등 의심 경로 실행 | `+1` |
| 조건 없음 | 위 조건 미발화 | `0` |

`process >= 10`이면 `CONFIRMED_MINING` fast-path 성격을 가진다.

### 6.6 DoS

| 정보 | 조건 | 점수 |
|---|---|---:|
| `dos_spike` | 평균 대비 비율 + 절대값 floor + 연속 횟수 조건 만족 | `+5` |
| 조건 없음 | 미발화 | `0` |

현재 정책:

```text
min_inbound_mb_per_5s = 100.0
min_sustained_count = 3
```

즉 단순 다운로드 burst가 바로 DoS로 잡히지 않도록 강하게 제한한다.

### 6.7 Backdoor

| 정보 | 조건 | 점수 |
|---|---|---:|
| `backdoor` | 현재 비활성 | `0` |

현재 데이터만으로 정상 외부 통신과 backdoor를 구분하기 어렵기 때문에, backdoor 점수는
항상 `0`으로 고정되어 있다.

### 6.8 Memory

| 정보 | 조건 | 점수 |
|---|---|---:|
| `mem_critical` | 메모리 95% 이상 | `+1` |
| `mem_high AND not cpu_high` | 메모리 85% 이상, CPU 고부하 아님 | `+1` |
| 조건 없음 | 미발화 | `0` |

### 6.9 ML

| 정보 | 조건 | 점수 |
|---|---|---:|
| `ml_anomaly` | ML weighted score < -0.1 | `1~5` |
| `ml_score_cap` | ML 최대 기여 | `5` |
| rule/correlation 근거 없음 + ML cap 도달 | ML 점수에서 `-2` | 최소 `0` |
| 조건 없음 | ML anomaly 아님 | `0` |

계산:

```text
ml_contribution = min(5, max(1, int(abs(ml_weighted_score) * 5)))
```

### 6.10 Retrieval

| 정보 | 조건 | 점수 |
|---|---|---:|
| `retrieval_score` | 유사 과거 사례, novelty, peer mismatch 기반 원점수 | `-2~+5` |
| `retrieval_score_effective` | 현재 최종 점수 반영값 | `0` |
| `score_breakdown.retrieval` | 현재 표시값 | `0` |

pgvector retrieval은 현재 **최종 점수에 반영되지 않는다**. 유사 과거 사례 검색,
AI prompt, explanation confidence에만 사용된다.

### 6.11 Context

| 정보 | 조건 | 점수/효과 |
|---|---|---:|
| `is_gaming` | 게임 프로세스 감지 | non-process 점수 `×0.4` |
| `is_compiling` | 컴파일/인코딩 프로세스 감지 | non-process 점수 `×0.5` |
| 둘 다 | 게임 + 컴파일 | non-process 점수 `×0.2` |
| `startup` | context hint | `-1` 메타 |
| `security_scan` | context hint | `-2` 메타 |
| `maintenance_update` | context hint | `-2` 메타 |
| `lab_agent` | context hint | `-1` 메타 |
| `class_or_free` | 슬롯 존재, 다른 context 없음 | `-1` 메타 |
| 최대 감점 | context discount clamp | `-4` |
| 위험 신호 존재 | danger override | 감점 최대 `-1` |

주의: `context_discount`는 `score_breakdown`/감사용 메타에 남지만, 현재 실제
`adjusted_score`에는 직접 더하지 않는다. 실제 점수 감점은 게임/컴파일 multiplier가
담당한다.

## 7. 설명용 `score_breakdown` 항목 점수

`score_breakdown`은 운영자가 보기 쉬운 설명용 분해표다.

| 항목 | 의미 | 점수 출처 |
|---|---|---|
| `resource` | CPU/MEM/GPU 자원 이상 | cpu/mem/gpu/top process CPU normalized |
| `network` | 네트워크 이상 | sustained outbound, outbound spike, unique IP 등 |
| `process` | 프로세스 근거 | known miner, persistent miner, temp/appdata 실행 |
| `episode` | 이벤트성 이상 | DoS, persistent external |
| `correlation` | 조합 신호 | CPU+NET, disk+net, unknown process+net 등 |
| `ml` | ML 이상 점수 | IsolationForest/LOF 기반 |
| `retrieval` | 유사 과거 사례 점수 | 현재는 `0` |
| `context_discount` | 상황 감점 메타 | `-4~0`, 실제 final 직접 가산 아님 |
| `final` | 최종 점수 복사본 | `scores.final`과 동일 |

`score_breakdown`의 대표 점수:

```text
resource:
  cpu_high +1
  cpu_flat +1
  mem_high +1
  mem_critical +1
  gpu_high +1
  top_process_cpu_sum_normalized >= 0.85 +2
  top_process_cpu_sum_normalized >= 0.6 +1

network:
  spike_count_1m 단독 0
  spike_count_1m + companion >= 1 이면 +1
  net_out_sustained +2
  outbound_spike +2
  unique_remote_ip >= 12 +2
  unique_remote_ip >= 6 +1
  new_remote_ip_burst +1

process:
  known_miner +10
  persistent_miner +3
  temp_exec +1
  appdata_exec +1

episode:
  dos_spike +5
  persistent_ext +2

correlation:
  cpu_plus_net +2
  disk_write_net_out +5
  unknown_proc_net +5
  appdata_net +3
  mining_known +10
  mining_pool_only +8

ml:
  0~5

retrieval:
  현재 0
```

## 8. 사용자에게 표시되는 정보

Spring은 ML 응답에서 MEDIUM/HIGH만 저장한다.

`anomaly_history` 저장 내용:

```text
pc_id
detected_at
severity
anomaly_type = ML verdict
message
scores JSONB
alerts JSONB
```

`scores` JSONB 안에는 다음 감사 정보도 합쳐진다.

```text
retrieval_evidence
signals_missing
category_signals
evidence_meta
local_evidence
signal_quality
explanation_confidence
```

`ai_judgment_history` 저장 내용:

```text
pc_id
judged_at
anomaly_id
judgment
severity
reason
action
is_mock
model_name
details
```

사용자 화면에서는 보통 다음을 본다.

```text
PC 상태 색상
최근 anomaly score
severity
anomaly_type/verdict
alerts detail
AI reason/action
시계열 CPU/MEM/GPU
```

## 9. AI 호출 조건

AI agent는 `overall_severity`가 `MEDIUM` 또는 `HIGH`일 때만 호출한다.

```text
NORMAL: AI 호출 안 함
OBSERVE/LOW: AI 호출 안 함
SUSPICIOUS/MEDIUM: AI 호출
HIGH_RISK/HIGH: AI 호출
```

실제 Claude 호출이 꺼져 있거나 API 호출이 실패하면 MockAgent로 fallback한다.

```text
Claude 사용 가능: 실제 Claude 판단
Claude 비활성/실패: Mock 판단
```

## 10. AI가 받는 정보

Claude prompt에 들어가는 정보:

```text
PC ID
timestamp
timetable_slot
CPU %
memory %
GPU load %
VRAM MB
SM utilization
tensor_core_active
power_draw_w
external_packet_count
outbound_mb / inbound_mb per 5s
전체 PC 노후화 신호
유사 과거 사례 top-k
peer 비교
verdict
final score
gpu_mining / cpu_mining / stealth / exfil / process 점수
context_multiplier
게임/컴파일 여부
active signals
risk_vector
signal_quality
explanation_confidence
alerts
top_processes 상위 5개
external_connections 소유 프로세스 상위 5개
```

retrieval 정보는 다음 수준으로 전달된다.

```text
segment_id
distance
past verdict
past score
same_slot_peer_count
peer_mismatch
retrieval_score
```

현재는 과거 segment의 상세 score 이유까지는 prompt에 들어가지 않는다. 개선안은
`anomaly_history`에서 SUSPICIOUS/HIGH_RISK 과거 사례의 `score_breakdown`,
`alerts`, `message`를 조회해 prompt에만 붙이는 방식이다.

## 11. AI 예상 안내 멘트

AI는 tool schema에 맞춰 다음 구조를 반환한다.

```text
judgment: NORMAL | SUSPICIOUS | DANGEROUS
severity: LOW | MEDIUM | HIGH
reason: 1~2문장
action: 1문장
hw_degradation: NONE | SUSPECTED | CONFIRMED
```

예상 멘트 예시:

### SUSPICIOUS / MEDIUM

```text
reason:
의심 점수 10.2점입니다. 프로세스 점수와 네트워크 지속 신호가 함께 나타나
비인가 작업 가능성이 있습니다.

action:
실행 중인 프로세스와 외부 연결 소유 프로세스를 확인하세요.
```

### HIGH_RISK / HIGH

```text
reason:
위험 점수 15.4점입니다. 채굴 프로세스 또는 채굴 유사 자원 패턴이 확인되어
즉시 확인이 필요합니다.

action:
해당 프로세스를 중지하고 관리자 현장 점검을 진행하세요.
```

### 메모리 중심 의심

```text
reason:
메모리 96% 고점유가 지속되며 CPU 부하와 불균형합니다. 메모리 누수나 비인가
고부하 작업 가능성이 있습니다.

action:
메모리 점유 상위 프로세스를 확인하고 필요 시 재시작하세요.
```

### Retrieval 참고

```text
reason:
현재 패턴과 유사한 과거 사례가 SUSPICIOUS/HIGH_RISK로 확인되어 판단 신뢰도가
높습니다.

action:
유사 사례의 시간대와 현재 실행 프로세스를 함께 비교해 확인하세요.
```

## 12. 핵심 요약

```text
최종 점수:
  scores.final

Grafana 패널 점수:
  보통 scores.score_breakdown.final
  scores.final과 같은 최종 점수

score_breakdown:
  최종 점수 자체가 아니라 설명용 분해표

retrieval:
  현재 최종 점수에는 0점
  AI 설명과 유사 사례 근거로 사용

AI 호출:
  MEDIUM/HIGH에서만 호출

사용자 표시:
  anomaly_history + ai_judgment_history + Grafana 패널
```
