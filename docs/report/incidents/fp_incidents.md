# FP 개선 장애 보고서 — P0 / P1 / P2 여정 (65.9% → 0%)

> 메인 리포트(`../README.md` §4)에서 분리. 필드 측정으로 발견한 **오탐(FP) 장애**를
> 단계별로 원인·영향(수치)·탐지·대응·재발방지로 기록. 출처는 `docs/analysis/
> fp_field_analysis_{v0.6, post_p1, post_p2, ncp}.md`.
>
> **요약**: 정상 사용 대비 anomaly 비율 **65.9% → 1.6%(P0+P1) → 0.0%(P2) → 0.000%(NCP)**.
> P2 측정은 P1보다 **부하가 더 무거웠음**(cpu_max 62.7→85.2%, mem_max 78.1→87.5%) —
> "사용 안 해서 0"이 아니라 "알고리즘이 제대로라서 0".

---

## P0 — 구조적 오탐원 (3건) · `fp_field_analysis_v0.6.md`

### FP-P0-1 · 약신호(LOW/OBSERVE)가 anomaly_history 오염
- **원인**: LOW/OBSERVE(관찰) 신호까지 anomaly_history에 저장 → 약한 신호가 "이상"으로 집계.
- **영향**: 저장 테이블 오염, 대시보드 노이즈, 실제 위험 신호 희석.
- **탐지**: anomaly_history severity 분포 분석.
- **대응**: Spring 저장 필터 — **MEDIUM 이상만 persist**(LOW/OBSERVE skip). 커밋 `3e88ddb`.
- **재발방지**: 저장 기준 = 표시/알림 기준과 일치.

### FP-P0-2 · severity ↔ verdict 불일치 **707건**
- **원인**: alert의 severity가 engine verdict를 자체 override → 점수와 심각도 불일치.
- **영향(수치)**: **707건 불일치** — MEDIUM/NORMAL **404건**(final_score=0인데 저장),
  HIGH/OBSERVE **155건**(verdict OBSERVE인데 HIGH 승격), HIGH/NORMAL 3건.
- **탐지**: severity × verdict 교차 분포 쿼리.
- **대응**: **alert severity override 제거**, overall_severity = engine verdict로 고정. 커밋 `b571a31`.
- **재발방지**: 단일 진실원(engine verdict)에서만 severity 산출.

### FP-P0-3 · 단일 신호로 MEDIUM 승격 **948/1314건(74%)**
- **원인**: alert 1개만으로 MEDIUM/HIGH 진입 → 단일 약신호 과민 승격.
- **영향(수치)**: MEDIUM의 **74%(948/1314)**가 alert 1개로 진입.
- **탐지**: alert_count 분포 정량화.
- **대응**: **promotion gating** — signal_count + category_count 동반 조건(MEDIUM≥3신호·2카테고리,
  HIGH≥4·2), fast-path(known_miner) 우회. evidence_meta로 근거 구조화. 커밋 `d979cdd`.
- **재발방지**: 회귀 테스트 + evidence_meta 노출.

---

## P1 — 잔여 FP 배치 (4건) · `fp_field_analysis_post_p1.md`

### FP-P1-1 · local alert가 verdict 결정에 혼입
- **원인**: 클라이언트 local_alerts가 alerts[]에 섞여 active_signal_count/verdict에 영향.
- **대응**: **local_evidence 분리** — alerts[]에서 빼고 감사용 evidence 블록으로만 보존(score=0). 커밋 `2d252ee`.

### FP-P1-2 · 정상 대용량 다운로드 → DOS 오탐 **80배**
- **원인**: DOS를 평균 대비 비율로만 판정 → baseline 0.03MB일 때 2.5MB도 **80배**가 되어
  정상 download burst가 DOS로 발화(pilot PC-01 실측 **42·108 MB/5s**).
- **대응**: **절대값 floor 추가**(20→**100 MB/5s**) + **연속 3회** 조건. 실효 차단은 network-only cap. 커밋 `2d252ee`, FP-fix #3.

### FP-P1-3 · episode 점수 과누적 + 알람 중복
- **원인**: episode 점수가 decay 없이 누적, 동일 (pc,type) 알람 반복 저장.
- **대응**: **episode decay**(정상 0점 12회=1분 연속 시 누적 끊음) + **alert cooldown 60초**. 커밋 `2d252ee`.

### FP-P1-4 · retrieval 유사도가 점수를 끌어올림
- **원인**: 유사 HIGH/peer mismatch가 약한 단일 카테고리와 합쳐져 SUSPICIOUS 승격(gating으로도 못 막음).
- **대응**: **retrieval final score 기여 0 고정**(`retrieval_score_effective=0`). 유사도는 explanation_confidence로만. 커밋 `07402e7`, FP-fix #4.

---

## P2 — 미세 잔여 + 회귀 · `fp_field_analysis_post_p2.md`

