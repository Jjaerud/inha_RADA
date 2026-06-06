# RADA 운영·개선 리포트 (Living Report)

> **목적**: RADA 프로젝트의 개선 이력 · 성능 지표(수치) · 장애 보고서 · 보안
> 체크리스트(NIST CSF 2.0)를 한 곳에 모은 **갱신형 운영 일지**. 포트폴리오·면접·
> 운영 회고 겸용.
>
> ⚠️ **갱신 규칙**: 코드·정책·인프라가 바뀌면 이 문서를 **같이 갱신**한다.
> 섹션이 너무 길어지면 `docs/report/` 하위에 분리 파일을 만들고 여기서 **하이퍼링크**로 연결.
> 모든 수치는 **실측 또는 출처 명시**. 미측정은 `TBD`로 정직하게 둔다(추정 수치 금지).
>
> 최종 갱신: 2026-06-04 · 단계: 파일럿(NCP 운영 중) + AI 판단 개선 설계/구현 중

---

## 0. 프로젝트 한 줄 요약

연구실/공용 PC **40대(60-808호)**의 자원(CPU/GPU/네트워크/프로세스)을 5초 주기로
수집해 **크립토재킹·자원 남용**을 탐지하는 시스템. 규칙 스코어링 + 비지도 ML
(IsolationForest) + 통계 임베딩 retrieval + **LLM(Claude) 판단**의 하이브리드.
스택: rada_client → Spring Boot → FastAPI(ML) → PostgreSQL → Grafana, NCP 배포.

---

## 1. 개선 이력 (Done) — 수치 포함

> 📜 **전체 진화 타임라인(2026-05~, 커밋별·테마별·FP 분석문서 링크)은 별도 파일**:
> **[`improvement_history.md`](./improvement_history.md)** — 초기구축→점수정책→silent-fail
> 방어→카테고리탐지→**FP 개선 P0/P1/P2(65.9%→0%)**→additive→AI연동→pgvector→시뮬.
> 아래는 **대표 마일스톤 요약**(수치 중심).

| 영역 | 개선 | 수치/근거 |
|---|---|---|
| **오탐(FP) 개선 여정** | P0(LOW저장차단·severity정리·promotion gating) → P1(local분리·DOS floor·episode decay·backdoor강등) → P2(잔여·회귀) → mining_pool_ip 비활성 등 | **FP율 65.9% → 1.6%(P0+P1) → 0%(P2 로컬) → 0.000%(NCP 7h39m)** [`fp_field_analysis_v0.6/post_p1/post_p2/ncp`] |
| **벡터DB 도입(pgvector)** | in-memory(휘발) → pgvector 영속 백엔드(opt-in) | 50k 검색 **286ms → 1.5ms (194×)**; 재시작 survive; NCP **13,259 세그먼트** [`pgvector_adoption.md`] |
| **카테고리 채굴 탐지 v0.6** | resource/network/system 패턴 + sustained gating | 행동 기반 탐지 추가 [`cryptojacking_detection_patterns.md`] |
| **점수 additive 레이어** | risk_vector(4축)·signal_quality·explanation_confidence·per-core·process_recreation — 기존 verdict 불변 | 비파괴 검증식(성능 확정 전) |
| **수집 신뢰성(silent-fail 방어)** | collector missing reason·timezone-aware·payload 검증·silent-fail 메트릭 | 수집실패 ↔ 실제 0값 구분 |
| **AI 실연동** | mock → 실제 Claude(tool use) + 런타임 on/off + 비용 통제 | 호출당 **입력 ~1,644 / 출력 ~752 토큰**, MEDIUM+ 만 호출 |
| **AI 탈앵커링 프롬프트** (이번 세션) | 룰 앵커링 제거 + 환경 프로파일 + 양가설 비교 | **레드팀 FP 8/8 해소**, 실채굴 FN 안전 |
| **동시성 검증** | retrieval store 공유 커넥션 부하 | **40 스레드 × 2,000 ops = 에러 0건** |
| **인프라/CI 안정화** | DB migration(V6/V7)·Flyway repair·healthcheck·관리포트분리·Prometheus·ruff | 린트 **132 → 0**, 배포 안정화 |

