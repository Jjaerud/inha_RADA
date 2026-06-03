# 개선 전 실험: 로컬 시뮬레이션 플릿 탐지 검증

작성일: 2026-06-02

## 1. 목적

본 문서는 대시보드 UI/UX 및 탐지 설명 개선을 진행하기 전, 현재 RADA 탐지 체계가
로컬 시뮬레이션 플릿에서 어떤 결과를 내는지 기록한 기준선이다.

검증 목표:

```text
1. 위험 PC가 실제로 MEDIUM/HIGH로 탐지되는지
2. fast-path는 1개만 유지하면서 다양한 non-fast-path 시나리오가 잡히는지
3. risk_vector가 MINING/THREAT/AGING/MALFUNCTION 등으로 다양하게 나오는지
4. 정상처럼 보이는 엣지케이스가 위험으로 과탐되지 않는지
5. 개선 전 대시보드/UI에서 어떤 관찰 한계가 있는지 확인
```

## 2. 실험 환경

실험은 전부 로컬 환경에서 수행했다.

```text
Spring Boot: localhost:8080
FastAPI ML: localhost:8000
PostgreSQL: localhost:25432
Grafana: localhost:3000
NCP 운영 서버: 무접촉
AI agent: 비활성화(mock, 비용 0)
```

시뮬레이션 도구:

```text
tools/sim_fleet.py
tools/SIM_FLEET_README.md
```

시뮬 PC:

```text
PC-11 ~ PC-40
30대 가상 PC
5초 주기 지속 전송
```

중요 전제:

```text
시뮬 PC는 고유 pc_id를 사용한다.
ML history는 pc_id별로 분리된다.
정상 다수 + 위험 소수 원칙을 유지해 global_hw 오탐을 피한다.
retrieval/peer 비교는 현재 점수 비반영 layer라 실제 PC 점수에 영향이 없다.
```

## 3. 1차 실험: 기본 위험 6대 검증

초기 배치는 30대 중 위험 6대를 지정했다.

| PC | 시나리오 | 실제 verdict | 의미 |
|---|---|---|---|
| PC-13 | `miner` | HIGH_RISK | 채굴 프로세스 fast-path |
| PC-17 | `miner_gpu` | HIGH_RISK | GPU 채굴 fast-path |
| PC-21 | `gpu_stealth` | SUSPICIOUS | GPU 고정 고부하 |
| PC-24 | `gpu_cpu_both` | SUSPICIOUS | CPU/GPU 동시 고부하 |
| PC-28 | `cpu_miner` | SUSPICIOUS | CPU 채굴형 패턴 |
| PC-32 | `temp_dropper` | SUSPICIOUS | 임시폴더 실행 위협 |

결과:

```text
HIGH_RISK 2대
SUSPICIOUS 4대
OBSERVE 2대(PC-36/39 stealth 계열, 미저장)
NORMAL 22대
```

의미:

```text
기본 위험 탐지는 정상 동작.
다만 fast-path가 2개라, "fast-path 하나만 두고 다양성 확보" 요구에는 아직 부족.
```

## 4. 2차 실험: fast-path 1개 고정 + 다양성 확대

fast-path를 PC-13 하나로 고정하고, 나머지는 non-fast-path 시나리오로 교체했다.

최종적으로 8대 위험 PC가 깨끗하게 잡혔다.

| PC | 시나리오 | severity | risk_vector | 경로 |
|---|---|---|---|---|
| PC-13 | `miner` | HIGH | MINING | fast-path, 유일 |
| PC-15 | `aging` | HIGH | AGING | 점수 기반 stealth/노후화 |
| PC-17 | `gpu_stealth` | MEDIUM | MINING | 게이팅 |
| PC-19 | `gpu_cpu_both` | MEDIUM | MINING | 게이팅 |
| PC-21 | `gpu_cpu_heavy` | MEDIUM | MINING | 게이팅 |
| PC-23 | `vram_miner` | MEDIUM | MINING | 게이팅 |
| PC-25 | `cpu_miner` | MEDIUM | THREAT | 게이팅 |
| PC-27 | `temp_dropper` | MEDIUM | THREAT | 게이팅 |

추가 관찰:

```text
PC-29 runaway → MALFUNCTION / OBSERVE
PC-31 stealth_power → OBSERVE
PC-33 mem_leak → 미저장
PC-35 netabuse → 미저장
```

의미:

```text
fast-path 1개만 유지 성공.
MINING / AGING / THREAT / MALFUNCTION 축이 모두 등장.
위험 이력으로 저장되는 것은 HIGH/MEDIUM 중심.
OBSERVE는 risk_vector 확인용으로는 의미가 있으나 anomaly_history에는 저장되지 않음.
```

