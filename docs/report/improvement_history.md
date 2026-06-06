# RADA 개선 이력 — 전체 타임라인 (2026-05 ~)

> 메인 리포트(`README.md`)에서 분리한 **프로젝트 진화 전체 기록**. 커밋 해시 +
> 테마별 묶음 + 관련 분석 문서 링크. FP 개선 여정(65.9% → 0%)이 중심.

## 단계 요약

| 기간 | 단계 | 핵심 |
|---|---|---|
| 05-15 | 초기 구축 | 클라이언트·ML·Spring·DB·테스트 골격 |
| 05-16~18 | 점수정책 v0.5 + retrieval | scoring_policy, allowlist, retrieval store/evidence |
| 05-18~19 | 인프라·배포 안정화 | DB migration, healthcheck, NCP systemd, prometheus |
| 05-19~20 | 수집 신뢰성(silent-fail 방어) | collector missing reason, timezone, payload 검증 |
| 05-21 | 카테고리 채굴 탐지 v0.6 | resource/network/system 패턴 + sustained gating |
| **05-24~25** | **★ FP 개선 여정 P0/P1/P2** | **65.9% → 0%** (아래 상세) |
| 05-29 | Phase 1-2 additive 신호 | risk_vector, signal_quality, explanation_confidence |
| 05-29~06-01 | AI 연동 | mock → 실제 Claude(tool use) + 런타임 토글 |
| 06-01 | 추가 FP 튜닝 | mining_pool_ip 비활성 등 |
| 06-02 | 품질·인프라 | ruff, CI env_file, **pgvector 영속 백엔드** |
| 06-03~04 | 시뮬·AI 개선 | sim_fleet, 탈앵커링 프롬프트, **장기 FP 발견** |

---

## 상세 타임라인 (테마별)

### 1. 초기 구축 (05-15)
- `73b66cd` 초기 시스템 — 클라이언트 수집기, ML 서버, Spring, PostgreSQL schema, 테스트 골격 일괄.

### 2. 점수정책 v0.5 + retrieval 기반 (05-16~18)
- `03c065c` scoring_policy.yaml + allowlist + retrieval(segment/store/evidence) + policy loader/validation + policy_version 응답. `agent_core`→`client_core` 정리.
- `217e2e7` retrieval_evidence를 anomaly_history.scores JSONB에 보존.
- `dd857c9` cosine retrieval + per-feature normalization → separability 개선.
- `4ac0615` retrieval 실데이터 검증 도구.

### 3. 인프라·배포 안정화 (05-18~19)
- `7f6d3a0` V6 / `a71ba49` V7 — `rada` role search_path migration(스키마 접근 안정화).
- `6393cf5` Flyway auto-repair/gated repair(마이그레이션 충돌 완화).
- `a65f5a7` Spring healthcheck wget→curl.
- `f7d5187` Spring→ML ISO timestamp 직렬화 수정(WebClient/ObjectMapper) + anomaly trigger 도구.
- `262c153` NCP 운영 경로(FastAPI systemd, PostgreSQL bootstrap, Flyway repair gating).
- `d57075e` Grafana reader DB 권한/search_path 정합.
- `b4b7140` Spring 관리 포트 분리 + Prometheus scrape.
- `a9e53e5` AlertService DI + PostgreSQL host port 정합.

### 4. 수집 신뢰성 — silent-fail 방어 (05-19~20)
> "수집 실패"와 "실제 0값"을 구분하는 게 오탐/미탐 모두에 중요.
- `3a07df2` collector **missing reason** 도입(네트워크/프로세스/GPU 수집 실패 구분).
- `f6e3634` ML payload 검증 + silent skip/fail count.
- `493c5f3` silent-fail 메트릭 노출.
- `0082c45` P2 silent-fail 후보 보강.
- `645729c` 클라이언트 timestamp timezone-aware(OffsetDateTime 변환 깨짐 방지).
- `65611f4` Windows `user_idle_ms`(GetLastInputInfo) 수집.
- `2a1117f` PC bulk provisioning/키 회전/폐기 도구.

### 5. 카테고리 기반 채굴 탐지 v0.6 (05-21)
- `5216d89` resource/network/system **category pattern evaluator + sustained gating**.
- `e443799` category_signals를 scores JSONB에 저장.
- 패턴 카탈로그: `docs/reference/cryptojacking_detection_patterns.md`.

### 6. ★ FP 개선 여정 P0 → P1 → P2 → NCP (05-24~25) — 65.9% → 0%
> 본 프로젝트의 핵심. 필드 측정 기반으로 오탐원을 단계적으로 제거. 각 단계 분석 문서 보유.

**P0 — 구조적 오탐원 제거** [문서: `docs/analysis/fp_field_analysis_v0.6.md`]
- `3e88ddb` (P0-1) **LOW/OBSERVE 저장 차단** — 약신호가 anomaly_history 오염 방지.
- `b571a31` (P0-2) **severity 정리** — alert severity override 제거, overall_severity = engine verdict.
- `d979cdd` (P0-3) **promotion gating + evidence_meta** — 단일/약신호의 MEDIUM/HIGH 승격 차단, 근거 구조화.

