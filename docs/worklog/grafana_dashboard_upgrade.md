# Grafana 대시보드 업그레이드 작업 기록

> 작성일: 2026-05-28
> 상태: **진행 중** (메인 대시보드 미완성, 미커밋)
> 커밋 정책: **메인 대시보드 완성 시 커밋** (현재 패널 2개 추가 작업 + 개선사항 잔존)

## 1. 목표

React 디자인 시안을 Grafana 커스텀 패널 플러그인(경로 2)으로 로컬 RADA 프로젝트에
재현. 최종 페이지가 의도대로 완성되면 커밋, 이후 실데이터 연결.

## 2. 구현 현황 — 커스텀 패널 플러그인 6종

경로: `grafana-plugins/rada-*-panel/`
각 플러그인: package.json / tsconfig / webpack.config.js / .gitignore /
src/{plugin.json, types.ts, module.tsx, components/*.tsx, inject.ts, img/logo.svg}
빌드: `npm run build` → AMD `dist/module.js` (dist 커밋, node_modules 제외)

| 플러그인 | 역할 | 비고 |
|----------|------|------|
| rada-hexmap-panel | 허니컴(PC 40대 상태) | 좌하단 데코 outline 제거, 서브타이틀 "PC 상태 현황" |
| rada-blob-gauge-panel | 블롭 게이지 | 시안 완벽 재현 |
| rada-stat-card-panel | 스탯 카드 | 검정 bold, 알약 배경, 서브타이틀, 시간 tooltip |
| rada-concerns-panel | Top concern 피드 | 전체 6건 notification형, 화살표 제거 |
| rada-verdict-ribbon-panel | AI 판단 분포 막대 | 색상별 그라데이션 펄스(GRAD pairs), GRAD.cool |
| rada-radial-gauges-panel | 방사형 게이지 | GRAD_OPTS 타입 정리 |

### 공통 스타일 (`src/inject.ts`)
- Google Fonts: Space Grotesk + IBM Plex Mono
- keyframes: rada-pulse-strong, rada-blob-rotate-cw/ccw(18s/28s),
  rada-halo-pulse(3.2s), rada-ribbon-sweep, rada-dash-flow

### 그라데이션 색상 (verdict ribbon GRAD pairs)
- Normal mint #00b574→#00c4d4
- Mining hot #f43f5e→#f5588c
- Heavy amber #fbbf24→#ff7849
- HW Error cool #3b82f6→#6d4cff

## 3. 대시보드 / 인프라 설정

- `infra/grafana/provisioning/dashboards/rada-honeycomb.json`
  - 제목: "60주년 808 실습실 자원 모니터링"
  - 5행 그리드: (블롭 게이지 + 스탯카드 4) / (허니컴 14col + concerns·verdict 10col) /
    (이상 탐지 피드 16col + LAB 평균 자원 8col)
  - 전 패널 `demoMode:true` (실데이터 미연결 상태)
- `docker-compose.yml`
  - `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS` 에 6개 플러그인 등록
  - 6개 volume mount → `/var/lib/grafana/plugins/`
  - postgres host port 25432

## 4. 해결된 이슈

- radial-gauges module.tsx TS2322 GRAD_OPTS → `Array<SelectableValue<GaugeGradient>>`
- verdict ribbon 흰색 shine → 세그먼트별 colorFrom/colorTo 그라데이션 펄스
- 그라데이션 방향: 우측 상단에서만 퍼지도록, 전반적 퍼짐 축소
- "Ai Agent 상태 40대 PC" → "PC 상태 현황" 라벨 변경

## 5. 고정 로스터 + offline 표시 (파일럿 대응)

소수 PC만 가동(예: 3대)해도 허니컴이 비지 않도록 — 고정 로스터를 항상
렌더하고 미보고 PC 는 offline 으로 표시.

- **hexmap 패널** (`rada-hexmap-panel`):
  - 옵션 추가: `fillToCount`(기본 40) + `rosterIds`(선택, 명시적 목록).
  - `applyRoster()`: live 셀을 로스터에 머지, 없는 슬롯은 OFFLINE(severity -1).
    로스터 밖 live PC 는 뒤에 append(숨기지 않음).
  - 기존 "데이터 0개 → 40 offline" fallback 은 로스터 로직으로 통합.
  - module.tsx 에디터에 Roster 카테고리 추가.
- **SQL (이미 반영돼 있었음)**: hexmap rawSql 이 `collected_at` NULL/5분 초과 시
  severity=-1 반환 → 데이터 계층에서도 offline 인지. 패널 로스터와 결합해 완성.

### 클라이언트 pc_id 오버라이드 (로스터 매칭 전제)
- 기존엔 payload pc_id = MAC 기반 → 로스터(PC-01..40) 와 매칭 불가, "pcid mismatch 불편".
- `ClientConfig.pc_id` + `RADA_PC_ID` env + config.yaml `pc_id:` 지원.
  `ClientRuntime` 가 `config.pc_id or PC_ID(MAC)` 사용.
- `install.bat` 이 입력받은 번호로 `pc_id: PC-NN` 기입 → 데이터가 PC-01/02/03 으로 들어옴.
- collector_version 9.1.0 → **9.1.1**. 테스트 465 passed.

## 6. 패널 정합성 점검 — 하드코딩/오표시 6건 (2026-05-29)

운영 대시보드 리뷰에서 패널 텍스트가 실데이터와 어긋나는 6건 발견 후 수정.
SQL 의 시간창(1h/5min)은 **전부 이미 맞았고**, 문제는 정적 텍스트와 컴포넌트 버그.

### 검증 결과 (SQL 시간창 — 수정 불필요)
- 이상 탐지 피드(패널30): `anomaly_history WHERE detected_at > now()-1h` ✓
- AI 판단 분포(패널21): `ai_judgment_history WHERE judged_at > now()-1h` ✓
- LAB 평균 자원(패널31): `metrics_history WHERE collected_at > now()-5min`, avg() ✓

### 수정
1. **이상 탐지 피드 — actionLabel 의 "→ Alerts" 제거**. 컴포넌트가
   `전체 {rows.length}건` 을 이미 동적 렌더하므로 접미사만 제거(actionLabel="전체").
2. **AI 판단 분포 — subtitle "· 25건" 하드코딩 제거** → "· 최근 1h".
   본문 `전체 {total}건` 은 실데이터 합으로 이미 동적. segmentsJson 의 25건은
   demoMode:false 라 미사용(혼동 방지 위해 subtitle 만 정리).
3. **AI 판단 분포 — "전체 1건인데 그래프 안 나옴" 버그 수정** (verdict-ribbon):
   `const total = reduce(...) || 1` 이 데이터 0건일 때 0→1 로 덮어써 헤더에
   "전체 1건" 오표시 + ribbon 빈 바. 표시용 `total`(0 가능)과 나눗셈용
   `denom = total || 1` 분리, 0건이면 "최근 1시간 판단 없음" 표기.
4. **LAB 평균 자원 — subtitle "39대" 하드코딩 → 동적**. SQL 에
   `count(DISTINCT pc_id) AS n_pcs` 추가, radial-gauges 에 `countField`/
   `countWindowLabel` 옵션 신설 → "N대 평균 · 최근 5분" 동적 생성(전체 40대 중
   보고 중인 N대). 데모/필드 부재 시 정적 subtitle fallback.
5. **Top concerns — subtitle "클릭 → PC 상세"(미구현 동작) 제거** →
   "심각도 높은 순 · 최근 1h · PC별 최신 1건"(실제 쿼리 동작 설명).
6. (부수) Top concerns actionLabel "전체 6건" → "전체"(컴포넌트가 건수 동적 부착).

### 빌드/검증
- 컴포넌트 수정 2종(verdict-ribbon, radial-gauges) `npm run build` 성공.
- 대시보드 JSON 유효성 확인. 로컬 docker 스택으로 렌더 검증.

## 7. 남은 작업 (커밋 전 완료 필요)

- 그라데이션 미세 조정 등 개선사항 잔존(있으면)
- 메인 대시보드 완성 확정 시 **일괄 커밋**
