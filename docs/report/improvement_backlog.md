# RADA 개선 Backlog (우선순위 단일 표)

> 메인 리포트(`README.md` §2)의 확장본. 이번 세션(AI 판단 개선·실증·운영 검증)에서
> 도출된 개선 항목을 **우선순위(★ 높음 / ◯ 중간 / △ 낮음·신중)** · 출처 · 상태로 정리.
> 새 항목/완료는 여기서 갱신.
>
> 최종 갱신: 2026-06-10 (운영자 피드백 루프 ★ 신설 + 세션 발견 3건: AI필드 미저장·수집 PARTIAL·PC상세 대시보드)

## A. 탐지 정확도

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ★ | **AI 디스앰비규에이션 + 환경 프로파일**(`workload_context`) — 정상 고부하 연산 ↔ 채굴 구분 | 레드팀 FP 8/8 구제 실증 | 로컬 구현(미배포) |
| ★ | **`confirmed_sustained` 하드 강등** — 행동게이팅 단독은 max SUSPICIOUS, HIGH는 정체성 증거 동반 시만 | 일주일 테스트 INC-005 / design §4-8 | 설계 확정 |
| ★ | **AI 강등권 부여(FP 구제)** — SUSPICIOUS에서 이미 호출되는 AI가 고신뢰 benign 시 OBSERVE로 **강등**. 단 fast-path/known_miner·네트워크/자기참조 도메인은 제외, 하한 floor. (현재 AI는 non-destructive라 8/8 구제가 verdict에 미반영=표시뿐) | design §4 / 본 세션 결정 | 설계 |
| ★ | **EXFIL 도메인 분리** — compute 프롬프트가 네트워크 FP를 오판(자기 모니터링 트래픽을 C2로) | INC FP-OPS-2 / design §4-9 | 설계 |
| ◯ | **AI 탈앵커링 필드 저장** — `ai_judgment_history.details`에 `benign_confidence`/`contradicting_mining_evidence`/`workload_context` 미저장(현재 action/reason/severity/judgment/hw_degradation만). 통합 AI 패널 C구역을 못 채우는 직접 원인 | 본 세션 NCP 확인 | 백로그 |
| ◯ | **trusted_app 레이어**(서명/경로, Phase A 표시 → B signer) | design §4-6 | 설계 |
| ◯ | **risk_vector ↔ legacy verdict 정합** | fp_cpu_science 불일치 | 백로그 |
| ◯ | **per-core / single_core 신호 점수 반영**(현재 additive만) — 단일스레드 채굴 | session | 백로그 |
| △ | ~~AI 호출 임계(OBSERVE) 확장~~ **보류** — ① 지속+다축 채굴은 category_gating이 30분~3h에 SUSPICIOUS로 올려 어차피 AI 호출됨 ② 자원 단일축 위장 채굴은 게이팅 미승격이나 AI도 못 가림(정상 고부하와 증거 동일)+정상작업마다 호출해 비용 폭증. → 호출 확대 대신 위 'AI 강등권' 우선 | 본 세션 결정 | 보류 |
| △ | mining_pool **정밀 IOC** 재도입(prefix 금지, 정확 IP+FP게이트) | INC-001 / design §3 | 보류 |

## B. 클라이언트 신뢰성 (가용성)

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ★ | **수집/전송 분리**(비동기) — 동기 루프라 전송 stall이 수집을 동결 | NCP 보고 갭(02:39~02:42, xmrig 유실) | 백로그 |
| ★ | **send 타임아웃** — 블로킹 전송 방지(빠른 실패→큐) | 동상 | 백로그 |
| ★ | **영속 큐**(`queue_path`) — 현재 in-memory라 stall 시 영구 유실 | 동상 | 백로그 |
| ◯ | **워치독** — 에이전트 프로세스 가용성 감시(무력화 대비) | 동상 | 백로그 |
| ◯ | **보고 갭 탐지** — 침묵(특히 직전 부하 후) 자체를 의심 신호로 | 회피형 채굴/agent kill | 백로그 |
| ◯ | **수집 결손 상시화(signal_quality=PARTIAL)** — 운영 실데이터(PC-01)가 gpu `tensor_core_unavailable` + network `connection_list_truncated`로 상시 PARTIAL. 수집 완전성 점검 | 본 세션 NCP 확인 | 백로그 |

