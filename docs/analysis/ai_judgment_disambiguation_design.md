# AI 판단 기반 자원-시그니처 모호성 해소 — 설계 초안

> 상태: **초안 (논의 합의 반영, 미커밋)** · 작성일 2026-06-02
> 범위: 정상 고부하 연산 ↔ 채굴의 자원-시그니처 동일성으로 인한 오탐을, 탐지
> 점수를 약화하지 않고 **AI 판단 + 환경 프로파일**로 해소하는 설계.
> 비범위: retrieval enrichment(보류, §8), 룰 점수 재조정(무관).

---

## 1. 배경 — 무엇이 문제인가 (실증)

레드팀 실험(`pre_improvement_sim_experiment.md` §7)에서 **정상 활동 4종이 위험으로
오분류**됐고, **실제 Claude 호출 시에도 AI가 룰 판정을 그대로 확정**했다(정상
프로세스 종료 권고).

| 정상 활동 | 룰 | 실제 AI 판정 | AI 권고 |
|---|---|---|---|
| BOINC 분산컴퓨팅 | SUSPICIOUS | SUSPICIOUS | "BOINC 종료" |
| V-Ray 3D 렌더 | SUSPICIOUS | SUSPICIOUS | "vray.exe 중단 + 보안스캔" |
| MATLAB 야간 연산 | SUSPICIOUS | SUSPICIOUS | "matlab.exe 종료" |
| OBS 스트리밍 인코딩 | SUSPICIOUS | SUSPICIOUS | "obs64.exe 점검" |

**근본 원인**:
1. **구조적**: 자원 시그니처(GPU/CPU flat·VRAM 낮음·텐서0)가 정상 연산과 채굴에서
   동일. 룰은 이 둘을 본질적으로 구분 불가. → 룰을 탓할 게 아니라 **disambiguation
   은 AI의 몫**.
2. **AI 앵커링**: 프롬프트가 룰 결론("GPU채굴 11점", "유사 3건 SUSPICIOUS")을
   단정적으로 먼저 주입 → AI가 거기에 정박. (V-Ray에서 "렌더링과 불일치"를 *인지*
   하고도 SUSPICIOUS 결론 → 능력이 아니라 **프레이밍** 문제.)
3. **맥락 부재**: AI에 "이 PC/장소에서 어떤 워크로드가 정상인지"가 없음.

---

## 2. 설계 원칙 (논의 합의)

1. **환경 맥락은 모델 가정이 아니라 배포 정책 데이터다.** 프롬프트에 "여기는
   연구실" 같은 가정을 하드코딩하지 않는다(오버피팅 → 공공/강의장 PC에서 진짜
   채굴 놓침=FN). 정책으로 선언하고, **기본값은 보수적(general)**.
2. **AI는 비파괴 자문 레이어다.** engine verdict 가 저장/집계의 권위로 유지된다.
   AI는 옆에 판단을 *병기*하고 **표시/알림 정책만 완화**한다. 자동 하향은 운영
   검증 후에만. (risk_vector/signal_quality/explanation_confidence 와 같은 additive 패턴.)
3. **하드 신호는 흔한 모호함·프로파일·드문 예외와 무관하게 항상 에스컬레이션.**
   드문 정상 예외(예: 채굴 연구)는 **운영자가 외부에서 처리**할 일이지(시만텍↔RADA
   비유) 시스템이 약화할 이유가 아니다.
4. **Sonnet 유지.** 능력 문제가 아니라 프레이밍 문제. 단 실증 검증 후 확정.

---

## 3. 핵심 결정 규칙 — 빈도 × 정밀도

신호/상황을 **"정상 오인이 흔한가 × 신호가 흔한 트래픽에서 정확한가"** 로 분류한다.

| 분류 | 정의 | 처리 | 예 |
|---|---|---|---|
| **하드** | 고정밀 + 위조 어려움 + 정상오인 드묾 | 항상 에스컬레이션. 완화·프로파일·예외 무관 | `known_miner`, persistence |
| **완화 대상** | 흔한 정상이 동일 시그니처를 내는 모호한 자원-단독 SUSPICIOUS | 프로파일+AI 구조화 판단으로 완화 | GPU 연산/렌더/인코딩/과학연산 |
| **영구 제외** | 흔한 정상 트래픽에서 틀리는 저정밀 신호 | 하드도 완화대상도 아님. 부활 시 정밀화+FP게이트 필수 | `mining_pool_ip`(prefix) |

