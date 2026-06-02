# NCP 셸 접속 & DB 분석 가이드

운영 중인 NCP App VM 에 SSH 로 접속해 **컨테이너 상태 확인 · DB 분석 ·
AI on/off** 를 수행하는 방법. 처음 구축은 [`../guides/ncp_deployment.md`](../guides/ncp_deployment.md) 참조.

---

## 0. 준비물 (체크리스트)

| 필요한 것 | 설명 | 어디서 |
|---|---|---|
| **SSH 개인키 (`.pem`)** | NCP VM 생성 시 발급한 Login Key. 예: `rada-key.pem` | 로컬 보관 (예: `C:\Users\admin\Desktop\radaki\rada-key.pem`). **분실 시 재발급 불가** |
| **App VM Public IP** | 외부 접속용 IP | NCP 콘솔 · 예: `223.130.154.165` |
| **SSH 유저** | `root` | 고정 |
| (DB 접속용) **`.env`** | DB_HOST/USER/PASSWORD/NAME 등 | **VM 안 `/opt/rada/.env`** 에 이미 존재 (별도 준비 불필요) |
| (선택) `RADA_ADMIN_TOKEN` | admin API 토큰 — 설정돼 있으면 AI 토글 시 헤더 필요 | VM `.env` |

> DB 비밀번호·Cloud DB endpoint 는 **VM 안 `.env` 에 들어있어** 로컬에서 따로
> 알 필요가 없다. SSH 로 들어가서 `source .env` 하면 변수로 로드된다.

---

## 1. SSH 접속

### Windows (PowerShell)

처음 한 번 — `.pem` 권한 잠그기 (OpenSSH 는 "다른 사용자 읽기 가능" 키를 거부):
```powershell
$KEY = "C:\Users\admin\Desktop\radaki\rada-key.pem"
icacls $KEY /inheritance:r
icacls $KEY /grant:r "$($env:USERNAME):(R)"
```

접속:
```powershell
ssh -i C:\Users\admin\Desktop\radaki\rada-key.pem root@223.130.154.165
```

### macOS / Linux
```bash
chmod 400 ~/path/rada-key.pem
ssh -i ~/path/rada-key.pem root@223.130.154.165
```

> 접속이 안 되면: ① Public IP 가 맞는지 ② NCP **ACG(방화벽)** 에 본인 IP→22 인바운드 규칙이 있는지 ③ VM 이 "운영중" 상태인지 확인.

---

## 2. 컨테이너 상태 · 로그

```bash
cd /opt/rada

# 컨테이너 상태 (healthy 인지)
docker compose -f docker-compose.ncp.yml ps

# 로그 (실시간 -f, 최근만 --tail)
docker compose -f docker-compose.ncp.yml logs -f ml-server
docker compose -f docker-compose.ncp.yml logs --tail=50 spring-server

# 에러만 빠르게
docker compose -f docker-compose.ncp.yml logs --tail=100 ml-server | grep -iE "error|traceback|실패"
```

ML 서버 상태(모니터링 PC 수 등):
```bash
docker compose -f docker-compose.ncp.yml exec ml-server python -c "
import urllib.request,json
d=json.load(urllib.request.urlopen('http://localhost:8000/status'))
print('PC수=', d.get('total_pcs'), d.get('monitored_pcs'))"
```

---

## 3. DB 접속 (psql)

NCP 는 **Cloud DB for PostgreSQL (managed)** — postgres 컨테이너가 아니라
별도 관리형 DB 다. VM 의 `psql` 클라이언트로 직접 접속한다.

```bash
cd /opt/rada
set -a && source .env && set +a        # .env 의 DB 변수 로드

# 변수명 확인 (값은 마스킹) — DB_* 인지 POSTGRES_* 인지 확인
grep -E '^DB_|^POSTGRES_' .env | sed -E 's/=.*/=.../'

# 접속 alias (변수명이 DB_* 인 경우)
alias radadb='PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME"'

# 접속 테스트
radadb -c "SELECT now();"
```
> 변수명이 `POSTGRES_PASSWORD` 등으로 다르면 alias 의 변수명을 거기에 맞춘다.
> alias 는 SSH 세션을 닫으면 사라지므로 매 접속마다 다시 잡는다(또는
> `~/.bashrc` 에 추가).