## 2. 예정 개선 (Planned / In-progress)

| 우선순위 | 개선 | 상태 | 설계 |
|---|---|---|---|
| ★ | **AI 디스앰비규에이션 + 환경 프로파일**(workload_context) | 로컬 구현 중 | `docs/analysis/ai_judgment_disambiguation_design.md` |
| ★ | **`confirmed_sustained` 하드 강등**(행동게이팅 max SUSPICIOUS) | 설계 확정 | 동 §4-8 |
| ◯ | trusted_app 레이어(서명/경로) — Phase A 표시 / Phase B signer 수집 | 설계 | 동 §4-6 |
| ◯ | `pc_info.workload_context` 컬럼 + Flyway(별도 승인) | 대기 | 동 §6-2 |
| ★ | **인프라/에이전트 known-good allowlist** (자기 서버 IP·포트, rada_client.exe) | 신규(운영 발견) | `ai_judgment_disambiguation_design.md` §4-9 |
| ◯ | 위협 인텔(정밀 IOC) 채굴풀 IP 재도입 | 보류 | §3(정밀화 조건) |
| △ | DB 자격증명 정기 회전(보안 하드닝) | 대기 | §5 Protect |

---

## 3. 성능 지표 (Metrics)

> 수치는 사람을 설득한다. **실측치**와 **측정 예정(TBD)**를 구분해 정직하게 둔다.

### 3-1. 실측치

| 지표 | Before → After | 출처 |
|---|---|---|
| **오탐율(FP rate)** | **65.9% → 0.000%** (NCP 7h39m, FP 0건) | fp_field_analysis |
| **retrieval 검색(50k)** | **286ms → 1.5ms (194배)** | pgvector 벤치 |
| **retrieval 영속성** | 재시작 시 corpus 0(휘발) → **유지(13,259건)** | NCP 실측 |
| **AI FP 구제율** | **0/8 → 8/8** (정상 고부하 연산) | 레드팀 4질의 ×2 |
| **린트 오류** | **132건 → 0건** | ruff |
| **동시성 안정성** | 40 스레드 2,000 ops **에러 0** | 부하 스크립트 |
| **장기 FP 탐지 시점** | 행동게이팅 HIGH 오탐 **209분(~3.5h)** 발견 | 일주일 시뮬 |
| **실제 채굴 탐지(e2e)** | 진짜 `xmrig --bench` → **CONFIRMED_MINING / HIGH_RISK**(process=10) | 실 클라이언트 격리 검증 |
| **AI 구제 도메인 한계** | compute FP **8/8 구제** vs network-exfil FP **구제 실패**(AI도 오판) | 운영 PC-01 실증 |

### 3-2. 측정 예정 (TBD — 다음 포트폴리오 과제)

| 지표 | 현재 | 목표/계획 |
|---|---|---|
| `/analyze` p95 latency | TBD | 측정 후 기록 (목표: <200ms) |
| 처리량(RPS) 부하 테스트 | TBD | 40 PC × 5초 = ~8 req/s 기준 + 10× 여유 부하 |
| Docker 이미지 크기 | TBD | ml-server/spring 이미지 측정·축소 |
| 월 클라우드 비용 | TBD | NCP VM+Cloud DB 비용 집계 |
| 장애 복구 시간(MTTR) | TBD | 장애별 복구시간 기록 |
| AI 호출 비용/월 | TBD | MEDIUM+ 발생률 × 토큰 × 단가 |

---

## 4. 장애 보고서 (Incident Reports)

> 실무자는 **실패와 복구**를 본다. 각 장애는 원인·영향·탐지·대응·재발방지로 기록.

> 📂 **FP 개선 여정(P0/P1/P2)의 오탐 장애 10건은 별도 파일**:
> **[`incidents/fp_incidents.md`](./incidents/fp_incidents.md)** — severity↔verdict 불일치
> 707건, 단일신호 승격 948/1314, backdoor 53/54, DOS 80배, sustained 4949분 등
> (필드 측정 기반 진단·수정, **65.9% → 0%**). 아래 INC-xxx는 그 외 운영 장애.