- `known_miner` 가 하드인 이유: 정밀하고 정상오인이 **드물다**. → 드문 예외(채굴
  연구)로 약화하지 않음. **시스템 내 "드문 정상" 배려 로직 없음.**
- `mining_pool_ip` 가 제외인 이유: 다름 — **흔한 정상 클라우드 IP를 오인하는 저정밀**
  신호라서(과거 PC-01 FP 주범). 현재 `MINING_POOL_IPS=∅` 로 비활성. 부활하려면
  `/16` prefix 금지·정확 단일 IP(위협 인텔)·검증 전 하드 승격 금지.

---

## 4. 컴포넌트 스펙

### 4-1. 환경 프로파일 (정책 데이터)

PC별/장소별 명시 설정. 기본값은 무조건 보수.

```
pc_info.workload_context   TEXT  DEFAULT 'general'
   - 'general'              : 고부하 연산도 의심(공공/강의장/도서관 등 기본)
   - 'lab_compute_allowed'  : 과학연산/렌더/인코딩이 '그럴듯한 맥락'(연구실)
   - (확장 여지: 'render_farm', 'build_server' 등)
pc_info.allowed_workloads  TEXT[]  -- (선택) 허용 워크로드 태그
```

규칙:
- **fail-safe**: 미설정/불명 → `general`(보수). 절대 관대한 쪽으로 추론 금지.
- `lab_compute_allowed` 의 의미 = "고부하 연산이 **맥락상 그럴듯**"이지 "고부하=항상
  정상"이 **아님**. AI는 여전히 반증을 따진다(§4-3).
- 프로파일 **변경 감사 로그**(누가/언제/어느 PC를 무슨 프로파일로). 오설정이 곧 FN.
- 프로파일은 **완화 대상(§3) 신호에만** 입력으로 들어간다. 하드 신호 경로는 프로파일을
  보지 않는다.

**전달 경로(아키텍처 정합)**:
```
운영자 → pc_info.workload_context 설정(provisioning/admin, 감사)
Spring  → pc_info 조회 후 /analyze 페이로드에 주입 (MetricsRequest.workload_context, default 'general')
ML      → payload 에서 읽어 프롬프트에 사용 (stateless 유지, DB 직접 접속 안 함)
```
- ML 이 pc_info 를 직접 조회하지 않는다(Spring=DB 소유, ML=stateless 원칙).
- **클라이언트(rada_client) 보고 금지** — 운영자 정책이지 클라이언트 자기신고가 아님
  (위조/침해 PC 가 'lab' 을 사칭해 채굴을 숨기는 것 차단).
- 마이그레이션: `pc_info` 에 `workload_context TEXT DEFAULT 'general'` 컬럼 추가(Flyway).

### 4-2. 하드 신호 게이트 (프로파일·AI 이전 단계)

```
if (known_miner OR persistence(known_miner)):
    → 즉시 에스컬레이션 (기존 fast-path/verdict 그대로)
    → 프로파일/AI 완화 경로 진입 금지
else if (자원-단독 SUSPICIOUS, 프로세스/풀 확정 근거 없음):
    → 완화 대상 → 프로파일+AI 판단(§4-3)
```
- `mining_pool_ip` 는 하드에 포함하지 않는다(§3). network_only_cap 면제 목록에서도
  재검토(현재 비활성이라 무영향이나, 부활 대비 정책 명시).

### 4-3. AI 판단 레이어 (additive, 비파괴)

기존 `report_judgment` tool 스키마에 **기계가 읽을 필드** 추가:

```
report_judgment(추가):
  benign_workload_likely      : bool
  benign_confidence           : enum(LOW, MEDIUM, HIGH)
  contradicting_mining_evidence: [pool_absent, no_known_miner, signed_binary,
                                  progfiles_path, tensor_active, vram_high, ...]
```

