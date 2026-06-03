# sim_fleet.py — 가상 PC 플릿 시뮬레이터 (로컬 데모/검증 전용)

실제 클라이언트가 없는 PC 들을 대신해 자원 메트릭을 **지속 전송**한다.
대부분 정상(NORMAL), 지정한 일부는 위험 상태가 되도록 패턴을 보낸다.

> ⚠️ **로컬/데모 전용**. NCP(운영)에는 절대 사용하지 말 것.

---

## 0. 왜 "지속" 전송인가 (일시 전송 금지)

verdict 는 **최근 5건 이동평균** + 게이팅의 **지속시간(sustained)** 에 의존한다
(`docs/00_시스템_탐지_점수체계.md` §2). 한 번 보내고 끝내면 위험 상태가 형성·유지되지
않는다. 그래서 `--interval`(기본 5초, 실제 클라이언트와 동일)마다 **계속** 보낸다.
스크립트를 멈추면(`Ctrl+C`) 해당 PC 는 보고가 끊겨 곧 오프라인으로 보인다.

## 1. 실제 탐지에 영향 없음 (설계)

- 시뮬 PC 는 **고유 pc_id** → ML 은 pc_id 별 독립 history 라 **실제 PC 의 verdict/score
  를 바꾸지 않는다.**
- 유일한 cross-PC 경로는 `GLOBAL_HW_DEGRADATION`(전체 PC 중 고CPU 비율 집계).
  이는 **alert-only**(severity 불변, P0-2)이고, 정상 PC 를 저부하(CPU~15%)로 두고
  위험을 **소수**로 유지하면 비율이 임계 밑이라 실제 PC 에 노이즈조차 안 붙는다.
- retrieval/peer 비교는 **비점수 layer** 라 무해.
- 결론: **정상 다수 + 위험 소수** 원칙만 지키면 실제 탐지 영향 0.

## 2. 사전 준비 — 키 발급 (1회)

`RADA-deploy/keys.csv` 는 **다른 환경(다른 pepper)용**이라 로컬 Spring 인증이 안 된다
(검증됨: 401). 로컬 DB 에 시뮬 PC 키를 **새로 발급**해야 한다. 실제 PC(예: PC-01~10)는
건드리지 않도록 **시뮬 범위만** 발급한다.

```bash
# (1) 시뮬 대상 PC 목록 CSV 작성 (pc_id 헤더 필수)
printf "pc_id\n" > sim_pcs.csv
for n in $(seq 11 40); do printf "PC-%02d\n" $n >> sim_pcs.csv; done

# (2) 로컬 DB 에 발급 (실제 PC-01~10 미접촉). 출력 경로는 명시적으로.
python tools/provision_pcs.py \
    --input sim_pcs.csv \
    --output sim_keys.csv \
    --db-url "postgresql://rada:rada_dev_pw@localhost:25432/pc_monitor" \
    --pepper dev_pepper_change_me --yes
```
> 로컬 postgres 는 host 포트 **25432**(컨테이너 5432). pepper 는 로컬 `.env` 의
> `API_KEY_PEPPER`(기본 `dev_pepper_change_me`)와 **반드시 일치**해야 인증된다.
> 출력 `sim_keys.csv` 는 raw 키 포함 → 데모 후 삭제 권장.

## 3. 실행

```bash
# 정상 다수 + 위험 소수 (위험도/패턴 지정)
python tools/sim_fleet.py \
    --keys sim_keys.csv \
    --pcs PC-11..PC-40 \
    --danger PC-13:miner PC-20:gpu_stealth PC-27:cpu_miner

# 검증용: 한 라운드만 / 페이로드만 보기
python tools/sim_fleet.py --keys sim_keys.csv --pcs PC-11..PC-12 --once
python tools/sim_fleet.py --pcs PC-11 --danger PC-11:miner --dry-run --once   # 키 불필요
```

| 옵션 | 설명 |
|---|---|
| `--keys` | keys.csv 경로 (pc_id,raw_key,...). 로컬 발급본 사용 |
| `--pcs` | 대상: `PC-11..PC-40`(범위) 또는 `PC-11,PC-12`(목록) |
| `--danger PC:scenario` | 위험 PC 지정(여러 개). 미지정 PC 는 전부 normal |
| `--interval` | 전송 주기 초(기본 5) |
| `--once` | 한 라운드만 |
| `--dry-run` | 전송 안 하고 대상/샘플 페이로드만 출력(키 불필요) |
| `--url` | 기본 `http://localhost:8080/api/metrics` |

## 4. 시나리오와 **실측 verdict** (로컬 ML 16라운드 보정)

총 20개 시나리오. 점수체계가 FP 억제로 보수적이라 패턴별 결과가 다르다 — 이게
"다양한 패턴을 올바르게 구분하는가" 의 검증 포인트다. 진입경로·risk_vector·alert·
severity 가 모두 갈린다.

### 4-1. 위험(MEDIUM↑ — Grafana 에 위험/의심으로 표시·저장)