### INC-001 · mining_pool_ip 오탐 (정상 클라우드 IP → HIGH_RISK)
- **원인**: `MINING_POOL_IPS`의 2-octet prefix(`155.138.`=Vultr, `45.79.`=Linode 등)가 채굴풀이 아닌 **정상 클라우드 /16 대역 전체**를 매칭 → chrome/claude/codex 트래픽을 채굴풀로 오인.
- **영향**: PC-01이 HIGH_RISK 오탐(gpu_mining+5, cpu_mining+5 = +10점).
- **탐지**: PC-01 score_breakdown 분석에서 `mining_pool_ip=true` 확인.
- **대응**: `MINING_POOL_IPS = ∅`(비활성), unknown_process 임계 50→80%, appdata_net 6→3.
- **재발방지**: 채굴 탐지를 프로세스명(known_miner)+행동으로 전환. sim_fleet 레드팀 시나리오로 회귀.

### INC-002 · ANTHROPIC_API_KEY 미적용
- **원인**: host 셸의 빈 `ANTHROPIC_API_KEY`가 `${VAR}` 치환에서 `.env`의 실제 키를 덮어씀.
- **영향**: 실제 Claude 대신 mock 판정(key_set=False).
- **탐지**: 컨테이너 내 `key_set` 확인.
- **대응**: `env_file: .env`로 파일값 직접 주입(+CI용 `required:false`).
- **재발방지**: 가이드에 host env 우선순위 함정 명시.