## 5. 3차 실험: 위험 시나리오 두 배 다양화

사용자 요구에 따라 visible 위험 시나리오를 기존 6~8대 수준에서 두 배 가까이 늘렸다.
Grafana가 뜨지 않던 문제도 이 단계에서 확인했다.

Grafana 이슈:

```text
원인: Grafana 컨테이너가 떠 있지 않음
조치: docker compose up -d grafana
결과: localhost:3000 HTTP 200, Grafana v13.0.1 확인
```

시나리오 추가:

```text
gpu_asymmetric
sm_mining
cpu_idle_load
cpu_disk_idle
wintemp_exec
기타 GPU/CPU/위협 변종
```

안정화 후 결과:

```text
visible 위험 13대
HIGH 2대
MEDIUM 11대
OBSERVE 4대
fast-path 1대 유지
risk_vector 4축 등장: MINING / AGING / THREAT / MALFUNCTION
```

대표 배치:

| risk_vector | PC | severity | 시나리오 |
|---|---|---|---|
| MINING | PC-13 | HIGH | `miner`, 유일 fast-path |
| AGING | PC-12 | HIGH | `aging` |
| MINING | PC-14~19 | MEDIUM | GPU 계열 변종 |
| THREAT | PC-20~24 | MEDIUM | CPU/Temp/Windows Temp 계열 |
| MALFUNCTION | PC-25~28 일부 | OBSERVE | runaway/mem_runaway 등 |

의미:

```text
위험 표현 다양성은 확보됨.
대시보드에서 위험/정상 구분은 확인 가능.
다만 UI/UX적으로 어떤 risk_vector/진입경로/설명 근거가 사용자인지 한눈에 보기 어려운 문제가 드러남.
```

## 6. 4차 실험: 엣지케이스 추가

위험처럼 보이지만 정상일 수 있는 상황, 수집 실패, 임계 경계 등을 non-fast-path로
추가했다.

엣지케이스의 핵심은 "위험으로 뜨지 않는 것"이다.

| 시나리오 | 결과 | 검증 포인트 |
|---|---|---|
| `edge_gaming` | NORMAL | 게임 GPU 96% → 정황 감점으로 억제 |
| `edge_compiling` | NORMAL | 빌드 CPU 97% → 컴파일 감점으로 억제 |
| `edge_ml_training` | NORMAL | ML 학습, tensor 활성 → 채굴과 구분 |
| `edge_wl_highcpu` | OBSERVE | 화이트리스트 IDE 고CPU, unknown_process 면제 |
| `edge_gpu_missing` | NORMAL | GPU 수집 실패 시 거짓 GPU 신호 0 |
| `edge_net_missing` | OBSERVE | 네트워크 수집 실패, `signals_missing=['network']` |
| `edge_truncated` | NORMAL | 연결 목록 truncated → network 점수 0 |
| `edge_flapping` | NORMAL | CPU 요동, flat 미발화 |
| `edge_dos_floor` | NORMAL | inbound 95MB, floor 100 미만 |
| `edge_cap_exempt` | NORMAL | single_core cap exemption 동작 확인 |
| `edge_idle` | NORMAL | 완전 유휴 baseline |

의미:

```text
게임/빌드/ML 학습/수집 실패/경계값은 대체로 위험으로 과탐되지 않음.
edge_wl_highcpu, edge_net_missing은 OBSERVE이나 LOW라 저장되지 않음.
FP 회피 계층이 실제로 작동함.
```

## 7. 레드팀: 개선 전 실제 오탐 후보

README 기준, 정상 활동인데 위험으로 오분류될 수 있는 시나리오도 확인됐다.
이는 개선 전 기준선으로 중요하다.

| 정상 활동 시나리오 | 결과 | 원인 |
|---|---|---|
| `fp_gpu_compute` | SUSPICIOUS / MINING | BOINC류 GPU 분산컴퓨팅이 채굴 자원 시그니처와 유사 |
| `fp_render_both` | SUSPICIOUS / MINING | V-Ray류 CPU/GPU 동시 flat 고부하 |
| `fp_cpu_science` | SUSPICIOUS | MATLAB 야간 연산, CPU flat 97% |
| `fp_video_encode` | SUSPICIOUS / MINING | OBS/인코더 flat GPU 부하 |
| `fp_vram_hog` | OBSERVE | VRAM 가득 사용을 stealth로 오인 |
| `fp_power_idle` | OBSERVE | idle 고전력을 stealth로 오인 |
| `fp_appdata_upload` | NORMAL | 네트워크 억제로 방어 |
| `fp_backup_burst` | NORMAL | spike 평균 흡수로 방어 |