| scenario | verdict | sev | risk_vector | 경로 | 대표 alert | 패턴 |
|---|---|---|---|---|---|---|
| `miner` | **HIGH_RISK** | HIGH | MINING | **fast-path** | CONFIRMED_MINING, PROCESS_PERSISTENT | xmrig CPU 채굴 |
| `miner_gpu` | **HIGH_RISK** | HIGH | MINING | **fast-path** | CONFIRMED_MINING | t-rex GPU 채굴 |
| `aging` | **HIGH_RISK** | HIGH | **AGING** | 점수(스텔스) | HIGH_RISK_STEALTH | 전력·VRAM 모순+고온(하드웨어 이상) |
| `gpu_stealth` | SUSPICIOUS | MEDIUM | MINING | 점수+게이팅 | SUSPICIOUS_GPU_MINING | GPU 고정고부하+CPU낮음 |
| `gpu_cpu_both` | SUSPICIOUS | MEDIUM | MINING | 점수+게이팅 | SUSPICIOUS_GPU_MINING | CPU·GPU 동시 고부하 |
| `gpu_cpu_heavy` | SUSPICIOUS | MEDIUM | MINING | 점수+게이팅 | SUSPICIOUS_GPU_MINING | GPU+CPU 둘 다 강함 |
| `vram_miner` | SUSPICIOUS | MEDIUM | MINING | 점수+게이팅 | SUSPICIOUS_GPU_MINING | GPU flat+VRAM낮음+전력안정 |
| `cpu_miner` | SUSPICIOUS | MEDIUM | THREAT | 점수+게이팅 | SUSPICIOUS_CPU_MINING | CPU flat+미상 프로세스 |
| `temp_dropper` | SUSPICIOUS | MEDIUM | THREAT | 점수+게이팅 | SUSPICIOUS_CPU_MINING | 임시폴더 실행 고부하 |

### 4-2. 관찰(OBSERVE — 신호·risk_vector 뜨나 저장/표시 안 됨)

| scenario | verdict | risk_vector | alert | 패턴 |
|---|---|---|---|---|
| `runaway` | OBSERVE | **MALFUNCTION** | OBSERVE_CPU_MINING | 고부하인데 진척 없음(stuck loop) |
| `stealth_power` | OBSERVE | THREAT | OBSERVE_STEALTH | 전력↑인데 GPU부하↓ 모순 |
| `stealth_vram` | OBSERVE | NORMAL | OBSERVE_STEALTH | VRAM↑인데 GPU부하↓ 모순 |

### 4-3. 정상 판정(의도적 억제 — "과탐 안 함" 시연)

| scenario | verdict | 비고 |
|---|---|---|
| `cpu_single_core` | NORMAL | 단일코어 99%지만 전체 낮음 → legacy 점수 미반영. **risk_vector 만 THREAT** 표기(additive 층 가치 시연) |
| `appdata_beacon` | NORMAL | AppData+outbound → 정상 동기화와 구분 불가, 억제 |
| `mem_leak` | NORMAL | 메모리 96%+CPU낮음 → 보안위협 아님(유지보수 신호) |
| `exfil` / `dos` / `port_scan` / `netabuse` | NORMAL | 네트워크 단독 → 캡/게이팅 억제(backdoor·볼류메트릭 FP 제거 설계) |

> **다양성 요약**: 진입경로(fast-path vs 점수+게이팅), severity(HIGH/MEDIUM/LOW),
> risk_vector(**MINING/THREAT/AGING/MALFUNCTION**), alert 종류(CONFIRMED/GPU/CPU/
> STEALTH)가 모두 갈린다. 억제 시나리오는 **정상 사용을 위험으로 오탐하지 않는지**
> 확인 용도. Grafana 위험 표시는 **§4-1(HIGH/MEDIUM)** 만 (LOW/OBSERVE/NORMAL 은 미저장).

### 4-4. 엣지케이스(탐지 경계·FP 회피 — "위험으로 안 뜨는 게 정답")

채굴/위협처럼 *보이지만* 정상이거나, 수집 실패·임계 경계인 상황. 대부분 NORMAL/
OBSERVE 로 **올바르게 억제**되어야 한다. 시스템이 과탐하지 않는지 검증하는 용도.

| scenario | 결과 | 검증 포인트 |
|---|---|---|
| `edge_gaming` | NORMAL | 게임 GPU 96% → 정황 감점(×0.4) 억제 |
| `edge_compiling` | NORMAL | 빌드 CPU 97% → 감점(×0.5) 억제 |
| `edge_ml_training` | NORMAL | ML 학습(텐서활성+VRAM높음+CPU사용) → 채굴과 구분 |
| `edge_wl_highcpu` | OBSERVE | 화이트리스트 IDE 96% → unknown_process 면제(단 raw CPU 점수는 남음) |
| `edge_gpu_missing` | NORMAL | GPU 수집 실패 → 거짓 GPU 신호 0 |
| `edge_net_missing` | OBSERVE | net 수집 실패 → `signals_missing=['network']` ('측정 불가' 표기) |
| `edge_truncated` | NORMAL | 외부연결 truncated → network 점수 0(가시성 저하) |
| `edge_flapping` | NORMAL | CPU 40↔96 요동 → cpu_flat 미발화(불안정 ≠ 채굴) |
| `edge_dos_floor` | NORMAL | inbound 95MB(절대 floor 100 미만) → dos 미발화 |
| `edge_cap_exempt` | NORMAL | network+single_core(캡 면제) — 캡 적용 안 됨 확인 |
| `edge_idle` | NORMAL | 완전 유휴 baseline |