### INC-003 · Claude 응답 JSON 파싱 실패
- **원인**: 응답 텍스트의 ```json 코드펜스/escape 누락 → `json.loads` 실패 → mock fallback.
- **대응**: **tool use(structured output)**로 전환해 항상 유효 JSON 강제.
- **재발방지**: max_tokens 부족(stop=max_tokens) 시 truncation 대비 char-limit 가이드.

### INC-004 · pgvector 스키마 타입 오류
- **원인**: `start_ts/end_ts`를 `DOUBLE PRECISION`으로 정의했으나 실제는 **ISO 문자열**.
- **탐지**: `InvalidTextRepresentation` (실데이터 경로에서만).
- **대응**: 스키마 `TEXT`로 수정.
- **재발방지**: PoC 테스트에 실데이터 타입 반영.

### INC-005 · 장기 행동게이팅 오탐 (구조적)
- **원인**: 정상 장기 GPU 연산이 resource+network+system 카테고리를 오래 만족 → `confirmed_sustained`(행동 mining_confirmed)가 **3.5h만에 HIGH_RISK** 승격. 프로세스/풀 증거 없음.
- **영향**: 정상 야간 연산(COMSOL/GROMACS 등) → 채굴 확정 오탐 가능.
- **탐지**: **일주일치 시뮬레이션(시간 주입)** 으로 209분 승격 확인(단기 테스트는 못 잡음).
- **대응(설계)**: confirmed_sustained 하드 강등 + 행동단독 max SUSPICIOUS + AI/프로파일 완화.
- **재발방지**: 회귀 매트릭스 #10(장기 연산 HIGH 금지) 추가.

### INC-006 · Grafana 미표시
- **원인**: Grafana 컨테이너가 기동 안 됨(스택 일부만 up).
- **탐지**: `localhost:3000` HTTP 000.
- **대응**: `docker compose up -d grafana` → HTTP 200(v13.0.1).
- **재발방지**: 배포 체크리스트에 Grafana 기동 상태 포함.

---

## 5. 보안 체크리스트 (NIST CSF 2.0)

> Govern · Identify · Protect · Detect · Respond · Recover 6 기능으로 정리.
> "감"이 아니라 **프레임워크로 사고**.

### Govern (거버넌스)
- [x] 변경 통제: 커밋은 사용자 승인 후, 기본 브랜치 보호, DB 스키마 변경은 별도 승인.
- [x] **additive 검증 원칙**: 성능 확정 전 기존 경로 불변 + 추가 필드로 검증.
- [ ] 정식 보안 정책 문서화(자산 분류/책임자) — TBD.

### Identify (식별)
- [x] 자산: PC 40대(pc_info), 호스트/IP/등록일/last_seen.
- [x] 로그/데이터: `metrics_history`·`anomaly_history`·`ai_judgment_history`(JSONB scores/alerts/reason).
- [x] 환경 프로파일(설계): `workload_context`(general/lab_compute_allowed)로 자산별 정책.
- [ ] 데이터 분류/민감도 등급 — TBD.

### Protect (보호)
- [x] 인증: rada_client→Spring **API 키(SHA-256 + pepper)**, PC별 키.
- [x] 네트워크: ACG 인바운드 **SSH 22(특정 IP/32만)**, DB 5432(앱만), 관리포트 8081 비공개.
- [x] Secret 관리: `.env`(gitignore), VM 내부 보관, `sim_keys/sim_pcs` 차단.
- [x] 최소권한(설계): `rada_ml` 전용 role(INSERT/SELECT/DELETE), cdb_admin USAGE만.
- [ ] DB 자격증명 정기 회전 — **대기**.

### Detect (탐지)
- [x] 다층 탐지: 규칙 스코어링 + IsolationForest + retrieval + 카테고리 게이팅 + **LLM 판단**.
- [x] 베이스라인: slot별 이동평균 + peer 비교 + 행동 패턴(R/S/N).
- [x] 가시화: Grafana(허니콤/리본/피드), 위험 PC + risk_vector.
- [x] 레드팀/엣지/장기 시뮬: ~49 시나리오 회귀.

### Respond (대응)
- [x] 알림: anomaly/AI 판단 저장(MEDIUM+), Grafana 표시.
- [x] 완화 정책(설계): network-only cap, confidence 티어링(HIGH=digest), **완전 묵음은 operator-authorized만**.
- [x] AI on/off 런타임 토글(비용/오작동 시).
- [ ] **자동 대응(격리/종료) — 미도입**(정상 작업 보호 위해 의도적). 향후 검토.

### Recover (복구)
- [x] 데이터 보존: metrics 14일 retention(~20GB), TTL job.
- [x] 롤백 용이: pgvector는 재생성 캐시(TRUNCATE 무방), AI/백엔드는 env 플래그 off로 즉시 복귀.
- [x] 코드 롤백: git, 단계적 배포.
- [ ] 정식 백업/DR 절차(Cloud DB 스냅샷 주기) — TBD.

---

## 6. 변경 로그 (Changelog)

| 날짜 | 변경 | 비고 |
|---|---|---|
| 2026-06-04 | 리포트 최초 작성 | 개선이력·지표·장애·NIST 체크리스트 |
| 2026-06-04 | **전체 개선 타임라인 분리** → `improvement_history.md` | 05-15~ 커밋·테마·FP 분석문서(P0/P1/P2) |
| 2026-06-04 | **FP 개선 장애 10건 분리** → `incidents/fp_incidents.md` | severity 707·단일신호 948·backdoor 53·DOS 80배·sustained 4949 |
| 2026-06-04 | (예정) AI 디스앰비규에이션 구현 + confirmed_sustained 강등 | 로컬 구현 중 |
| 2026-06-07 | **실제 xmrig 격리 검증 성공**(CONFIRMED_MINING) + **운영 EXFIL 자기참조 FP 발견**(AI도 구제 실패) | `incidents/fp_incidents.md` FP-OPS-1/2 |

---

## 7. 분리 파일 (길어질 때)

- **[`improvement_history.md`](./improvement_history.md)** — 전체 개선 타임라인(커밋·테마·FP 분석문서). ✅ 분리됨
- **[`improvement_backlog.md`](./improvement_backlog.md)** — 개선 backlog(우선순위·출처·카테고리). ✅ 분리됨
- **[`incidents/fp_incidents.md`](./incidents/fp_incidents.md)** — FP 개선 장애 10건 + 운영 EXFIL FP. ✅ 분리됨
- `docs/report/benchmarks/` — 성능 측정 raw 데이터(TBD 측정 후)
