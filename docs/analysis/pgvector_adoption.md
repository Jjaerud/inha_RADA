# 벡터DB(pgvector) 도입 검토 및 PoC 결과

> 상태: **Phase C 완료 — opt-in 백엔드 main 커밋(기본 memory)** · 작성일 2026-06-02
> 결론: **도입 타당성 입증** — 영속성·확장성(194×) 이점 확인, 판단 결과 동치
> (verdict 분포 50k 에서도 100% 보존). recall 47% 는 tie-break 착시로 규명됨.
> NCP 지원: ✅ 확인됨(vector 0.8.0, cdb_admin 스키마 — store 가 search_path 처리).
> 남은 것: **NCP 운영 활성화**(운영자 .env 플래그 + 24h 관찰) — 코드 변경과 분리.

---

## 1. 배경 — 현재 retrieval 구조와 한계

RADA 는 이미 **자체 벡터 검색(retrieval-augmented evidence)** 을 사용한다.
- **임베딩**: 통계 기반 80차원 고정 벡터(feature 10 × stat 8). deep encoder 아님.
  (`ml_server/retrieval/segment_embedding.py`, `EMBED_DIM=80`)
- **저장**: `retrieval_store.py` — **in-memory** `deque(maxlen=20000)`, slot별.
- **검색**: 전수 스캔(brute-force) cosine, top-k.
- **활용**: `retrieval_evidence` 가 유사 과거 사례(NORMAL 다수 / HIGH_RISK 존재
  / novelty / peer mismatch)를 산출 → final score 분리 후 `explanation_confidence`
  의 입력으로 사용(#4/#8).

### 실측된 두 약점

| 약점 | 내용 | 영향 |
|---|---|---|
| **휘발성** | ml-server(또는 컨테이너) 재시작 시 corpus 전부 소멸 | 매 재시작 **cold start** — novelty 폭증, 비교 근거 0. retrieval 품질 저하 |
| **확장 cap** | `maxlen=20000` 초과 시 오래된 것부터 evict | 40대 × 장기 운영이면 빠르게 참. 오래된 정상 패턴 유실 |

> 그래프DB(Neo4j 등)는 검토했으나 **보류**. RADA 는 시계열 이상탐지 위주라
> 관계 질의(PC↔IP, 프로세스 트리) 활용처가 제한적이고, 새 인프라 운영 부담
> 대비 ROI 가 불확실. 벡터DB 만 도입 대상으로 한다.

---

## 2. 도입 근거 — 왜 pgvector 인가

| 후보 | 평가 |
|---|---|
| **pgvector** (PostgreSQL extension) | ✅ **이미 PostgreSQL 운영 중** → 새 인프라 0. extension + 테이블만 추가. HNSW/IVFFlat ANN 인덱스. SQL 통합 |
| FAISS (라이브러리) | 영속성·운영 직접 관리 필요. 분산/동기화 부담 |
| Qdrant/Milvus (전용 벡터DB) | 기능 풍부하나 **새 인프라·운영 추가**. 현 규모(80차원, ~수만 건)엔 과함 |

→ **pgvector** 가 "기존 자산 재활용 + 최소 변경 + 영속성" 에 가장 부합.

---

## 3. PoC 결과 (로컬 실증)

로컬 postgres 를 `pgvector/pgvector:pg16` 로 교체, `RETRIEVAL_BACKEND`
환경변수로 in-memory ↔ pgvector 전환(기존 경로 보존, additive).

### 3-1. 동작 — pgvector 0.8.2, 80차원 vector + HNSW(cosine)
`retrieval_segments(embedding vector(80))` + `hnsw (embedding vector_cosine_ops)`.
pgvector 의 `<=>` 연산자 = `1 - cos` = 기존 `_cosine_distance` 와 동일 의미.

### 3-2. 검색 결과 동치 — top-3 순위 **5/5 일치**
동일 코퍼스(50)·동일 쿼리(5)로 in-memory vs pgvector 비교 → **순위 100% 일치**.
(cosine distance 동치 확인 — 도입해도 판단 결과 불변)

### 3-3. 영속성 — **재시작 survive** (핵심 이점)
- postgres 재시작 후 corpus 50 → 50 유지.
- **ml-server 재시작** 후 corpus 9 → 9 유지(in-memory 였으면 0).
- 재시작 직후 `/analyze` 의 `retrieval_evidence available=True, top_k 3건`
  → **cold start 없이** 이전 corpus 와 즉시 비교.

### 3-4. 통합 — ml-server 백엔드 전환 성공
- `RETRIEVAL_BACKEND=pgvector` → `retrieval.add_segment.__module__ ==
  retrieval_store_pgvector`.
- `/analyze` 20/20 성공 → segment 가 pgvector 에 영속 적재.
- 호출부(`analyze_router`, `clear_router`)는 **시그니처 동일이라 무변경**.

### 발견·수정한 버그
- 초기 스키마에서 `start_ts/end_ts` 를 `DOUBLE PRECISION` 으로 잘못 정의
  (PoC 테스트는 float 를 줘 미검출). 실제 segment 의 ts 는 **ISO 문자열** →
  `TEXT` 로 수정. **실데이터 경로 검증의 중요성** 을 보여준 사례.

---

## 4. 도입 효과 요약

| | in-memory (현재) | pgvector (도입 시) |
|---|---|---|
| 재시작 후 corpus | **0 (휘발)** | **유지** |
| cold start | 매 재시작 발생 | 없음 |
| 용량 | 20,000 cap (evict) | 무제한 |
| 검색 | 전수 스캔 O(N) | HNSW ANN(대규모 빠름) |
| 인프라 | 없음 | PostgreSQL extension(기존 DB) |
| 검색 결과 | (기준) | **동치(top-3 5/5)** |
| ml-server | stateless | **DB 접속 신규** ⚠️ |

---

## 4-1. 대규모 벤치 결과 (Phase A 완료)

코퍼스 N=1k/10k/50k, 쿼리 30개 평균. mem=in-memory 전수스캔(exact),
pg=pgvector HNSW(기본 ef_search=40). recall = pg top-3 ∩ mem top-3 (id 기준).

| N | insert | mem 검색 | pg 검색 | **pg/mem 속도** | id-recall |
|---|---|---|---|---|---|
| 1,000 | 3.3s | 12.6ms | 1.8ms | **7×** | 100% |
| 10,000 | 40s | 133ms | 1.6ms | **86×** | 99% |
| 50,000 | 208s | 286ms | 1.5ms | **194×** | 47% |

**관찰 1 — 검색 성능: HNSW 압도적.**
in-memory 는 O(N) 전수스캔이라 N 에 비례 증가(12→133→286ms), pgvector HNSW 는
**거의 상수(~1.5ms)**. 50k 에서 **194배** 빠르고, 규모가 클수록 격차 확대.
→ 대규모 운영(장기 누적)에서 pgvector 가 사실상 필수.

**관찰 2 — id-recall 47% 는 품질 손실이 아니라 tie-break 아티팩트 (★ 정정).**
초기엔 50k 의 47% 를 "HNSW 근사 한계, 도입 전 ef_search 튜닝 필요" 로 해석했으나,
Phase B 정밀 진단 결과 **오해였다**. 세 가지 통제실험으로 원인을 규명:

1. **HNSW 아님** — ef_search 를 40→800 으로 올려도 recall 43~44% 로 변화 없음.
   인덱스를 끈 **exact 전수스캔(seqscan)도 43%** → HNSW 근사와 무관.

   | mode | pg 검색 | id-recall |
   |---|---|---|
   | HNSW ef=40 | 0.95ms | 43% |
   | HNSW ef=400 | 1.95ms | 43% |
   | HNSW ef=800 | 2.93ms | 43% |
   | exact(seqscan) | 25.1ms | 43% |

2. **정밀도 아님** — 벡터 직렬화 자릿수 `%.6g`→`%.17g` 로 올려도 결과 **완전 동일**.

3. **tie-break 임** — RADA 임베딩은 정상 패턴이 극도로 촘촘해 최근접 거리가
   거의 동률(예: top-5 가 모두 distance≈0.0001). mem(파이썬 안정정렬)과
   pg(다른 정렬순서)가 **같은 거리의 다른 멤버**를 뽑아 id 만 갈린다.
   N 이 커질수록 동률 후보가 늘어 id-recall 이 떨어진다(2k=100%, 10k=99%, 50k=47%).

**관찰 3 — 실제 중요한 지표(verdict 분포)는 50k 에서도 100% 일치.**
id 대신 거리값 multiset / verdict 분포로 재측정:

| N | id-recall | dist-recall(거리값 동일) | **verdict 분포 동일** |
|---|---|---|---|
| 10,000 | 99% | 100% | **100%** |
| 50,000 | 47% | 78% | **100%** |

RADA 의 `retrieval_evidence` 는 이웃의 **id 가 아니라 verdict 분포**(NORMAL 다수 /
HIGH 존재 / novelty)를 집계해 점수에 반영한다. 그 분포가 **50k 에서도 100% 보존**
되므로 **판단 결과는 불변**. id-recall 47% 는 "동등하게 가까운 이웃 중 누구를
지목했나" 의 차이일 뿐 품질 저하가 아니다.

> ⚠️ 단, 본 벤치는 **합성 데이터**(분산이 매우 좁은 가우시안)라 동률이 과장됐다.
> 실데이터는 더 퍼져 있어 동률·id-recall 저하가 덜할 가능성이 높다. 어느 쪽이든
> **verdict 분포 보존이 판단 기준이며 그것이 100%** 라는 결론은 유효.

→ **결론: 성능 이점 명백(194×). recall "문제" 는 잘못된 지표(id-recall)가 만든
착시였고, ef_search 튜닝은 불필요. 기본 설정(ef_search=40)으로 충분.**

## 5. 향후 계획

### Phase A — 대규모 벤치 ✅ 완료 (§4-1)
- 성능: HNSW 194× 우위 확인.

### Phase B-1 — recall 원인 규명 ✅ 완료 (§4-1 관찰 2·3)
- 50k id-recall 47% = **tie-break 아티팩트**(HNSW·정밀도 아님)로 확정.
- verdict 분포(실제 판단 입력)는 50k 에서도 100% 보존 → **품질 손실 없음**.
- ef_search 튜닝 불필요 결론. 기본값(40) 채택.

### Phase B-2 — 아키텍처 결정 ✅ 완료

**현황**: ml-server 는 현재 **완전 stateless**(DB 접속 0). postgres 는 Spring 이
소유(Flyway 마이그레이션 V1~V8, app role + grafana_reader). Grafana 는 읽기 전용.
retrieval segment 는 80차원 통계 임베딩 = **ML 내부 파생 상태**(Spring 업무
도메인 데이터 아님, 언제든 재생성 가능한 캐시/인덱스).

| 방식 | 장점 | 단점 |
|---|---|---|
| **(a) ml-server 직접 접속** | retrieval 호출이 scorer 내부 동기 흐름 유지. 단순·저지연 | "ML stateless" 원칙과 표면상 충돌 |
| (b) Spring 경유 | DB 소유 일원화 | **Spring→ML(/analyze)→Spring(retrieval) 순환 호출** 발생. 왕복 지연·결합도↑ |

**결정: (a) ml-server 직접 접속 — 단, 아래 가드레일로 원칙 정신을 보존.**

근거: retrieval 은 `/analyze` 내부에서 동기 호출되므로 (b)는 Spring→ML→Spring
**순환 의존**을 만든다(지연·결합 악화). 또 "ML stateless" 원칙의 본의는 ML 이
*업무 권위 데이터*를 갖지 않는다는 것이지, ML 전용 *인덱스/캐시*까지 금지하는
게 아니다. 영속 retrieval 은 오히려 ML 을 재시작에 견고하게 만든다(cold start 제거).

**가드레일(원칙 보존)**:
1. **DDL 은 store 가 멱등 소유**(Flyway 아님 — 아래 ★). pgvector 백엔드가
   활성일 때만 `CREATE TABLE/INDEX IF NOT EXISTS` 를 수행. `CREATE EXTENSION`
   은 *없을 때만* 조건부 시도(NCP 는 콘솔 설치 완료라 skip).
2. **opt-in 기본값** — `RETRIEVAL_BACKEND` 미설정 = in-memory(기존 경로). pgvector
   는 env 명시 시에만 활성 → main/NCP 는 플래그 전까지 **무영향**(additive).
3. **재생성 가능 캐시로 취급** — 백업·마이그레이션 부담 없음. 손상 시 TRUNCATE
   후 재누적. 업무 데이터 정합성 책임 없음.

> ★ **왜 Flyway V9 가 아니라 store-owned DDL 인가** (초안에서 변경):
> Flyway 는 pgvector 가 **없는 환경에서도 실행**된다 — CI 의 compose config 검증,
> base 로컬 스택(`postgres:16-alpine`, vector 미설치). 거기에 `CREATE EXTENSION
> vector` 를 넣으면 `vector.control` 부재로 **Spring 기동 자체가 깨진다**. 반면
> store 는 pgvector 백엔드가 켜졌을 때만 로드되므로 안전하게 DDL 을 책임진다.
> 테이블이 ML 내부 재생성 캐시라 "단일 진실원" 부담도 없다. → 더 안전·additive.
> (least-privilege `rada_ml` role 은 store 가 CREATE TABLE 을 하려면 schema CREATE
> 권한이 필요해 trade-off. 운영 활성화 시 app role 사용 또는 rada_ml+CREATE 부여 —
> 하드닝 항목으로 NCP 활성화 가이드에 정리.)

### Phase B-3 — NCP pgvector 지원 확인 + Flyway 설계 ✅ 확인 완료

1. **NCP Cloud DB(managed PostgreSQL) `vector` extension 지원** ✅ **확인됨**.
   - 운영 DB 조회 결과: `vector 0.8.0`, **schema=`cdb_admin`**, hnsw 접근메서드 포함.
     (NCP 콘솔에서 설치 완료 상태 — `CREATE EXTENSION` 재실행 불필요.)
   - 로컬 PoC(0.8.2)와 미세 버전차지만 HNSW·`vector_cosine_ops`·`<=>` 모두 동일
     지원 → 기능 영향 없음. **도입 전제조건 충족**.
   - ⚠️ **핵심 차이 — extension 이 `cdb_admin` 스키마에 설치됨**(로컬 PoC 는
     `public`). `vector` 타입·`vector_cosine_ops` opclass·`<=>` 연산자가 모두
     `cdb_admin` 소속이라, 이를 쓰는 **모든 role 의 search_path 에 `cdb_admin` 을
     포함**해야 한다. 누락 시 `type "vector" does not exist` 발생.
2. **스키마 DDL — Flyway V9 폐기, store-owned 으로 전환** (B-2 ★ 참고).
   초안의 `V9__retrieval_segments.sql` 은 **채택하지 않는다**. Flyway 가 pgvector
   미설치 환경(CI·base 로컬)에서도 실행돼 기동을 깨기 때문. 대신 store
   (`retrieval_store_pgvector.py`)가 연결 시 **멱등 DDL** 을 수행한다:
   - `SET search_path TO <schema>, cdb_admin, public` — NCP cdb_admin 의 vector
     타입/opclass/`<=>` 해석(없는 환경에선 자동 무시 → 로컬 public 으로 해석).
   - extension: `pg_extension` 에 없을 때만 `CREATE EXTENSION` 시도(NCP 는 이미
     설치 → skip; 권한 없어 실패해도 조용히 통과 후 CREATE TABLE 에서 검증).
   - `CREATE TABLE/INDEX IF NOT EXISTS`(테이블·slot·HNSW). 스키마는
     `RETRIEVAL_PG_SCHEMA`(기본 pc_monitor) env.
3. **NCP 활성화 시 role/권한**(운영자):
   - 간단: 기존 app DB user(Spring 과 동일, pc_monitor 에 DDL 권한 보유)를
     retrieval DSN 으로 재사용 → store 가 CREATE TABLE 가능. 가장 빠름.
   - 하드닝: 전용 `rada_ml` role + `CREATE ON SCHEMA pc_monitor` + `USAGE ON
     SCHEMA cdb_admin`(vector 타입 접근). search_path 에 cdb_admin 포함.
   - 절차는 NCP 가이드 §7-4/§7-5 참고.

### Phase B-4 — 동시성 확인 ✅ 완료

ml-server 는 `def analyze`(sync) + uvicorn `--workers 1` → FastAPI **스레드풀**
(기본 ~40 스레드)에서 동시 처리. PoC store 는 모듈 전역 단일 커넥션 공유라
초기엔 thread-unsafe 를 우려했으나, **40 스레드 × 2000 ops 부하에서 에러 0건**.
- psycopg2 `threadsafety=2` — 공유 커넥션 접근을 **내부 락으로 직렬화** → 충돌·
  손상 없음(정확성 OK).
- 함의는 정확성이 아니라 **처리량**: 모든 DB 작업이 한 커넥션에 직렬화됨.
  RADA 실부하(40대 × 30~60초 주기 = 1 req/s 미만)에선 무시 가능.
- Phase C 에서 동시성 상향이 필요하면 `ThreadedConnectionPool`(작은 풀) 고려 —
  현 규모엔 **선택사항**.

### Phase C — 정식 도입(opt-in 커밋) ✅ 완료

pgvector 백엔드를 **opt-in 코드로 main 에 커밋**(기본값 memory 유지). 코드는
존재하되 env 플래그 전까진 비활성 → main/NCP **무영향**(additive).
- `retrieval_store_pgvector.py` 운영화 — cdb_admin search_path, 조건부 extension,
  멱등 CREATE TABLE/INDEX, `RETRIEVAL_PG_SCHEMA` env.
- `__init__.py` 백엔드 분기(`RETRIEVAL_BACKEND=pgvector` 일 때만 pgvector 로드).
- `docker-compose.pgvector.yml` 명시적 overlay(auto-load 아님) — 로컬 활성화용.
- 로컬 검증 ✅: overlay 로 ml-server pgvector 기동 → 적재 3건이 **ml-server
  재시작 후에도 유지**(영속성). 백엔드 모듈 `retrieval_store_pgvector` 확인.

**NCP 활성화(운영자 차례, 미실행)**: managed Cloud DB 에 vector 이미 설치됨.
.env 에 `RETRIEVAL_BACKEND=pgvector` + `RETRIEVAL_PG_DSN`(가이드 §7-4) 추가 후
`up -d --force-recreate ml-server`. **24h 관찰** 권장(retrieval_evidence 품질·지연).
끄려면 env 제거 후 재기동 → 즉시 in-memory 복귀(롤백 간단).

**향후(선택)**: 동시성 상향 시 `ThreadedConnectionPool`, 하드닝 `rada_ml` role.

---

## 6. 산출물

| 파일 | 상태 |
|---|---|
| `ml_server/retrieval/retrieval_store_pgvector.py` | ✅ 커밋(운영화) — pgvector 백엔드 |
| `ml_server/retrieval/__init__.py` | ✅ 커밋 — 백엔드 분기(기본 memory) |
| `ml_server/requirements.txt` | ✅ 커밋 — psycopg2-binary |
| `docker-compose.pgvector.yml` | ✅ 커밋 — 명시적 opt-in overlay |
| `docker-compose.override.yml` | gitignore — 개인용 auto-load overlay(로컬) |
| `.poc/` | gitignore — 벤치/검증 스크립트(throwaway) |

> 커밋분은 **기본 비활성(opt-in)** 이라 main/NCP 는 env 플래그 전까지 영향 0.
> 운영 활성화는 NCP .env 변경(운영자) — 본 저장소 변경과 분리.