저장/표시 분리:
```
anomaly_history.severity      = engine verdict        (권위, 불변)
ai_judgment_history           = 기존 + benign_workload_likely / benign_confidence
표시·알림 정책                 = benign_workload_likely=true 면 톤·알림만 완화
                               (anomaly_history severity 는 안 바꿈)
```
- **자동 하향(engine verdict overwrite) 은 초기엔 OFF.** 처음엔 "표시/권고 완화"만.
  운영 검증(§5/§6) 통과 후에만 자동 하향 옵션 활성.
- `benign_confidence` 는 완화 강도를 가른다(§4-5): HIGH=알림 저우선순위, MEDIUM=배지만
  (알림 유지), LOW=완화 없음.

### 4-4. 프롬프트 골격 (탈앵커링 + 양가설)

룰 결론을 단정으로 주지 않고 **중립 관측 증거**로 제시 → AI가 가설 비교.

```
[관측 증거]  (판정 아님)
- GPU flat high / tensor inactive / VRAM low / CPU low
- mining pool connection: 없음 / known miner process: 없음
- executable path: Program Files 서명 여부
- declared workload context: <general | lab_compute_allowed>   ← 정책 데이터

[지시] 다음을 순서대로 판단하라:
  1. 악의적 채굴 가설
  2. 정상 워크로드 가설
  3. 각 가설을 지지하는 증거
  4. 채굴을 반증하거나 빠진 증거
  5. 최종 판단 (benign_workload_likely + confidence + 근거)
```
- "유사 과거 사례는 **참고일 뿐 현재 단정 금지**" 명시.
- 입력 토큰 증가(현 ~1,644 → ~3,000)는 비용 무시 수준, 정상작업 종료 방지 가치가 큼.

### 4-5. 표시/알림 정책 (Spring/Grafana) — confidence 티어링

`anomaly_history.severity` 는 **항상 불변**(기록 보존). 완화는 표시/알림에만.

| engine | benign_confidence | Grafana 표시 | 알림 |
|---|---|---|---|
| SUSPICIOUS | HIGH | benign 배지 + 톤 완화 | **저우선순위/digest** |
| SUSPICIOUS | MEDIUM | benign 배지 | **정상 유지(묵음 안 함)** |
| SUSPICIOUS | LOW / false | 정상 SUSPICIOUS | 정상 알림 |
| 하드신호(known_miner 등) | (무시) | 정상 위험 | 정상 알림 |

원칙:
- **묵음(알림 억제)은 없다.** 최대치도 "저우선순위/digest"(human-in-loop).
- 완전 묵음은 **"정상 앱"이 아니라 "운영자가 인가(authorized)했을 때"만**(§4-7 인가 축).
  trusted_app(=정상 앱)만으론 부족 — 무단 BOINC 도 정책 위반일 수 있으므로 digest 유지.
- MEDIUM 은 알림을 **유지**(FN-safe) — AI 가 어중간하면 운영자가 본다.
- severity 자동 하향(engine overwrite)은 기본 OFF, 검증 후에만(§6).

### 4-6. 트러스트앱 레이어 — **단계화 필수** (signer 미수집 제약)

⚠️ **현재 클라이언트는 Authenticode signer 를 수집하지 않는다**(name/path/conn-owner 만).
이름만 신뢰하면 `C:\...\Temp\obs64.exe` 같은 **스푸핑에 취약**. 따라서 단계화:

**Phase A (지금 가능, 자동완화 X)**
```
if (자원-단독 SUSPICIOUS) AND (top_process.name ∈ trusted_app)
   AND (path ∈ Program Files) AND (프로파일 ∈ 허용):
      → "candidate trusted" 표시만 (운영자 참고). 자동 완화/묵음 안 함.
      → 여전히 AI 판단(§4-3) 거침.
```
**Phase B (signer 수집 추가 후)**
```
+ 클라이언트가 Authenticode signer/publisher 수집 → 페이로드에 포함
+ signer 유효성 검증 통과 시에만 → 결정적 benign 완화(AI 생략 가능)
```
- **프로파일 게이트 필수**: general 에선 trusted_app 이라도 **미적용/엄격**(공공 PC 의
  BOINC=의심 유지). lab 등 허용 프로파일에서만.