스키마: 모든 테이블은 **`pc_monitor`** 스키마.

| 테이블 | 핵심 컬럼 |
|---|---|
| `pc_monitor.metrics_history` | collected_at, pc_id, cpu_percent, mem_percent, gpu_percent, **extra**(jsonb: top_processes, external_connections, derived_features) |
| `pc_monitor.anomaly_history` | detected_at, pc_id, severity, anomaly_type(=verdict), message, **scores**(jsonb), alerts |
| `pc_monitor.ai_judgment_history` | judged_at, pc_id, judgment, is_mock, reason, action, anomaly_id, **details**(jsonb: hw_degradation 등) |
| `pc_monitor.pc_info` | pc_id, hostname, api_key 해시 등 |

---

## 4. 분석 쿼리 모음

### 4-1. 이상 탐지 현황
```bash
# 총계 + 최근 24h
radadb -c "SELECT count(*) AS 전체, count(*) FILTER (WHERE detected_at > now()-interval '24 hours') AS 최근24h FROM pc_monitor.anomaly_history;"

# severity 분포 (최근 24h)
radadb -c "SELECT severity, count(*) FROM pc_monitor.anomaly_history WHERE detected_at > now()-interval '24 hours' GROUP BY 1 ORDER BY 2 DESC;"

# PC별 많은 순 (최근 24h)
radadb -c "SELECT pc_id, count(*) AS 건수, max(detected_at) AS 최근 FROM pc_monitor.anomaly_history WHERE detected_at > now()-interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;"

# 시간대별 추이 (특정 PC)
radadb -c "SELECT date_trunc('hour', detected_at) AS 시각, count(*) FROM pc_monitor.anomaly_history WHERE pc_id='PC-01' AND detected_at > now()-interval '6 hours' GROUP BY 1 ORDER BY 1 DESC;"
```

### 4-2. AI 판단 (실제 Claude vs mock)
```bash
# is_mock 비율 — false 면 실제 Claude 작동
radadb -c "SELECT is_mock, count(*) FROM pc_monitor.ai_judgment_history WHERE judged_at > now()-interval '24 hours' GROUP BY 1;"

# 실제 Claude 판단 내용 보기 (is_mock=false)
radadb -c "SELECT judged_at, pc_id, judgment, left(reason,80) AS reason FROM pc_monitor.ai_judgment_history WHERE is_mock=false ORDER BY judged_at DESC LIMIT 5;"
```

### 4-3. anomaly 상세 (왜 잡혔나)
```bash
# anomaly + AI 판단 조인 (점수 + judgment + 근거)
radadb -c "
SELECT a.detected_at, a.pc_id, a.severity,
       round((a.scores->>'final')::numeric,1) AS score,
       j.is_mock, j.judgment, left(j.reason,80) AS reason
FROM pc_monitor.anomaly_history a
LEFT JOIN pc_monitor.ai_judgment_history j ON j.anomaly_id = a.id
ORDER BY a.detected_at DESC LIMIT 10;"

# 점수 내역 + 위험벡터 + 활성신호 (FP 진단용)
radadb -c "
SELECT detected_at,
       scores->'score_breakdown' AS breakdown,
       scores->'risk_vector'     AS 위험벡터,
       scores->'evidence_meta'->'active_signals' AS 활성신호
FROM pc_monitor.anomaly_history
WHERE pc_id='PC-01' AND severity='HIGH'
ORDER BY detected_at DESC LIMIT 2;"

# 한 건 통째로 (전체 scores)
radadb -c "SELECT jsonb_pretty(scores) FROM pc_monitor.anomaly_history WHERE pc_id='PC-01' ORDER BY detected_at DESC LIMIT 1;"
```

