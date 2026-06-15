# RADA 발표 대비 명세 (시스템·핵심코드·검증·Q&A)

> 발표/심사 대비용. 시스템 설명 → 아키텍처 → 탐지 파이프라인 → 핵심 코드 →
> **탐지 상황별 검증 결과** → 예상 질문·답변 → 기대효과. (수치는 방어 가능한 것만)

---

## 1. 한 줄 정의
**RADA** = 대학 실습실·공유 PC의 **무단 채굴(크립토재킹)·자원 도용을 탐지·관리**하는 시스템.
핵심 차별점: **자원 사용 패턴이 동일한 정상 고부하(렌더링·AI학습·컴파일)와 채굴을 구분**.

## 2. 아키텍처
```
[각 PC]                     [NCP 서버 — Docker]
rada_client(Python)  ──→  Spring Boot(:8080)  ──→  FastAPI ML(:8000)  ──→  PostgreSQL
 자원 수집·전송            API·저장·알림            탐지·점수·AI 판단        (+pgvector)
                                                          │
                              Grafana(:3000) ◀───────────┘  대시보드(허니컴·PC상세)
```
- 클라이언트: 경량 에이전트(단독 exe), 작업 스케줄러 자동 실행
- 서버: `docker compose up` 한 번에 4개 컴포넌트 기동 (별도 설치 X)

## 3. 탐지 파이프라인 (룰 엔진)
```
원자 신호 추출 → 카테고리 점수화(9종) → 컨텍스트 보정 → 누적 이동평균(5건) → verdict
                                                              ↓
              [게이팅] 승격 게이팅(신호·카테고리 수) + 지속 게이팅(30분~3h)
              [fast-path] 알려진 채굴 프로세스 → 즉시 확정
              [risk vector] 5축 유형 분리(부가 해석, 점수 불변)
              [AI] 의심(MEDIUM)↑ 에서만 호출 → 정상 고부하 vs 채굴 재판정(쿨다운 30분)
```
- verdict 임계: **NORMAL <5 / OBSERVE ≥5 / SUSPICIOUS ≥9 / HIGH_RISK ≥14** (0~20 스케일)
- 컨텍스트 감점: 게임/렌더(×0.4), 컴파일(×0.5) — 단 명확한 위험신호 동반 시 감점 제한
- AI는 **non-destructive**(엔진 verdict 불변, 설명·근거 보조)

## 4. 핵심 코드 명세 (우리 창작 영역)

| 파일 | 역할 |
|---|---|
| `ml_server/scorer/signal_extractor.py` | 원자 신호 추출 + **인프라/에이전트 allowlist**(자기참조 FP 차단) |
| `ml_server/scorer/indicator_calculator.py` | 9개 카테고리 점수 + score_breakdown |
| `ml_server/scorer/context_multiplier.py` | 게임/컴파일 컨텍스트 감점 + danger override |
| `ml_server/scorer/verdict_classifier.py` | verdict 분류 + **promotion gating**(단일신호 차단) |
| `ml_server/scorer/risk_vector.py` | 위험 유형 5축(채굴/오작동/노후화/위협/망남용) |
| `ml_server/agent/claude_api_agent.py` | **탈앵커링 AI 프롬프트**(정상↔채굴 구분, benign 스키마) |
| `ml_server/agent/runner.py` | 실 Claude vs mock 분기 |
| `ml_server/api/analyze_router.py` | 파이프라인 통합 + 카테고리 게이팅 + **AI 호출 쿨다운** |
| `client_core/` | 수집(collector)·로컬탐지(detector)·전송(sender) |
| `grafana-plugins/rada-pc-detail-panel/` | PC 상세 대시보드(상태블롭·니들게이지·레이더·AI 4존) |

**대표 로직 스니펫 포인트**
- 인프라 allowlist: `_all_external_to_infra()` — 외부 연결이 전부 known-good IP면 EXFIL 신호 억제
- 승격 게이팅: `apply_promotion_gating()` — `신호≥3 AND 카테고리≥2`(MEDIUM) 미달 시 강등, fast-path 우회
- AI 쿨다운: `analyze_router` — `ai_call_cooldown_seconds`(1800s), severity 상승 시 즉시 재호출

## 5. 탐지 상황별 검증 (analyze_pattern 직접 실행)

| # | 시나리오 | 결과 verdict (final) | 판정 근거 |
|---|---|---|---|
| 1 | 정상 유휴 | **NORMAL** (1.0) | 신호 없음 |
| 2 | 채굴 — 알려진(xmrig) | **HIGH_RISK** (22.0) | **fast-path** known_miner 즉시 확정 |
| 3 | 채굴 — 스텔스(이름 위장) | **SUSPICIOUS** (11.0) | 이름 위장해도 **cpu_flat·gpu_flat 자원패턴**으로 포착 |
| 4 | 정상 렌더링(blender 고부하) | **NORMAL** (0.0) | **컨텍스트 감점** — 엔진이 정상 고부하 구제 |
| 5 | 정상 컴파일(gcc 고CPU) | **NORMAL** (2.5) | 컴파일 컨텍스트 감점 |
| 6 | 단일 약신호(CPU만) | **OBSERVE** (9.0 → 강등) | **승격 게이팅**: 카테고리 1개 → 의심 안 띄움 |
| 7 | 자기참조 송신(전부 인프라IP) | **OBSERVE** | **allowlist**가 EXFIL 신호 억제 → 의심 아님 |
| 8 | 실제 외부유출(외부IP 포함) | **HIGH_RISK** (14.0) | allowlist 무관, 실 유출은 그대로 탐지(마스킹 X) |