### FP-P2-1 · SUSPICIOUS_BACKDOOR 오탐 **53/54건**
- **원인**: (persistent_ext + net_external_high)만으로 backdoor 판정 → 정상 dev/스트리밍/
  클라우드 동기화(Chrome/Discord/OneDrive/VS Code/게임런처)와 구분 불가.
- **영향(수치)**: Post-P0/P1 잔여 FP **54건 중 53건**이 SUSPICIOUS_BACKDOOR.
- **대응**: **backdoor_score = 0 고정**(verdict 승격 비활성). raw 신호는 evidence_meta에 보존. 커밋 `18bd252`.
- **재발방지**: 더 강한 evidence(cmdline/서명/PID-net 매핑) 도입 전까지 비활성.

### FP-P2-2 · network-only 약신호 SUSPICIOUS 승격
- **원인**: 네트워크 신호만으로 SUSPICIOUS 진입(PID 귀속 없는 EXFIL/DOS).
- **대응**: **network-only cap** — 자원/시스템·강한 프로세스 근거 없으면 OBSERVE로 캡. 커밋 `7c021ec`, FP-fix #1.

### FP-P2-3 · sustained 과누적 (offline/장기 정상)
- **원인**: PC offline 공백·장기 정상 연결을 sustained로 계속 누적(pilot **4949분**).
- **대응**: **gap reset**(120초 초과 공백 시 앵커 리셋) + **cap 720분(12h)**. 커밋 `312e1b6`, FP-fix #5.

**P2 효과**: 정상 4h12m 동안 anomaly **신규 0건**(P1 4h38m/54건 대비 100% 제거). 부하는 더 무거웠음.

---

## 운영(NCP) 최종 검증 · `fp_field_analysis_ncp.md`
- **정상 사용 7h39m → FP 0건(0.000%)**, mining 탐지(fast-path + stealth 행동) 즉시 발화.
- 단계 비교: Pre **65.9%** → P0+P1 **1.6%** → P2 **0.0%** → **NCP 0.000%**.

## 이후(이번 세션) — AI 층에서 드러난 FP
- mining_pool_ip prefix 오탐(메인 §4 INC-001), AI 탈앵커링으로 정상 고부하 연산 FP 8/8 구제,
  **장기 행동게이팅 FP(209분)** 발견 → `confirmed_sustained` 강등 설계.
  [`../../analysis/ai_judgment_disambiguation_design.md`]

---

## 운영 발견 (2026-06) — EXFIL 자기참조 FP + **AI 구제 실패**

### FP-OPS-1 · 모니터링 트래픽이 EXFIL로 오탐 (PC-01)
- **원인**: PC-01(개발/운영자 머신)이 **RADA 서버 자신(`223.130.154.165`)에 메트릭 전송
  (:8080)·Grafana 조회(:3000)·SSH(:22)** + 이메일(:995) + dev 작업(claude/chrome/python)
  중. 이 정상 트래픽이 `outbound_spike`/`persistent_ext`/`net_out_sustained` 등을 발화.
- **영향**: SUSPICIOUS_EXFIL(THREAT, final 9.0, process=0). **rada_client가 자기 메트릭을
  보내는 행위 자체가 "유출"로 잡힘**(자기참조 FP).
- **탐지**: NCP anomaly_history 검증 쿼리 — 연결 대상이 전부 자기 인프라/이메일, 프로세스
  전부 정상(process=0)임을 확인.
- **대응(설계)**: ① 인프라 IP/포트(서버 223.130.154.165:8080/3000/22) **known-good 컨텍스트**,
  ② `rada_client.exe` 화이트리스트, ③ network-only EXFIL은 캡/완화 대상.
- **재발방지**: 인프라 allowlist를 룰·AI 이전 단계에 둔다.

### FP-OPS-2 · **AI도 이 EXFIL FP를 구제 못 함 (위험한 오판)**
- **원인**: 위 PC-01 데이터를 실제 Claude에 질의 → **benign=False, DANGEROUS** 판정.
  *"단일 IP 다중포트(8080/3000/22)=C&C 의심, rada_client.exe(ProgramData)=비정상"* 으로
  오인하고 **"rada_client.exe·claude.exe 격리"** 권고(= 감시 에이전트 자체를 죽이라는 셈).
- **근본 원인**: ① 탈앵커링 프롬프트는 **compute-vs-mining 도메인 전용** — network-exfil엔
  부적합. ② AI가 `223.130.154.165`가 **자기 서버**인 걸 모름. ③ ProgramData 경로 편향.
- **교훈**: **AI 디스앰비규에이션은 도메인 특이적** — compute FP엔 강하나(8/8 구제),
  **network/인프라 자기참조 FP엔 무력하고 위험**. → **known-good 인프라/에이전트 컨텍스트가
  AI보다 우선**이어야 한다.
- **대응(설계)**: 인프라 allowlist(FP-OPS-1) + EXFIL 도메인 판단 분리 + 프롬프트에 자기
  인프라 컨텍스트 주입. [`../../analysis/ai_judgment_disambiguation_design.md` §4-9]