### 4-4. 특정 시점에 무슨 프로세스였나 (FP 판정)
```bash
radadb -c "
SELECT collected_at, cpu_percent, gpu_percent,
       extra->'top_processes' AS 프로세스
FROM pc_monitor.metrics_history
WHERE pc_id='PC-01'
  AND collected_at BETWEEN '2026-06-01 19:38' AND '2026-06-01 19:40'
ORDER BY collected_at DESC LIMIT 3;"
```

### 4-5. 가동/연결 상태
```bash
# 최근 5분 보고한 PC 수 (online)
radadb -c "SELECT count(DISTINCT pc_id) AS online_5m FROM pc_monitor.metrics_history WHERE collected_at > now()-interval '5 minutes';"

# 등록된 PC 목록
radadb -c "SELECT pc_id, hostname FROM pc_monitor.pc_info WHERE pc_id ~ '^PC-[0-9]+$' ORDER BY pc_id;"
```

---

## 5. AI agent on/off (런타임)

ml-server 컨테이너에 `curl` 이 없을 수 있으니 python 으로 호출하거나, 있으면 curl.

```bash
# 상태 확인
docker compose -f docker-compose.ncp.yml exec ml-server \
  python -c "from ml_server.agent import runner; print('ai_enabled=', runner.is_ai_enabled())"

# 끄기 (키 있어도 mock 만 — LLM 호출 0, 비용 0)
docker compose -f docker-compose.ncp.yml exec ml-server \
  python -c "from ml_server.agent import runner; runner.set_ai_enabled(False); print(runner.is_ai_enabled())"

# 켜기
docker compose -f docker-compose.ncp.yml exec ml-server \
  python -c "from ml_server.agent import runner; runner.set_ai_enabled(True); print(runner.is_ai_enabled())"
```
> ⚠️ 런타임 토글은 **컨테이너 재시작 시 기본(키 있으면 ON)으로 복귀**한다.
> 영구히 끄려면 `.env` 에 `USE_REAL_CLAUDE=false` 추가 후
> `docker compose -f docker-compose.ncp.yml up -d --force-recreate ml-server`.

HTTP 엔드포인트로도 가능(컨테이너에 curl 있을 때):
```bash
docker compose -f docker-compose.ncp.yml exec ml-server \
  curl -s -X POST localhost:8000/admin/agent-enabled \
  -H "Content-Type: application/json" -d '{"enabled":false}'
# RADA_ADMIN_TOKEN 설정 시: -H "X-Admin-Token: <토큰>" 추가
```

---

## 6. 코드/설정 반영 (변경 종류별)

| 변경 | 명령 |
|---|---|
| **ML 코드** (.py) | `git pull && docker compose -f docker-compose.ncp.yml up -d --build ml-server` |
| **Spring 코드** | `... up -d --build spring-server` |
| **Grafana 대시보드/플러그인** | `... restart grafana` (마운트라 빌드 불필요) |
| **scoring_policy.yaml** | `... restart ml-server` (시작 시 로드) |
| **.env (키 등)** | `... up -d --force-recreate ml-server` |

> ml-server 는 코드를 이미지에 COPY 하므로 **코드 변경 시 `--build` 필수**.
> Grafana 는 `-v` 마운트라 **restart 만으로** 새 파일 반영.

---

## 7. 트러블슈팅

| 증상 | 확인 |
|---|---|
| SSH 안 됨 | ACG 인바운드 22 규칙 + Public IP + VM 운영중 |
| DB 접속 실패 | `.env` 변수명(DB_* vs POSTGRES_*) + Cloud DB ACG 인바운드 5432 + DB User CIDR |
| `radadb: command not found` | alias 는 세션 한정 — `source .env` 후 alias 재설정 |
| is_mock 전부 true | ANTHROPIC_API_KEY 미적용(`env_file: .env` 확인) 또는 MEDIUM+ anomaly 미발생 |
| 한글 깨짐 | 터미널 UTF-8 설정 (`export LANG=ko_KR.UTF-8` 또는 PuTTY 인코딩) |
