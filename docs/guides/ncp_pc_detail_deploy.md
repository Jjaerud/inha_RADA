# NCP 배포 — PC 상세 대시보드 (composite 패널)

> 로컬에서 완성·검증한 **PC 상세 대시보드(rada-pc-detail-panel composite)** +
> 허니컴 클릭 네비게이션 + 정상비율 블롭 별 애니메이션을 NCP에 올리는 절차.
> **엔진/Java 무변경** — Grafana 플러그인 + 대시보드 + 쿼리만.

## 0. 무엇이 바뀌나

| 구성 | 변경 |
|---|---|
| `rada-pc-detail-panel` (**신규**) | PC 상세 전체화면 단일 패널(상태블롭·니들게이지·등급score·점수추이·4시계열·다크레이더·점수구성·AI 4존) |
| `rada-hexmap-panel` (수정) | 셀 클릭 → `/d/rada-pc-detail?var-pc_id=<셀>` 네비게이션(`detailUrl` 옵션, 기본값) |
| `rada-blob-gauge-panel` (수정) | 정상비율 블롭 배경 별 트윙클+드리프트 애니메이션 |
| `rada-pc-detail.json` 대시보드 | composite 패널 + **NCP 실 scores 구조에서 panel 조립**하는 meta 쿼리 |
| (참고) ai-judgment/risk-vector/score-breakdown 분리 패널 | composite로 대체됨 — NCP 마운트 불필요 |

> `dist/`는 git에 커밋돼 있어 **NCP에서 npm 빌드 불필요**. git pull로 산출물까지 받음.

## 1. NCP compose 수정 (VM `/opt/rada/docker-compose.ncp.yml`, 1회)

grafana 서비스에 **신규 패널 마운트 + unsigned 등록** 추가:

```yaml
  grafana:
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: "<기존목록>,rada-pc-detail-panel"
    volumes:
      # 기존 마운트들 …
      - ./grafana-plugins/rada-pc-detail-panel/dist:/var/lib/grafana/plugins/rada-pc-detail-panel:ro
```
> `rada-hexmap-panel`·`rada-blob-gauge-panel`은 이미 마운트돼 있으므로 추가 불필요
> (git pull로 dist만 갱신됨).

## 2. 적용

```bash
cd /opt/rada
git pull
# (1회) docker-compose.ncp.yml에 위 마운트+unsigned 추가
docker compose -f docker-compose.ncp.yml up -d --force-recreate grafana
```
> 대시보드는 provisioning 마운트라 재기동만으로 반영. 플러그인 dist도 마운트라 재기동 반영.

## 3. 데이터 경로 (NCP는 어떻게 채워지나)

NCP `anomaly_history.scores`에는 로컬 시드의 `panel` 키가 **없다**. 대시보드 meta
쿼리가 **실 구조에서 panel을 조립**한다(COALESCE):

```
COALESCE(
  scores->'panel',                      -- 로컬 시드(있으면 사용)
  jsonb_build_object(…실 scores에서 빌드…) -- NCP: risk_vector·score_breakdown·
)                                          --      signal_quality·explanation_confidence·
                                           --      evidence_meta + ai_judgment_history
```
- **risk**: `risk_vector` 5축을 /10 정규화(0~1)
- **composition**: `score_breakdown` 6키 비중(%)
- **scoreSpark**: 최근 `anomaly_history.final` 30건
- **ai**: judgment/severity/reason/action/signals(active_signals)/quality(signal_quality)/explain(explanation_confidence)
- **정상 PC**(이상 이력 없음): `FROM pc_info`라 1행 반환, sev=0 → "정상·이상 징후 없음" 빈상태

## 4. NCP 특이사항(예상 동작)

- **AI mock(is_mock=t)** → C구역(탈앵커링) `benign`/`contradicting` 비어 "실 AI 적용 시 표시" 플레이스홀더. **정상.**
- **scoreSpark**: anomaly 이력이 1건뿐이면 점수추이는 "최근 이상 없음" 빈상태(이력 쌓이면 채워짐).
- **risk /10 정규화·primary_type 영문**(THREAT_SUSPICION 등)은 표시 그대로 — 필요 시 후속 튜닝.
- 라이브 피드(`.poc/tick.sql`)는 **로컬 데모 전용** — NCP는 실 클라이언트가 데이터를 넣으므로 불필요.

## 5. 검증

```bash
# 이상 PC(있으면) 상세 확인 — anomaly_history에 행이 있는 pc 선택
# 브라우저: <NCP>/d/rada-pc-detail → 상단 PC 드롭다운
# 허니컴: <NCP>/d/rada-honeycomb → 셀 클릭 → 상세 이동
```
- 셀 클릭 시 시간범위 유지하며 상세로 이동하는지
- 이상 PC는 해당 상태, **정상 PC는 빈상태**로 뜨는지(demo 폴백 아님)

## 6. 롤백
- compose에서 마운트/unsigned 한 줄 제거 후 재기동 → 패널 비활성
- 대시보드: 이전 버전 git revert
- 전부 additive·가역적(엔진/DB 스키마 무변경)