**P1 — 잔여 FP 배치 개선** [문서: `docs/analysis/fp_field_analysis_post_p1.md`]
- `2d252ee` (P1) **local_evidence 분리 + DOS absolute floor + episode decay + retrieval positive gating**.
- `70cf2e9` 클라이언트 HW degradation 임계 강화(노후화 detector 오탐↓).
- `18bd252` (P2 준비) **backdoor verdict demotion** — SUSPICIOUS_BACKDOOR FP 원인(잔여 54건 중 53건) 제거.

**P2 — 미세 잔여 + 회귀** [문서: `docs/analysis/fp_field_analysis_post_p2.md`]
- `873b2cf` stealth miner 회귀 테스트(fast-path 없이 탐지).
- `80b905e` GPU missing reason(driver_error) 회귀.
- `05eead0`/`6412001`/`46ade40` 클라이언트 노이즈/콘솔 깜빡임 정리, trigger 도구 env화.

**효과(측정)**: **Pre-P0/P1 65.9% → P0+P1 1.6% → P2 로컬 0% → NCP 운영 0.000%**(7h39m, FP 0건, mining 즉시 발화). [문서: `docs/analysis/fp_field_analysis_ncp.md`]

### 7. Phase 1-2 additive 신호 (05-29)
- `4254062` **risk_vector(4축) + signal_quality + explanation_confidence + stub 표시 + per-core CPU + external_connection_owner + process_recreation** additive 신호 + sustained replay 테스트. (기존 verdict 불변)
- `4f54677` 클라이언트 PC ID override(고정 로스터 ID 매핑).

### 8. retrieval 점수 분리 + network/DOS 정리 (05-29)
- `07402e7` **retrieval final score 분리** — retrieval이 점수를 안 끌어올리고 설명 신뢰도 근거로만(FP 원인 제거).
- `7c021ec` **network-only SUSPICIOUS 차단**(네트워크 약신호만으로 승격 방지).
- `7398d9a` **DOS를 network_abuse 축 분리** + inbound floor/연속 조건 강화.
- `312e1b6` **sustained gap reset/cap** — offline/장기 정상 연결의 sustained 과누적 방지.

### 9. AI 연동 (05-29~06-01)
- `8f6e67a` 외부 리뷰 대응 — network-only cap 정합, signal_quality/explanation_confidence Spring 저장, stub implemented:false 명시.
- `c0d7888` AI 호출 범위 MEDIUM부터.
- `6af042b` 실제 Claude API key 주입(docker-compose/env).
- `2ab8063` env_file 주입 + 응답 파싱 안정화.
- `b6c7d95` **tool use 안정화 + 공용 PC 역할 프롬프트 + AI 런타임 토글**.
- `b09cec5` 추가 FP 튜닝 — **mining_pool_ip 비활성, unknown_process 80%, appdata 가중치↓**.

### 10. 품질·인프라 (06-02)
- `43e0d0f` CI env_file optional(.env 없는 CI에서도 compose 안 깨짐).
- `946ae79` **ruff 린트 정리(132→0) + ruff.toml**.
- `aa1a3a8` **pgvector retrieval 영속 백엔드(opt-in)** [문서: `docs/analysis/pgvector_adoption.md`].

### 11. 시뮬·AI 개선·장기 FP 발견 (06-03~04, 이번 세션)
- `670a230` **가상 PC 플릿 시뮬레이터(sim_fleet)** — ~49 시나리오(채굴/자원/위협/엣지/레드팀).
- (미커밋) **AI 탈앵커링 프롬프트** — 레드팀 FP 8/8 해소, 실채굴 FN 안전.
- (미커밋) **일주일 시뮬로 장기 행동게이팅 FP 발견**(209분) → `confirmed_sustained` 하드 강등 설계. [문서: `docs/analysis/ai_judgment_disambiguation_design.md`, `pre_improvement_sim_experiment.md`]

---

## FP 개선 여정 한눈 표

| 단계 | FP율 | 핵심 변경 | 문서 |
|---|---|---|---|
| Pre-P0/P1 | **65.9%** | (baseline) | fp_field_analysis_v0.6 |
| P0+P1 | **1.6%** | LOW저장차단·severity정리·promotion gating·local분리·DOS floor·episode decay·backdoor 강등 | post_p1 |
| P2(로컬) | **0%** | stealth 회귀·노이즈 정리·잔여 미세 | post_p2 |
| **NCP 운영** | **0.000%** | 7h39m 실측, FP 0건 | fp_field_analysis_ncp |
| (이번) AI층 | — | 탈앵커링으로 정상 고부하 연산 FP 8/8 구제 + 장기 행동 FP 발견 | ai_judgment_disambiguation_design |

## 참조 문서 인덱스
- 점수체계 전체: `docs/00_시스템_탐지_점수체계.md`, `docs/analysis/detection_flow_score_ai.md`
- FP 분석: `fp_field_analysis_v0.6 / post_p1 / post_p2 / ncp` (`docs/analysis/`)
- 패턴 카탈로그: `docs/reference/cryptojacking_detection_patterns.md`
- 벡터DB: `docs/analysis/pgvector_adoption.md`
- AI 판단 개선: `docs/analysis/ai_judgment_disambiguation_design.md`
- 워크로그: `docs/worklog/`
