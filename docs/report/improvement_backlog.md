# RADA 개선 Backlog (우선순위 단일 표)

> 메인 리포트(`README.md` §2)의 확장본. 이번 세션(AI 판단 개선·실증·운영 검증)에서
> 도출된 개선 항목을 **우선순위(★ 높음 / ◯ 중간 / △ 낮음·신중)** · 출처 · 상태로 정리.
> 새 항목/완료는 여기서 갱신.
>
> 최종 갱신: 2026-06-07

## A. 탐지 정확도

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ★ | **AI 디스앰비규에이션 + 환경 프로파일**(`workload_context`) — 정상 고부하 연산 ↔ 채굴 구분 | 레드팀 FP 8/8 구제 실증 | 로컬 구현(미배포) |
| ★ | **`confirmed_sustained` 하드 강등** — 행동게이팅 단독은 max SUSPICIOUS, HIGH는 정체성 증거 동반 시만 | 일주일 테스트 INC-005 / design §4-8 | 설계 확정 |
| ★ | **AI 호출 임계 확장** — 자원-의심 OBSERVE(고CPU 단일+비표준 경로+GPU미사용)도 AI 라우팅 | 익명화 xmrig: 엔진 OBSERVE인데 AI는 DANGEROUS로 잡음 | 설계 |
| ★ | **EXFIL 도메인 분리** — compute 프롬프트가 네트워크 FP를 오판(자기 모니터링 트래픽을 C2로) | INC FP-OPS-2 / design §4-9 | 설계 |
| ◯ | **trusted_app 레이어**(서명/경로, Phase A 표시 → B signer) | design §4-6 | 설계 |
| ◯ | **risk_vector ↔ legacy verdict 정합** | fp_cpu_science 불일치 | 백로그 |
| ◯ | **per-core / single_core 신호 점수 반영**(현재 additive만) — 단일스레드 채굴 | session | 백로그 |
| △ | mining_pool **정밀 IOC** 재도입(prefix 금지, 정확 IP+FP게이트) | INC-001 / design §3 | 보류 |

## B. 클라이언트 신뢰성 (가용성)

| P | 항목 | 출처/근거 | 상태 |
|---|---|---|---|
| ★ | **수집/전송 분리**(비동기) — 동기 루프라 전송 stall이 수집을 동결 | NCP 보고 갭(02:39~02:42, xmrig 유실) | 백로그 |
| ★ | **send 타임아웃** — 블로킹 전송 방지(빠른 실패→큐) | 동상 | 백로그 |
| ★ | **영속 큐**(`queue_path`) — 현재 in-memory라 stall 시 영구 유실 | 동상 | 백로그 |
| ◯ | **워치독** — 에이전트 프로세스 가용성 감시(무력화 대비) | 동상 | 백로그 |
| ◯ | **보고 갭 탐지** — 침묵(특히 직전 부하 후) 자체를 의심 신호로 | 회피형 채굴/agent kill | 백로그 |

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

## E. 신중 검토 (양날)

| P | 항목 | 근거 |
|---|---|---|
| △ | **자동 대응**(격리/프로세스 종료) — CONFIRMED_MINING(하드) + operator 승인에 한해서만 | AI가 rada_client 격리 권고한 오발동 위험(FP-OPS-2) |

---

## 우선순위 요약 (★ 먼저)
1. **AI 디스앰비규에이션 + 프로파일**(A) — FP 핵심 해법, 실증 완료, 구현→검증→배포.
2. **클라이언트 수집/전송 분리 + 타임아웃 + 영속 큐**(B) — 탐지 신뢰성(갭=블라인드) 직결.
3. **인프라/에이전트 allowlist**(C) — 자기참조 FP 원천 차단.
4. **confirmed_sustained 강등 + AI 임계 확장 + EXFIL 분리**(A) — 탐지 정밀도.
