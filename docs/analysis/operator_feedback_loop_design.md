# 운영자 피드백 루프 설계 (AI 판단 정탐/오탐 라벨링)

> Grafana에서 운영자가 "AI 판단이 맞았는지"를 입력 → 저장 → 측정 → (비파괴)
> AI/retrieval 반영 → 제안형 튜닝까지의 폐쇄 루프 설계.
>
> **핵심 원칙**: 피드백은 탐지를 **자동으로 바꾸지 않는다.** 측정하고, AI에
> 비파괴로 알려주고, 튜닝을 *제안*만 한다. (운영자도 틀릴 수 있고, 라벨 오염
> 위험도 있으므로)
>
> 작성: 2026-06 / 관련: [`ai_judgment_disambiguation_design.md`](ai_judgment_disambiguation_design.md) (AI 강등권 §4), `docs/report/improvement_backlog.md`

## 0. 배경 — 왜 필요한가

지금까지 FP율(65.9%→0%)은 **사람이 수동으로** fp_field_analysis 문서를 써가며
측정했다. 운영 단계에선 이걸 **운영자 라벨**로 자동화해야 한다. 또한 운영자
라벨은 AI 강등권(★)의 신뢰 근거가 되어 **진짜 FP 감소**로 이어진다.

Grafana는 기본 **읽기 전용**(PostgreSQL 데이터소스도 SELECT만 허용)이라,
"입력→저장"은 폼 패널 플러그인 + 백엔드 쓰기 엔드포인트가 필요하다. Grafana가
DB에 직접 쓰지 않고, **폼 패널이 HTTP로 Spring을 호출**하고 Spring이 저장한다.

```
[Grafana 폼 패널] --HTTP POST--> [Spring /api/feedback] --INSERT--> [ai_feedback]
   (정탐/오탐 선택)                  (인증 필요)            ML이 나중에 읽음
```

---

## Phase 1 — 수집 (Collection)

### 1-1. 테이블
```sql
CREATE TABLE pc_monitor.ai_feedback (
  id            bigserial PRIMARY KEY,
  anomaly_id    bigint REFERENCES pc_monitor.anomaly_history(id),
  pc_id         text NOT NULL,
  judged_at     timestamptz,              -- 어떤 판단에 대한 피드백인지
  operator_verdict text NOT NULL,         -- CORRECT / FALSE_POSITIVE / FALSE_NEGATIVE
  note          text,
  operator      text,                     -- 누가
  created_at    timestamptz DEFAULT now(),
  UNIQUE(anomaly_id, operator)            -- 중복 라벨 방지(멱등 UPSERT)
);
```

### 1-2. Spring 엔드포인트 `POST /api/feedback` (인증 필수)
- 입력: `anomaly_id`, `operator_verdict`, `note`
- 저장 + 멱등(같은 anomaly+operator면 UPDATE)
- operator는 인증 주체에서 주입(폼 입력값 신뢰 ❌)

### 1-3. Grafana 폼 패널 (`volkovlabs-form-panel`, community)
- 현재 anomaly_id(대시보드 변수) + 드롭다운(정탐/오탐/미탐) + 노트 → 지정 URL POST
- 통합 AI 패널 **D구역(조치) 아래**에 배치 → "AI 판단이 맞았나?" 즉시 입력
- 컨테이너에 플러그인 설치 필요(`GF_INSTALL_PLUGINS` 또는 unsigned 허용)

---

## Phase 2 — 표시 + 측정 (가장 안전, 즉시 가치)

### 2-1. 대시보드 표시
이상 이력 / 통합 AI 패널에 feedback 조인 → `✓정탐 / ✗오탐` 라벨 표시.

### 2-2. 자동 FP율 메트릭 (수동 fp_field_analysis 자동화)
```sql
SELECT date_trunc('day', created_at) AS 일자,
       count(*) FILTER (WHERE operator_verdict='FALSE_POSITIVE')::float
         / nullif(count(*),0) * 100 AS FP율
FROM pc_monitor.ai_feedback GROUP BY 1 ORDER BY 1;
```
→ "65.9%→0%" 같은 수치를 **사람이 분석 안 해도 패널에 자동으로**. 이것만으로도 충분한 가치.

---

## Phase 3 — 비파괴 소비 (AI/retrieval에 "알려주기")

라벨을 **retrieval에 주입** (verdict는 안 바꿈):
- pgvector `retrieval_segments`에 `operator_label` 컬럼 추가
- 유사검색 시 "이 패턴과 유사한 과거 사례 중 **운영자가 오탐 확인 N건**"을 evidence로 반환
- → AI `explanation_confidence` / benign 근거에 반영. **verdict 불변**(비파괴), AI 설명만 똑똑해짐

이것이 **AI 강등권(★ backlog)과 연결**: "유사 패턴이 반복적으로 오탐 확인됨" =
AI가 benign으로 강등할 강한 근거.

---

## Phase 4 — 제안형 튜닝 (사람 승인 루프, 자동 적용 ❌)

라벨 집계로 **자동 제안만** 생성:
- 특정 PC FP 반복 → "이 PC를 `lab_compute_allowed`로 표시할까요?" 제안
- 특정 신호 조합이 늘 오탐 → "이 패턴 게이팅 조정 검토" 제안
- 인프라 IP 반복 EXFIL 오탐 → **allowlist 후보** 제안 (FP-OPS-1 자동화)

→ 운영자가 **승인 버튼**으로만 반영. 제안은 backlog/알림으로.

---

## Phase 5 — 강등권 근거 강화 (폐쇄 완성)

확인된 FP 라벨이 **AI 강등권의 신뢰 근거**가 됨:
- "동일/유사 패턴 운영자 오탐 확인 ≥ N회" → AI가 SUSPICIOUS→OBSERVE 강등 시 confidence 상향
- 단 **하드 신호(known_miner·fast-path)는 라벨 무관 불변** — 오염 방지

---

## 🛡️ 안전 가드레일 (필수)

| 위험 | 방어 |
|---|---|
| 운영자 오라벨 | 단일 라벨 즉시 반영 ❌ — **N회 누적/다수 합의** 후 제안 |
| 라벨 오염(악의) | 인증 + operator 기록 + **하드신호 불변** |
| 자동 미탐화 | 강등권은 **floor 있고 fast-path 제외** |
| 되돌리기 | 라벨 append-only, 소비는 제안형이라 롤백 쉬움 |

---

## 단계별 가치/난이도 + 권장 순서

| Phase | 가치 | 난이도 | 비고 |
|---|---|---|---|
| 1 수집 | 라벨 축적 시작 | 낮음 | 테이블+엔드포인트+폼 |
| 2 측정 | **FP율 자동화** | 낮음 | 즉시 효과 |
| 3 retrieval 주입 | AI 설명 ↑ | 중 | 비파괴 |
| 4 제안 튜닝 | 운영 효율 | 중 | 사람 승인 |
| 5 강등권 연결 | **진짜 FP 감소** | 높음 | 강등권 선행 필요 |

**권장**: 1→2 먼저(저비용 고가치) → 라벨 쌓이면 3(비파괴) → 강등권 구현되면 5 → 여유되면 4.

**한 줄**: 운영자 피드백은 "자동으로 시스템을 바꾸는 것"이 아니라
**"측정 → AI에 귀띔 → 사람에게 제안"** 순서로 흘러야 안전하며, 그것이 FP 개선의 정석 루프다.
