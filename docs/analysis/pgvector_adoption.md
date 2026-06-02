# 벡터DB(pgvector) 도입 검토 및 PoC 결과

> 상태: **PoC 완료 (로컬 실증, 미커밋)** · 작성일 2026-06-02
> 결론: **도입 타당성 입증** — 영속성·확장성(194×) 이점 확인, 판단 결과 동치
> (verdict 분포 50k 에서도 100% 보존). recall 47% 는 tie-break 착시로 규명됨.
> 다음: 아키텍처 결정(ml-server↔DB) → NCP pgvector 지원·Flyway → 정식 도입 여부.

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
1. **DDL 은 Flyway 소유** — 스키마 단일 진실원 유지. ml-server 런타임의
   `CREATE EXTENSION/TABLE`(현 PoC `_DDL`)은 **운영 전 제거**, 부팅 시 DDL 금지.
2. **전용 최소권한 role** — `rada_ml`(가칭): `retrieval_segments` 에 대해
   INSERT/SELECT/DELETE/TRUNCATE 만. Spring app role 도 superuser 도 아님.
   `CREATE EXTENSION vector` 는 운영자/Flyway 가 1회 수행(상위 권한 필요).
3. **재생성 가능 캐시로 취급** — 백업·마이그레이션 부담 없음. 손상 시 TRUNCATE
   후 재누적. 업무 데이터 정합성 책임 없음.

### Phase B-3 — NCP pgvector 지원 확인 + Flyway 설계 (정식 도입 전 필수)

1. **NCP Cloud DB(managed PostgreSQL) `vector` extension 지원 확인** ⚠️ 미확정.
   - managed 환경은 extension allow-list 가 제한적. `SELECT * FROM
     pg_available_extensions WHERE name='vector';` 로 설치 가능 여부 확인 필요.
   - 미지원 시 대안: (i) NCP 콘솔/지원으로 vector 활성화 요청, (ii) 자체 설치
     PostgreSQL(현 NCP 구성이 systemd 직접 운영이면 가능), (iii) in-memory 유지.
   - **이 확인이 도입의 전제조건** — 미지원이면 Phase C 보류.
2. **Flyway `V9__retrieval_segments.sql` 초안** (현 V1~V8 패턴 정합:
   `${db_schema}`/`${db_user}` placeholder, grafana_reader 불필요=쓰기 전용):

   ```sql
   -- V9: pgvector retrieval segments (ML-internal cache, regenerable).
   -- CREATE EXTENSION requires elevated privilege; operator/Flyway runs once.
   CREATE EXTENSION IF NOT EXISTS vector;

   CREATE TABLE IF NOT EXISTS ${db_schema}.retrieval_segments (
       id          BIGSERIAL PRIMARY KEY,
       segment_id  TEXT,
       pc_id       TEXT,
       slot        TEXT,
       embedding   vector(80),
       verdict     TEXT,
       score       REAL,
       start_ts    TEXT,   -- ISO 문자열 (PoC 에서 검증: double 아님)
       end_ts      TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_retr_slot
       ON ${db_schema}.retrieval_segments (slot);
   CREATE INDEX IF NOT EXISTS idx_retr_emb_hnsw
       ON ${db_schema}.retrieval_segments
       USING hnsw (embedding vector_cosine_ops);

   -- 전용 ML role 최소권한(role 자체는 운영자 부트스트랩 스크립트가 생성).
   DO $$
   BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rada_ml') THEN
           EXECUTE format(
               'GRANT INSERT, SELECT, DELETE, TRUNCATE ON %I.retrieval_segments TO rada_ml',
               '${db_schema}');
           EXECUTE format(
               'GRANT USAGE, SELECT ON SEQUENCE %I.retrieval_segments_id_seq TO rada_ml',
               '${db_schema}');
           EXECUTE 'ALTER ROLE rada_ml SET search_path TO ${db_schema}, public';
       END IF;
   END $$;
   ```
   - 부트스트랩 스크립트(`infra/ncp/scripts/`)에 `rada_ml` role 생성 + ml-server
     DSN 발급 단계 추가 필요(grafana_reader 패턴과 동일 구조).

### Phase C — 정식 도입 (결정 시, 미착수)
- `RETRIEVAL_BACKEND` 기본값 전략(memory 유지 후 단계적 전환 / 즉시 pgvector).
- ml-server 런타임 `_DDL` 제거(Flyway 가 DDL 소유). DSN env 주입.
- corpus 마이그레이션 불필요(임베딩 재생성 가능, 누적만 다름).
- 운영 관찰: retrieval_evidence 품질·검색 지연 모니터링.

---

## 6. PoC 산출물 (현재 로컬, 미커밋)

| 파일 | 상태 |
|---|---|
| `docker-compose.override.yml` | gitignore — postgres→pgvector 이미지 + ml-server 백엔드 env |
| `ml_server/retrieval/retrieval_store_pgvector.py` | gitignore — pgvector 백엔드 모듈 |
| `.poc/` | gitignore — 검증 스크립트 |
| `ml_server/requirements.txt` | 작업트리 변경(psycopg2-binary) — 미커밋 |
| `ml_server/retrieval/__init__.py` | 작업트리 변경(백엔드 분기) — 미커밋 |

> 전부 로컬·미커밋이라 **main/NCP 영향 0**. 정식 도입(Phase C) 결정 시
> gitignore 해제 + Flyway 마이그레이션과 함께 커밋한다.