- **하드 신호 우선**: trusted 경로·서명이어도 `known_miner`/persistence 동반 시 **하드
  우선**(완화 무효, §4-2).
- 운영자가 trusted_app 목록 추가/감사(④ 피드백의 결정적 버전).

### 4-7. 두 개의 축 — "악성 아님" ≠ "인가됨"

trusted_app·프로파일·AI 는 **축 A(악성 여부)** 만 답한다. **축 B(인가 여부)** 는 별개다.

| 축 | 질문 | 해결 | 미충족 시 |
|---|---|---|---|
| A. 악성 | 채굴/악성인가 | trusted_app + 프로파일 + AI | 위험 알림 |
| B. **인가** | 이 자원 사용이 **허가됐나** | **운영자 정책(인가 라벨)만** | "정상 앱이나 미인가" → **digest 유지** |

- 무단 설치된 BOINC = "정상 앱(A 통과)"이지만 "미인가(B 위반)" → **완전 묵음 금지, digest**.
- **완전 묵음은 운영자가 해당 PC/작업을 명시적으로 인가(authorized)했을 때만.** 즉
  trusted_app 이 아니라 **operator-authorized 라벨**이 묵음의 전제.

---

## 5. 회귀 테스트 매트릭스 (안전성 게이트)

`tools/sim_fleet.py` 로 실증. **3번이 통과해야 설계가 안전**(FN 미발생 보장).

| # | 입력 | 프로파일 | 기대 | 검증 |
|---|---|---|---|---|
| 1 | BOINC/V-Ray/MATLAB/OBS | lab_compute_allowed | benign_likely=true, 표시 완화 | FP 완화? |
| 2 | 실제 채굴(xmrig/known) | general | HIGH 유지 | 기본 탐지 불변? |
| 3 | **실제 채굴(xmrig/known)** | **lab_compute_allowed** | **여전히 HIGH** | **lab이 진짜 채굴 가리는가?(하드 override)** |
| 4 | BOINC 등 | general | SUSPICIOUS 유지(완화 안 함) | 공공 PC 보수성 유지? |
| 5 | **temp/appdata 의 fake trusted(예: temp\obs64.exe)** | **lab_compute_allowed** | **완화 금지** | **trusted_app 스푸핑 방어(경로/서명)** |
| 6 | **trusted 정상경로 OBS/BOINC + `known_miner` 동반** | **lab_compute_allowed** | **HIGH(하드 우선)** | trusted여도 known_miner 우선? |
| 7 | trusted_app(정상경로) | general | 자동 완화 금지 | general 에선 trusted 미적용? |

- #3·#6 = FN 안전 게이트(하드 우선). #5 = 스푸핑 방어(이름만 신뢰 금지의 실증).
- #4·#7 = 환경별 차등(general 보수성)이 맞게 작동하는지.
- ⚠️ **pool 동반은 #6에서 제외**: `mining_pool_ip` 는 현재 비활성·하드 아님(§3). 따라서
  "pool-only 동반"은 **지금은 HIGH 가 아니다**. 정밀 IOC 로 재도입(정확 IP+FP게이트)된
  뒤에야 별도 정책으로 HIGH 가능 — 그때 #6b 로 추가한다.

---

## 6. 롤아웃 / 검증 게이팅 (additive-first)