핵심 결론:

```text
오탐률은 0이 아니다.
특히 연구실 환경에서는 정상 GPU 과학연산/렌더/인코딩이 채굴 시그니처와 겹친다.
MINING 탐지는 자원 flatness와 VRAM/tensor 패턴에 의존하므로 실사용 앱 allowlist와
프로세스 신뢰 근거가 중요하다.
```

## 8. 개선 전 기준선 요약

| 항목 | 개선 전 결과 |
|---|---|
| 기본 위험 탐지 | HIGH/MEDIUM 위험 PC 탐지 성공 |
| fast-path 제어 | fast-path 1대 고정 가능 |
| 위험 다양성 | visible 위험 13대까지 확대 |
| risk_vector 다양성 | MINING / AGING / THREAT / MALFUNCTION 확인 |
| 엣지케이스 억제 | 게임/컴파일/ML학습/수집실패/경계값 대부분 억제 |
| 실제 오탐 후보 | GPU 연산/렌더/인코딩/CPU 과학연산에서 MEDIUM+ 가능 |
| Grafana 상태 | 컨테이너 미기동 이슈 확인 후 복구 |
| AI 비용 | AI off/mock 유지, 비용 0 |
| NCP 영향 | 없음 |

## 9. 개선 전 발견된 개선 필요점

탐지 로직:

```text
정상 고부하 연산과 채굴 시그니처가 겹침.
연구실 실사용 앱 allowlist/서명/경로 신뢰 근거가 필요.
SUSPICIOUS 진입 시 자원 단독 근거에 대한 보수적 게이트가 더 필요할 수 있음.
risk_vector와 legacy verdict가 일부 불일치할 수 있음.
```

대시보드/UI:

```text
Grafana 컨테이너가 떠 있지 않으면 사용자는 아무것도 볼 수 없음.
위험 PC는 보이지만 왜 위험인지, fast-path인지, 게이팅인지 한눈에 보기 어렵다.
risk_vector, score_breakdown, alerts, AI reason/action의 연결성이 약하다.
OBSERVE/risk_vector 다양성은 저장되지 않으므로 화면에서 학습/검증용 신호가 잘 안 보인다.
```

운영 설명:

```text
score_breakdown은 설명용이고 score_breakdown.final만 최종 점수라는 점을 명확히 해야 한다.
retrieval은 현재 최종 점수 0점이며 AI 설명 보조라는 점을 명확히 해야 한다.
AI가 유사 과거 사례의 score 이유까지 받지는 않는다는 한계가 있다.
```

## 10. 후속 개선 추천

탐지 개선:

```text
1. 연구실 실사용 정상 고부하 앱 allowlist 확장
2. SUSPICIOUS 자원 단독 진입에 프로세스/서명/경로 신뢰 근거 추가
3. 정상 GPU 연산과 채굴을 구분할 tensor/VRAM/network/process feature 보강
4. risk_vector와 legacy verdict 정합성 점검
```

AI/retrieval 개선:

```text
1. final score에는 retrieval을 계속 미반영
2. SUSPICIOUS/HIGH_RISK 유사 과거 사례에 한해 anomaly_history에서 reason enrichment
3. AI prompt에 과거 score 이유(score_breakdown/alerts/message)를 임시 첨부
4. 스키마 변경 없이 prompt 설명력 개선
```

대시보드 개선:

```text
1. PC 상태 카드에서 severity + verdict + risk_vector 동시 표시
2. alert detail과 score_breakdown을 같은 패널에서 연결
3. fast-path / promotion gating / network-only cap 여부 노출
4. AI reason/action을 위험 PC 상세 화면의 1차 정보로 표시
5. Grafana 기동 상태를 배포 체크리스트에 포함
```

## 11. 결론

개선 전 실험에서 RADA는 다양한 위험 시나리오를 실제로 탐지했고, fast-path를 1개로
제한한 상태에서도 non-fast-path 위험을 충분히 잡았다. 엣지케이스 억제도 대체로
정상 동작했다.

그러나 연구실 환경의 정상 고부하 연산은 채굴과 매우 비슷한 자원 패턴을 만들 수
있어, 개선 전 상태의 주요 리스크는 **정상 GPU/CPU 고부하 작업에 대한 MEDIUM+ 오탐**이다.

따라서 다음 개선은 탐지 점수 자체를 무작정 올리는 것이 아니라, 정상 고부하 작업과
채굴을 구분하는 근거를 보강하고, 대시보드가 사용자에게 "왜 위험인지"를 더 선명하게
보여주는 방향이 적절하다.
