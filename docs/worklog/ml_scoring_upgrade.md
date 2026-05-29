# ML 스코어링 업그레이드 작업 기록

> 작성일: 2026-05-28
> 상태: **진행 중** (Phase 1 진행, 미커밋)
> 커밋 정책: **ML 전체 Phase 완료 시 일괄 커밋** (중간 단계는 본 문서로만 기록)

## 1. 배경

두 건의 외부 분석(스코어링 정책 분석 / 테스트 밀도 분석)을 코드와 대조 검증한 결과,
다음 두 가지가 사실로 확인됨.

1. **verdict 분류가 "채굴 여부"에 치우쳐 있음** — 동일 신호로 *얼마나 비정상인가*는
   판단하지만 *어떤 종류의 이상인가*(오작동/노후화/보안위협)는 표현하지 못함.
2. **YAML ↔ 코드 점수 불일치** — `scoring_policy.yaml` 의 일부 correlation 점수가
   코드의 하드코딩 값과 달랐음. **검증된 FP=0 baseline 은 코드의 하드코딩 값
   (5/6/8 등)에서 측정**되었으므로, YAML 의 "2" 는 실제로 적용된 적이 없었음.

### 핵심 원칙 (사용자 지시)
> "성능 좋다고 확정나기 전까진 위험성을 고려하여 추가 필드방식으로 검증"
> "마치 fork 하듯 같은 시그널을 재사용해서 해석 레이어를 하나 더 얹어서 검증 후 교체"

→ 기존 verdict/final 경로는 **절대 변경하지 않고**, 동일 신호를 재사용하는
**additive(병렬 fork) 해석 레이어**를 추가하여 프로덕션에서 검증한 뒤 교체 여부 결정.

## 2. Phase 구분

