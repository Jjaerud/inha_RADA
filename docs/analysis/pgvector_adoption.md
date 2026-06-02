# 벡터DB(pgvector) 도입 검토 및 PoC 결과

> 상태: **PoC 완료 (로컬 실증, 미커밋)** · 작성일 2026-06-02
> 결론: **도입 타당성 입증** — 영속성·확장성 이점 확인, 검색 결과 동치.
> 다음: 대규모 성능 벤치(③) → 아키텍처 결정 → 정식 도입 여부.

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
pg=pgvector HNSW(기본 ef_search=40). recall = pg top-3 ∩ mem top-3.

| N | insert | mem 검색 | pg 검색 | **pg/mem 속도** | recall |
|---|---|---|---|---|---|
| 1,000 | 3.3s | 12.6ms | 1.8ms | **7×** | 100% |
| 10,000 | 40s | 133ms | 1.6ms | **86×** | 99% |
| 50,000 | 208s | 286ms | 1.5ms | **194×** | **47%** |

**관찰 1 — 검색 성능: HNSW 압도적.**
in-memory 는 O(N) 전수스캔이라 N 에 비례 증가(12→133→286ms), pgvector HNSW 는
**거의 상수(~1.5ms)**. 50k 에서 **194배** 빠르고, 규모가 클수록 격차 확대.
→ 대규모 운영(장기 누적)에서 pgvector 가 사실상 필수.

**관찰 2 — recall: HNSW 근사의 한계 (★ 도입 전 해결 과제).**
1k/10k 는 99~100% 지만 **50k 에서 47%** 로 급락. HNSW 는 근사 최근접(ANN)
이라 후보 탐색폭(`ef_search`)이 작으면 exact top-3 를 절반만 맞춘다. 특히
RADA 임베딩은 80차원 통계 벡터로 **정상 패턴이 촘촘**해 근접 이웃 구분이
어렵다(ANN 이 헷갈리기 쉬운 분포).

> ⚠️ recall 47% 는 retrieval evidence 의 distance 임계 판정(near_threshold)에
> 영향을 줄 수 있다. **단, evidence 는 top-3 의 verdict 분포(NORMAL 다수 /
> HIGH 존재) 집계**라 정확한 id 일치보다 분포 보존이 중요 — 영향은 부분적.

**해결 방향 (도입 시 필수 튜닝)**:
1. `hnsw.ef_search` 상향(기본 40 → 100~400). recall↑ ↔ latency↑ trade-off.
   pg 검색이 1.5ms 로 워낙 빨라 ef_search 를 크게 올려도 여유 큼.
2. 인덱스 빌드 파라미터(`m`, `ef_construction`) 상향.
3. 또는 정확도가 결정적이면 **exact 검색**(인덱스 미사용) — 1.5ms→수십ms 라도
   in-memory(286ms)보다 빠름. corpus 규모/품질 요구에 따라 선택.

→ **결론: 성능 이점은 명백(194×). recall 은 ef_search 튜닝으로 해결해야
하며, 이를 Phase B 의 검증 항목으로 둔다.**

## 5. 향후 계획

### Phase A — 대규모 벤치 ✅ 완료 (§4-1)
- 성능: HNSW 194× 우위 확인. recall: 50k 47% → ef_search 튜닝 과제 도출.

### Phase B — 아키텍처 결정 (정식 도입 전 필수)
1. **ml-server ↔ DB 연결 방식**:
   - (a) ml-server 가 pgvector 에 직접 접속(PoC 방식) — 단순하나 stateless 깨짐.
   - (b) Spring 경유(현 DB 소유 구조 유지) — 일관되나 retrieval 왕복 추가.
   - → RADA 의 "ML 은 stateless, DB 는 Spring" 원칙과 trade-off 검토.
2. **Cloud DB(NCP) pgvector 지원 확인**: managed PostgreSQL 의 extension
   허용 여부(`CREATE EXTENSION vector`).
3. **Flyway 마이그레이션**: `V9__retrieval_segments.sql` (extension + 테이블 +
   HNSW 인덱스). 권한(grafana_reader 등) search_path 정합.

### Phase C — 정식 도입 (결정 시)
- `RETRIEVAL_BACKEND` 기본값 전략(memory 유지 후 단계적 전환 / 즉시 pgvector).
- corpus 마이그레이션 불필요(임베딩은 재생성 가능, 누적만 다름).
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
