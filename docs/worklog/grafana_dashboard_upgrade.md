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

## 5. 남은 작업 (커밋 전 완료 필요)

- **하단 패널 2종 마무리**: 이상 탐지 피드, LAB 평균 자원
- 그라데이션 미세 조정 등 개선사항 잔존
- **실데이터 연결**: demoMode 해제 후 PostgreSQL/API 데이터소스 바인딩
- 메인 대시보드 완성 확정 시 **일괄 커밋**