| Phase | 범위 | 재배포 | 상태 |
|-------|------|--------|------|
| Phase 1 | 서버 전용 (#2 stub 표기, #4 verdict 분리, #5 신호품질 등급, #7 DOS/episode 축 분리, #8 retrieval→설명신뢰도) | 불필요 | **완료** (#2·#4·#5·#7·#8) |
| Phase 2 | 페이로드 강화 (#3 PID 귀속 + per-core, #6 process_recreation) | 불필요(클라이언트 미배포) | **완료** |
| Phase 3 | 최종 exe 빌드 + 첫 배포, #9 격리 miner 검증 trace | 배포 | 대기 |

> Phase 1·2 전 항목 완료. 전체 테스트 **457 passed**. 모든 신규 레이어/신호는
> additive 이며 legacy verdict/final 경로는 불변. 미커밋 상태.

## 3. Phase 1 #4 — verdict taxonomy (additive risk_vector) ✅ 완료

### 신규 파일: `ml_server/scorer/risk_vector.py`
동일 `signals` 를 4개 위험 축으로 재투영하는 순수 함수.

- **축**: `mining` / `malfunction` / `aging` / `threat`
- **가중치 테이블** (튜닝 용이하게 명시적 dict):
  - `_MINING`: gpu_flat 3, cpu_flat 3, vram_low 2, power_stable 1, sm_high 1,
    mining_pool_ip 5, known_miner 5, mining_process_or_pool 4, persistent_miner 3
  - `_MALFUNCTION`: dos_spike 3, mem_critical 2
  - `_AGING`: stealth_mismatch_power 3, stealth_mismatch_vram 3, mem_critical 1, mem_high 1
  - `_THREAT`: persistent_ext 2, net_external_high 1, outbound_spike 3,
    exec_path_suspicious 1, appdata_exec 1, temp_exec 1, new_remote_ip_burst 1, mining_pool_ip 2
- **조합 보너스** `_combo()`:
  - cpu_flat & gpu_flat → mining +2
  - gpu_flat & power_stable & vram_low → mining +2
  - unknown_process_active & net_out_sustained → threat +3
  - appdata_exec & net_out_sustained → threat +2
  - disk_write_net_out_sustained → threat +2
  - cpu_high & (net/disk/miner 無) → malfunction +2 (멈춘 루프 proxy)
- **primary_type**: 최고 점수 축이 `_PRIMARY_FLOOR = 4` 이상이면 해당 라벨, 아니면 NORMAL
- 반환: `{mining, malfunction, aging, threat, primary_type}`

### 와이어링: `ml_server/api/analyze_router.py`
AI Agent 블록 직전에 additive 블록 삽입. `scores.risk_vector` 로 부착.
**전체 try/except 로 감싸 fail-open** — 해석 레이어 실패가 메인 경로를 절대 깨지 않음.

```python
try:
    from ..scorer.risk_vector import compute_risk_vector
    rv = compute_risk_vector(pattern_result.get("signals", {}),
                             pattern_result.get("scores", {}))
    scores_block = pattern_result.get("scores")
    if isinstance(scores_block, dict):
        scores_block["risk_vector"] = rv
except Exception:
    pass  # additive layer must never break the main path
```

### 테스트: `tests/unit/test_risk_vector.py` (6건)
all_quiet→NORMAL / GPU·CPU flat→MINING / known_miner→mining≥9 /
unknown-proc+outbound→THREAT / stealth mismatch→AGING / 단일 약신호→NORMAL(floor 미달).

### 검증 결과
- `tests/unit/test_risk_vector.py` + `tests/integration/test_sustained_scenarios.py`: **12 passed**
- 전체 스위트: **428 passed** (기존 422 + 신규 6). 기존 verdict/final 경로 불변 확인.

## 4. YAML ↔ 코드 정합화 (비파괴)

- `ml_server/scorer/indicator_calculator.py`: correlation 점수를
  `get_scoring_policy().scores` 에서 읽도록 변경. default 는 검증값과 동일.
  - cpu_plus_net 2, disk_write_net_out 5, unknown_proc_net 5, appdata_net 6,
    mining_known 10, mining_pool_only 8
- `ml_server/config_yaml/scoring_policy.yaml`: 위 값들을 **검증된 실제 값**으로 정정,
  과거 "2 로 약화" 주석이 코드에 적용된 적 없었음을 명시. 낮추려면 반드시
  `tests/integration/test_sustained_scenarios.py` 재실행으로 FP 재검증.

## 5. sustained 시나리오 재현 하베스(검증 인프라)

- `tests/integration/scenario_replay.py`: timestamp 기반 minute aggregation 을 이용해
  30~180분 시계열을 수 초 안에 재현. 22키 스키마 유효 snapshot 생성.
- `tests/integration/test_sustained_scenarios.py`: 6 시나리오
  - 음성(승격 금지): normal_idle, game_render, network_load_only → NORMAL
  - 양성: known_miner → HIGH_RISK, cpu/gpu_mining_sustained → SUSPICIOUS+

## 6. Phase 1 #2 — stub 패턴 명시적 상태 노출 ✅ 완료

### 문제
보류 패턴(R6/R9/N1/N6/S2/S5)은 `enabled:false` 일 때 `_t()` 가 None 을 반환해
기존 `detail["R6_stubbed"]=True` 마킹은 **죽은 코드**였음. 더 위험한 것은 누군가
stub 을 `enabled:true` 로 켜면 **조용히 미평가**되어 운영자가 "켰으니 작동하겠지"
착각할 수 있다는 점.

### 변경: `ml_server/scorer/pattern_categories.py`
- 모듈 상수 `_STUB_PATTERNS` (보류 6항목) + 헬퍼 `_collect_stub_status(group_cfg)`
  → 각 stub 의 `{implemented: False, enabled: bool}` 산출.
- 각 evaluator 끝에서 `detail["stub_status"]` 로 노출 (산발적 `*_stubbed` 마킹 제거).

### 변경: `ml_server/api/analyze_router.py`
- 3개 그룹 stub_status 병합 → `category_signals.stub_patterns` 노출.
- `enabled:true && implemented:false` 항목을 `category_signals.enabled_but_unimplemented`
  리스트로 별도 노출 (운영자 경고용). fail-open fallback 에도 동일 키 추가.

### 테스트: `tests/unit/test_pattern_categories.py` (신규 3건)
disabled→implemented:false/enabled:false / enabled_but_unimplemented 노출 +
실제 미평가 / `_STUB_PATTERNS` 완전성. **25 passed.**

## 7. Phase 1 #5 — 신호 품질 등급 ✅ 완료

### 배경
signal_extractor 는 이미 수집 실패/저하를 표시(signals_missing, gpu_metrics_missing_reason,
external_connection_count_truncated, gpu_partial_failure_reasons)하지만, 이를 **출처별
신뢰도 등급**으로 종합해 노출하지 않았음. "신호 0/False" 가 *진짜 정상* 인지
*측정 불가* 인지 구분 못 함.

### 신규 파일: `ml_server/scorer/signal_quality.py`
- `compute_signal_quality(sig_pack)` 순수 함수 → 출처별(network/process/gpu/derived)
  등급 `FULL`/`PARTIAL`/`MISSING` + `overall`(최저 등급) + `degraded_sources` + `reasons`.
- network: 전체 결손→MISSING, truncated→PARTIAL. gpu: missing_reason→MISSING,
  partial_failure→PARTIAL.

### 와이어링
- `verdict_classifier.analyze_pattern` return 에 `signal_quality` 추가
  (`_safe_signal_quality` 로 fail-open). `analyze_router` 응답 top-level 노출.

### 테스트: `tests/unit/test_signal_quality.py` (신규 6건). **통과.**

## 8. Phase 1 #7 — DOS/episode 신호 risk 축 분리 ✅ 완료

### 변경: `ml_server/scorer/risk_vector.py`
legacy 의 단일 "episode" 점수(dos_spike + persistent_ext)를 의미에 맞는 축으로 분리.
- `dos_spike`(inbound 폭주)는 이 PC 오작동이 아니라 **표적/네트워크 보안 이벤트** →
  `_MALFUNCTION` 에서 제거하고 `_THREAT` 로 이동(weight 2).
- malfunction 축은 "고부하인데 진척 없음(runaway/stuck)" 에 집중(mem_critical + cpu_high combo).
- combo 추가: `dos_spike & persistent_ext → threat +2`.

### 테스트: `tests/unit/test_risk_vector.py` (신규 3건)
dos→threat(malfunction 0) / dos+persistent→THREAT_SUSPICION / mem_critical→malfunction 유지.

## 9. Phase 1 #8 — 설명 신뢰도(explanation_confidence) ✅ 완료

### 신규 파일: `ml_server/scorer/explanation_confidence.py`
verdict 가 *얼마나 비정상인가* 라면, 이것은 "*얼마나 자신있게 설명 가능한가*".
- `compute_explanation_confidence(retrieval_evidence, signal_quality)` →
  `{level: HIGH/MEDIUM/LOW, score 0~5, reasons, inputs}`.
- signal_quality=MISSING → LOW 고정. retrieval 유사사례/peer_mismatch/peer 비교 가능 →
  가산, novelty/retrieval 미가용 → 감산.

### 와이어링
- `analyze_router` 에서 risk_vector 블록 직후 결합(`pattern_result["explanation_confidence"]`),
  응답 top-level 노출. additive try/except.

### 테스트: `tests/unit/test_explanation_confidence.py` (신규 6건). **통과.**

## 10. Agent prompt 갱신 ✅ 완료

`ml_server/agent/claude_api_agent.py:build_prompt` 에 Phase 1 해석 레이어 노출:
- `[위험 벡터 해석]` primary_type + 4축 점수
- `[신호 품질]` overall != FULL 일 때만 degraded_sources 와 "0/False=측정불가" 경고
- `[설명 신뢰도]` level + score + reasons

모두 가드(`isinstance`) 처리 — 필드 없으면 prompt 에서 생략. 446 passed.

## 11. Phase 2 — 페이로드 강화 ✅ 완료

**원칙**: Phase 1 과 동일하게, 새로 수집한 데이터에서 파생되는 신호는 모두
**ADDITIVE** — signals dict + risk_vector 에만 반영하고 **legacy indicator/verdict
점수에는 넣지 않는다**. 22키 top-level 계약 불변(sub-dict 확장만).

### #3 — PID 귀속 (연결↔프로세스 소유)
- **갭**: `network.py` 가 연결별 pid 를 수집하면서도 전송용 capped 에서 버려,
  외부 연결의 소유 프로세스를 서버가 알 수 없었음. 저-CPU 백도어/채굴은
  top_processes(상위 10 CPU)에도 안 잡혀 완전히 invisible.
- **클라이언트** `client_core/collector/network.py`: capped external_connections 에
  `pid` + `proc_name` + `proc_path` 부착(`_resolve_owner`, ≤CAP best-effort,
  권한/소멸 예외 흡수). cmdline/hash 는 프라이버시·권한 이유로 **보류**(사용자 제약).
- **서버** `signal_extractor.py`: 신규 신호 `external_conn_suspicious_owner`
  (소유 경로가 appdata/temp 이고 비-whitelist). network 결손 시 False 잠금.
- **risk_vector**: threat +3, combo(`+ net_out_sustained` → threat +2).

### #3 — per-core CPU (single-core-pegged 채굴)
- **클라이언트** `cpu_mem.py`: percpu prime → 1s aggregate → percpu 측정으로
  동일 윈도우 per-core 확보. `per_core_cpu_percent` + `single_core_max_percent`.
  `orchestrator` derived_features 에 노출(18→20키).
- **서버**: 신규 신호 `single_core_full`(한 코어 ≥90% 인데 전체 CPU 가 ~1코어
  분량 이하). cpu_core_count 로 적응적 임계.
- **risk_vector**: mining +3, combo(`+ cpu_flat` → mining +1).

### #6 — process_recreation (PID churn)
- **서버** `signal_extractor._detect_process_recreation`: history 의 top_processes 에서
  동일 (name,path) 가 동시 인스턴스 ≤2 인데 PID 가 3+ 회 바뀌며 재등장 →
  watchdog 식 재생성. multi-process 앱(chrome 등) FP 회피 위해 concurrent_max 제한.
  process 결손 시 False 잠금.
- **risk_vector**: threat +2.

### Agent prompt
- `build_prompt` 에 `[외부 연결 소유 프로세스]` 블록 추가(ip:port ← proc_name path).
  신규 signals 는 active_signals, risk_vector 로 이미 노출.

### 테스트
- `tests/unit/test_phase2_signals.py` (신규 11건): 3개 신호 발화/미발화 + risk_vector 재투영 + 회귀.
- `tests/unit/test_network_unique_cap.py`: capped owner 부착 1건 추가.
- `tests/integration/test_orchestrator_derived.py`: 18→20키로 갱신.
- 전체 **457 passed**.

### 보류 (사용자 제약 "권한요구/불편 유발 제외")
- cmdline / exe hash / digital signature 수집은 프라이버시·권한 부담으로 미수집.
  ppid / parent_name 은 이미 수집 중(부분 프로세스 트리 가용).

## 12. Phase 3 — 배포 준비 ✅ (격리 miner #9 직전까지)

### exe 재빌드
- Phase 2 가 client collector(network/cpu_mem/orchestrator)를 바꿨으므로 재빌드 필수.
- `client_core/__init__.py` `__version__` 9.0.0 → **9.1.0** (payload 식별).
- `pyinstaller rada_client.spec --noconfirm --clean` → `dist/rada_client.exe`
  (~23 MB, 빌드 성공).

### 파이프라인 검증 (client → Spring → ML 전 구간)
1. **frozen exe 스모크**: 11s 구동, 1+ collection cycle 통과 (신규 network owner
   해석 + per-core 코드 frozen 환경에서 import/런타임 오류 없음).
2. **live e2e**: APPDATA `config.yaml`(mode=springboot, 등록 api_key)에 따라
   production Spring Boot(`223.130.154.165:8080`)로 실제 전송 — 가이드 "본인 PC
   시범 설치" 단계. 본인 PC pc_id 로 1~2 건 실제 송신됨.
3. **Spring DTO 호환**: `externalConnections: List<Map<String,Object>>` 가 신규
   sub-key(pid/proc_name/proc_path) 수용, `@JsonAnySetter extra` 가
   derived_features(per_core 포함) 보존 → **Jackson 미지필드 거부 없음**.
4. **Spring→ML forward 보존**: `MlForwardService.forward` 가 `.bodyValue(req)`,
   `@JsonAnyGetter getExtra()` 가 derived_features 를 top-level 로 재직렬화 →
   ML 의 Pydantic `derived_features` 로 수신. **Spring 코드 무변경, 재배포 불필요.**
5. **ML e2e** (`tests/integration/test_phase2_payload_e2e.py`): 신규 페이로드가
   `/analyze` 통과 + risk_vector/signal_quality/explanation_confidence 노출 +
   external_conn_suspicious_owner→threat, single_core_full→mining 재투영 확인.
   구버전(신규필드 없음) 페이로드 하위호환도 확인. 전체 **460 passed**.

### 배포 범위
- 변경 산출물은 **클라이언트 exe 1개**. NCP 서버 스택(Spring/ML/DB/Grafana)은 무변경.
- 40 대 실습실 PC 롤아웃(install.bat + Task Scheduler, 마에스트로 case A)은
  물리 작업 — `docs/guides/client_deployment.md` 절차대로 신규 exe 재배포.

### 남은 작업 (#9 — 격리 miner 검증, 사용자 지시상 보류)
- 배포 후 실제/격리 miner 로 fast-path + behavior-only(stealth) 발화 trace 확보.
- 프로덕션에서 risk_vector / Phase 2 신호 검증 후 legacy verdict 교체 여부 판단.

## 13. AI Agent 정보 충분성 (사용자 질문 답)

직접 점수 산출은 안 해도, 차후 AI agent 정밀 판단을 위한 정보는
Phase 2 페이로드 강화(#3 PID 귀속, per-core CPU, exe 경로/서명 등)로 보강 예정.
현재도 risk_vector 4축 + signal_quality + explanation_confidence + active signals +
retrieval top-k 가 응답에 노출됨 (prompt 반영은 §10 다음 단계).

## 14. Pilot FP 튜닝 (2026-05-29, NCP 운영 데이터 기반)

NCP 파일럿(PC-01/02 본인 + PC-03 실습실)에서 anomaly 10건 수집. pc-smoke/
pc-stealth(채굴 검증 합성)는 정상 발화(HIGH/SUSPICIOUS) 확인. **PC-01/03 7건은
정상 데스크탑 사용(대용량 다운로드·클라우드 동기화·AppData 앱)이 SUSPICIOUS_EXFIL/
DOS 로 오탐**. final 은 옛 indicator 합(exfil/dos 등)에서 나오고 새 8-key breakdown
은 표시용임을 검증 후, 5개 서버-only 수정(전부 ml_server/, 재배포=git pull+ml 재빌드):

- **#4 retrieval를 final 점수에서 분리**: positive retrieval 이 약신호와 합쳐
  SUSPICIOUS 승격하던 FP 제거. 유사도는 explanation_confidence 로만. FP-safe.
- **#1 network-only 약신호 cap**: 네트워크 신호만 활성 + 자원/시스템/강한근거 無
  → verdict 최대 OBSERVE. known_miner/pool·PID귀속(external_conn_suspicious_owner)·
  single_core_full·process_recreation·채굴 자원패턴은 면제. pilot FP 재현
  시나리오(final=11 → capped OBSERVE) 회귀 테스트 추가.
- **#3 DOS 분리 + 임계 상향**: dos floor 20→100MB/5s·sustained 2→3(대용량 다운로드
  오탐 차단). risk_vector 에 `network_abuse` 축 신설, dos_spike 를 threat 에서 분리
  (primary_type=NETWORK_ABUSE).
- **#5 sustained gap-reset + cap**: sustained_minutes wall-clock 누적(offline 공백
  포함, pilot 4949분) 버그 → 120초 초과 공백 시 앵커 리셋 + 720분 cap. 채굴 5초
  연속 보고는 gap 無라 180분 게이팅 무영향.

검증: 전체 **470 passed**. 모든 수정은 채굴 탐지(known_miner HIGH, cpu/gpu
mining SUSPICIOUS+)를 깨지 않음을 sustained 시나리오로 확인.

### 남은 FP 후보 (차기)
- N2/N5 자체가 정상 장기연결에도 발화(network_abnormal 상시 true) → 패턴 정의
  강화 필요(현재는 #1 cap 으로 verdict 억제).
- exfil 강도를 PID 귀속(신규 v9.1.1 클라) 유무로 graded — 귀속 有면 상향 재허용.
- 운영 통계에서 테스트 pc_id(pc-smoke/pc-stealth) 분리 집계.