**별도 단위 검증**
- 인프라 allowlist: 동일 입력에서 전부 인프라 → final **9.0→3.0(NORMAL)**, 외부IP 섞임 → **10.0(SUSPICIOUS)**
- AI 쿨다운: MEDIUM+ **15회 연속 → AI 1회 호출**, HIGH 상승 → 즉시 재호출
- 실제 채굴기(xmrig --bench) 격리 테스트 → **CONFIRMED_MINING** 즉시 발화
- 정상 고부하 레드팀 FP **8/8 AI 구제**(탈앵커링)
- 단위 테스트 **23개 통과** (회귀 없음)

## 6. 예상 질문 & 답변

**Q1. 정상 고부하와 채굴, 어떻게 구분하나요?**
A. 3중 방어. ① 컨텍스트 감점(렌더링·컴파일 프로세스면 점수↓ — 검증#4 NORMAL), ② 프로세스/시그니처(known_miner 유무), ③ AI가 의심 단계에서 프로세스·작업 패턴으로 재판정(렌더링 vs 채굴). 발표 데모 PC-17이 정확히 이 케이스(엔진 의심→AI 정상).

**Q2. 오탐률은요?**
A. 단계적 개선으로 정상 사용 구간 anomaly 비율을 **65.9% → 사실상 0%**까지 낮춤(P0/P1/P2). 단 "0%"는 특정 측정 구간 값이라 단정하지 않고, 게이팅·allowlist로 **구조적으로** 줄였다고 말합니다.

**Q3. AI 비용이 많이 들지 않나요?**
A. ① 의심(MEDIUM) 이상에서만 호출, ② **30분 쿨다운**(지속돼도 30분당 1회), ③ severity 상승 시만 즉시 재호출. 검증: 15회 연속 의심 → AI 1회. mock 모드로 비용 0 운영도 가능.

**Q4. 채굴이 프로세스 이름을 숨기면요?**
A. known_miner 시그니처가 없어도 **자원 패턴(CPU/GPU flat 고점유)** 으로 포착(검증#3 SUSPICIOUS). 이름에 의존하지 않습니다.

**Q5. 단일 신호로 과민하게 잡지 않나요?**
A. 승격 게이팅으로 **신호·카테고리 수가 함께 충족돼야** 의심으로 올라갑니다(검증#6: CPU 단독은 OBSERVE). 단일 약신호가 과거 오탐의 74%였던 문제를 차단.

**Q6. AI가 틀리면요?**
A. AI는 엔진 verdict를 **바꾸지 않는 보조 레이어**(non-destructive). 위험 조치는 **운영자 승인 후**, 하드신호(known_miner)는 AI가 못 건드림. AI가 네트워크 도메인에 약하다는 한계도 파악해 **인프라 allowlist를 AI보다 앞단**에 둠.

**Q7. 운영자/에이전트 자기 트래픽이 유출로 잡히지 않나요?**
A. 그 자기참조 오탐을 인프라 allowlist로 차단(검증#7). 외부 연결이 전부 서버 자신이면 EXFIL 신호를 억제하되, 외부 IP가 하나라도 섞이면 그대로 탐지(검증#8).

**Q8. 프라이버시는요?**
A. 자원 메트릭·프로세스명·연결 정보만 수집하며 **화면/파일 내용은 보지 않습니다.** API 키는 해시 저장, 비밀값은 코드에 미포함.

**Q9. 확장성은요?**
A. 서버는 Docker 컨테이너, 클라이언트는 경량 단독 exe. 실습실 40대를 넘어 기숙사·사내 PC·클라우드 VM으로 확장 가능. 표준(NIST CSF 2.0) 기반.

**Q10. 클라이언트를 끄거나 무력화하면?**
A. 현재는 마지막 보고 시각으로 오프라인을 표시. 향후 **보고 갭(직전 부하 후 침묵)을 의심 신호로** 보는 워치독을 backlog에 둠.

## 7. 기대효과 (3방향)
- **운영(관리자 한눈에)**: 40대 현황을 허니컴 한 화면 + 의심 PC 클릭 드릴다운. 누적 이력이 **실습실 이용 규칙·정책 수립 근거**가 되어 관리 거버넌스 강화.
- **탄소중립**: 무단 채굴 24시간 풀가동 전력 낭비 차단 → 탄소 배출 감소, **냉방 부하 동반 절감**.
- **정밀 탐지**: 정상 고부하 ↔ 채굴 구분(다층 + AI), 오탐 최소화.

---

## 발표 핵심 메시지 (한 장)
> "GPU 고점유를 룰 엔진은 **채굴로 의심**하지만, RADA는 프로세스·작업 시그니처와 AI 판단으로 **정상 렌더링을 구제**한다 — 자원 패턴이 같은 둘을 구분하는 것이 핵심이며, 검증으로 채굴은 잡고(2·3·8) 정상은 통과(1·4·5·6·7)시킴을 보였다."