### 6-1. 기능 활성화 단계
1. **Phase 1 — additive 관측**: benign_workload_likely 를 *계산·저장만* 하고
   표시/알림은 그대로. 실데이터에서 AI 판단의 정확도(특히 §5 #3 FN) 누적 측정.
2. **Phase 2 — 표시 완화**: 검증되면 Grafana 톤/알림만 완화(confidence 티어링). severity 불변.
3. **Phase 3 — (선택) 자동 하향**: 충분한 검증 후에만 engine verdict 자동 하향 옵션. 기본 OFF.

### 6-2. 구현 순서 (범위 분리 — 한 번에 다 X)
> 스키마 변경/클라이언트 변경은 범위가 크므로 **승인 단위로 쪼갠다.**

1. **profile PoC = config/YAML** 로 먼저(스키마 변경 없이). 프롬프트·티어링·회귀(§5) 효과 확인.
2. **trusted_app Phase A** (name+ProgramFiles+프로파일, 표시만) — signer 없이 가능한 범위.
3. **pc_info.workload_context 컬럼 + Flyway** — **별도 승인 대상**(DB 스키마 변경). 장기 정착.
4. **trusted_app Phase B** — 클라이언트 Authenticode signer 수집 추가 후(메트릭 스키마 변경, 별도).

→ 기존 RADA 원칙(*"성능 확정 전까진 추가 필드로 검증"*) 그대로. 각 단계 독립 승인.

---

## 7. 결정 사항 (구 미해결 → 확정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 프로파일 위치 | **정식**: `pc_info.workload_context TEXT DEFAULT 'general'` / **PoC**: config/YAML(§6-2). 둘 다 Spring→/analyze 주입, ML은 payload에서 읽음 | per-PC, 기존 인프라/감사, stateless·DB소유 원칙 정합. 클라이언트 보고 금지 |
| 완화 임계 | confidence 티어링: HIGH=알림 저우선, MEDIUM=배지만(알림 유지), LOW=완화 없음 | 묵음은 HIGH 확신에만, severity 불변이라 기록 보존 |
| 알림 완화 정도 | 완전 억제 금지 → 저우선순위/digest | human-in-loop. **완전 묵음은 trusted_app 아니라 operator-authorized 라벨(§4-7)에만** |
| general 빈발 정상 피드백 | 통계 자동학습 금지 → 명시 정책 행동(재프로파일 / 트러스트앱 추가, 감사) + "자주 뜨고 AI-benign" 리포트 | FN 피드백 루프 회피 |
| (추가) 트러스트앱 레이어 | §4-6 — **Phase A 표시만 / Phase B signer 검증 후 결정적**, 프로파일 게이트 | 알려진 정상앱은 (Phase B 이후) AI 전 결정적 처리(호출↓·신뢰↑) |

### 남은 결정 (작게)
- `workload_context` 확장 enum 범위(render_farm/build_server 등) — 도입 시점에 결정.
- 트러스트앱 목록 초기 시드(BOINC/V-Ray/MATLAB/OBS/ffmpeg…).
- **signer 수집(확정 사실)**: 현재 코드 기준 **signer 미수집 확인됨**. Phase B 전
  `client_core` process collector 에 **Authenticode signer/publisher 수집 추가 필요**
  (메트릭 스키마 변경 → 별도 승인, §6-2).
- digest 알림 채널/주기(Grafana alert vs 별도 리뷰 큐).

---

## 8. 비범위 / 보류 (이유)

- **retrieval enrichment 보류**: 이 FP 문제의 주력이 아님. 과거 사례 이유를 붙여도
  앵커링·맥락부재를 못 고치고, **FP 자기강화 루프**(시스템 자신의 FP가 코퍼스에
  SUSPICIOUS로 쌓여 미래 유사 정상건을 확증)를 오히려 강화할 수 있음. 설명 품질용
  으로는 나중에, 단 "과거 사례 정답 여부" 가중치 동반 시에만.
- **AI 판단 피드백 루프 주의**: `benign_likely` 결과도 무비판 재투입 금지(FP 루프의
  거울상인 FN 루프). 운영자 확인 라벨 없이는 통계/retrieval 에 가중하지 않음.

---

## 9. 한 줄 요약

**흔한 모호함은 완화, 드문 예외는 운영자 몫, 고정밀 신호는 불변.**
환경 맥락은 정책 데이터(정식 `pc_info.workload_context` / PoC config·YAML, 기본
general, Spring 주입)로, 판정은 **트러스트앱(Phase A=표시만 / Phase B=signer 검증 후
결정적, 프로파일 게이트) → AI 비파괴 자문(confidence 티어링, 표시/알림만 완화)** 순서로,
하드 신호(known_miner)는 항상 에스컬레이션. 완전 묵음은 trusted_app 이 아니라
**operator-authorized 라벨**에만. severity 는 불변, 자동 하향은 검증 후. Sonnet으로
충분하되 **회귀(특히 #3/#6 lab_compute_allowed+실채굴=HIGH, #5 스푸핑)** 로 FN·스푸핑
안전성을 실증한 뒤 단계적 활성화.