> 엣지케이스는 **Grafana 에 위험으로 안 뜸**(정답). 검증은 `/analyze` 응답이나 ML
> 로그에서 "왜 안 떴는지"(감점·면제·measurement 불가)를 확인한다. edge_wl_highcpu /
> edge_net_missing 만 OBSERVE(LOW, 미저장)로 약하게 뜬다.

### 4-5. ⚠️ 레드팀: 발견된 실제 오탐(adversarial FP)

**정상 활동인데 위험으로 오분류된 시나리오** (작정하고 공략한 결과). fast-path 없음.
**8개 중 4개가 MEDIUM+ 오탐** = 저장·알림되는 거짓 위험.

| scenario (정상 활동) | 결과 | 근본 원인 |
|---|---|---|
| `fp_gpu_compute` (BOINC 분산컴퓨팅) | **SUSPICIOUS/MINING** ★ | GPU flat+VRAM낮음+텐서0 = 채굴 시그니처 동일 |
| `fp_render_both` (V-Ray 3D 렌더) | **SUSPICIOUS/MINING** ★ | CPU+GPU 동시 flat 고부하 |
| `fp_cpu_science` (MATLAB 야간 연산) | **SUSPICIOUS** ★ | CPU flat 97% (risk_vector 는 NORMAL — 층 불일치) |
| `fp_video_encode` (OBS 스트리밍) | **SUSPICIOUS/MINING** ★ | GPU 인코더 flat+VRAM낮음 |
| `fp_vram_hog` (VRAM 가득, 정상) | OBSERVE | stealth_mismatch_vram 오인(미저장) |
| `fp_power_idle` (GPU idle 고전력) | OBSERVE | stealth_mismatch_power 오인(미저장) |
| `fp_appdata_upload` (Teams 업로드) | NORMAL | 네트워크 억제로 안 속음 |
| `fp_backup_burst` (백업 버스트) | NORMAL | spike 평균 흡수로 안 속음 |

**핵심 결론 — 오탐률은 0이 아니다.**
- 채굴 탐지가 **자원 시그니처**(flat 고부하/VRAM낮음/텐서0)에 의존 → **정상 고부하
  연산(과학계산·렌더·인코딩)이 동일 시그니처**라 구분 불가.
- 화이트리스트(blender/ffmpeg 등)는 일부만 커버. BOINC/V-Ray/MATLAB/OBS/Octane
  등 정상 연산 앱이 누락되면 즉시 채굴로 오탐.
- ⚠️ **배포처가 연구실(60-808)** — GPU 과학연산·렌더·시뮬이 일상 → **실환경에서
  이 오탐이 빈발할 위험**. 합성이 아니라 현실 시나리오.

**완화 방향(후속 과제)**:
1. 화이트리스트를 연구실 실사용 앱으로 확장(서명/경로 기반, Program Files 신뢰).
2. SUSPICIOUS(자원 단독) 진입에 **프로세스 확정 근거** 요구(현재 HIGH fast-path 만 적용).
3. tensor/VRAM/디스크·네트워크 동반 패턴으로 "연산 목적" 구분(ML 학습은 텐서로 이미 구분됨 → 채굴/일반연산도 추가 특징 필요).
4. risk_vector 층과 legacy verdict 불일치(`fp_cpu_science`) 정합화.

## 5. 비용 주의 (AI)

위험 PC 는 매 라운드 MEDIUM↑ → ML 이 **AI(Claude) 호출**한다. 실제 Claude 가 켜져
있으면 위험 PC 수 × (라운드마다) 비용이 든다. 데모 중에는 **AI 를 끄는 것**을 권장:

```bash
curl -X POST http://localhost:8000/admin/agent-enabled -H "Content-Type: application/json" -d '{"enabled": false}'
```
끄면 mock 판정(비용 0)으로 동작하며, 판단 멘트는 `docs/00_시스템_탐지_점수체계.md` §4-4 와 동일.

## 6. 종료·정리

- `Ctrl+C` 로 중지(해당 PC 들은 곧 오프라인 표시).
- 데모 후 `sim_keys.csv` 삭제(raw 키 포함).
- 로컬 DB 의 시뮬 anomaly 정리(선택):
  `docker exec rada-postgres psql -U rada -d pc_monitor -c "DELETE FROM pc_monitor.anomaly_history WHERE pc_id LIKE 'PC-1%' OR pc_id LIKE 'PC-2%' OR pc_id LIKE 'PC-3%';"`