## C. 운영 / 보안 (NIST)

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ★ | **인프라 allowlist + `rada_client.exe` 화이트리스트** — 자기 서버 IP/포트·에이전트 known-good | INC FP-OPS-1 / design §4-9 | 설계 |
| ◯ | **NCP 실 AI 활성화 결정** — 현재 mock(디스앰비규에이션 無, 비용 0) ↔ 실 AI(비용) | NCP is_mock=t | 결정 필요 |
| ◯ | **`pc_info.workload_context` 컬럼 + Flyway** | design §6-2 | 별도 승인 |
| ◯ | client에 **Authenticode signer 수집**(trusted_app Phase B 전제) | design §4-6 | 백로그 |
| ◯ | **DB 자격증명 정기 회전** | 보안 하드닝 | 대기 |
| ◯ | **가이드 §5 버그 수정** — AI 토글 `python -c set_ai_enabled`는 무효(별도 프로세스). HTTP로 라이브 서버에 보내야 | session 발견 | 백로그 |
| ◯ | **NCP fast-path 실검증** — 프로덕션 클라이언트 연속보고 확인 후 xmrig 재현 | NCP는 보고 갭으로 미검증 | 백로그 |

## D. Grafana / 대시보드

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ◯ | **정상비율 표기 개선** — 분모(온라인 수) 표기 + "최근 30분" 라벨 + 온라인/이력 패널 분리 | PC-01 의심인데 100%(온라인 1대·EXFIL 30분 경과) | 백로그 |
| ◯ | **온라인 PC 수 패널** 강조 — "1/40 온라인"이 진짜 스토리 | NCP online_cnt=1 | 백로그 |
| ◯ | **PC 개별 드릴다운 + 통합 AI 패널** — 허니컴 클릭→PC상세(상태/자원·GPU·네트워크 시계열/점수추이·분해·risk vector/AI판단·신뢰도). 사양·필드매핑·실값 확정, 정상/위험 2버전 목업 완료. 산출물(대시보드 JSON) 미생성 | 본 세션 설계 완료 | 설계 |
| ★ | **운영자 피드백 루프** — Grafana 폼→Spring `/api/feedback`→`ai_feedback` 테이블. 정탐/오탐 라벨 수집→FP율 자동측정→retrieval 라벨 주입(비파괴)→제안형 튜닝→AI 강등권 근거. 자동 적용 ❌·제안형·하드신호 불변 | [operator_feedback_loop_design.md](../../analysis/operator_feedback_loop_design.md) | 설계 |

## E. 신중 검토 (양날)

| P | 항목 | 근거 |
|---|---|---|
| △ | **자동 대응**(격리/프로세스 종료) — CONFIRMED_MINING(하드) + operator 승인에 한해서만 | AI가 rada_client 격리 권고한 오발동 위험(FP-OPS-2) |

---

## 우선순위 요약 (★ 먼저)
1. **AI 디스앰비규에이션 + 프로파일**(A) — FP 핵심 해법, 실증 완료, 구현→검증→배포.
2. **AI 강등권 부여**(A) — 위 디스앰비규에이션을 *결과에 반영*. 현재 AI는 non-destructive라 8/8 구제가 표시뿐. 강등권(하드신호·네트워크 도메인 제외)이 있어야 진짜 FP 해소. ※ AI 호출 임계(OBSERVE) 확장은 보류(게이팅이 지속분 커버 + 단일축은 AI도 무력).
3. **클라이언트 수집/전송 분리 + 타임아웃 + 영속 큐**(B) — 탐지 신뢰성(갭=블라인드) 직결.
4. **인프라/에이전트 allowlist**(C) — 자기참조 FP 원천 차단.
5. **confirmed_sustained 강등 + EXFIL 분리**(A) — 탐지 정밀도.
