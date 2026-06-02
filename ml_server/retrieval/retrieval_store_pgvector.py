"""pgvector 백엔드 retrieval store (opt-in).

기존 in-memory retrieval_store 와 동일한 시그니처(add_segment / search_similar
/ reset_store / clear_pc / count)를 제공하되, 저장·검색을 PostgreSQL + pgvector
로 수행한다. `RETRIEVAL_BACKEND=pgvector` 일 때만 import 되며, 기본값(미설정)은
in-memory 라 이 모듈이 로드되지 않는다 → pgvector 미설치 환경은 무영향(additive).

이점:
  - 영속성: 컨테이너 재시작에도 corpus 유지(in-memory 는 휘발).
  - 확장성: maxlen 20000 cap 없이 무제한 + HNSW 인덱스로 빠른 ANN.

cosine distance: pgvector 의 `<=>` 연산자 = 1 - cos(a,b) (in-memory 의
_cosine_distance 와 동일 의미) → 검색 순위가 in-memory 와 동치
(PoC 검증: verdict 분포 100% 보존).

스키마 소유(DDL): 이 store 가 자체적으로 멱등 DDL(CREATE TABLE/INDEX IF NOT
EXISTS)을 수행한다. Flyway 가 아니라 store 가 소유하는 이유 — Flyway 는
pgvector 가 없는 환경(CI 검증, base 로컬 postgres:16-alpine)에서도 실행되므로
거기에 `CREATE EXTENSION vector` 를 넣으면 기동이 깨진다. store 는 pgvector
백엔드가 켜졌을 때만 동작하므로 안전하게 DDL 을 책임질 수 있다. 본 테이블은
ML 내부 재생성 가능 캐시라 단일 진실원 부담도 없다.

NCP(managed Cloud DB) 주의: vector extension 이 `cdb_admin` 스키마에 설치돼
있어(로컬/일반 PG 는 public), vector 타입·opclass·`<=>` 해석을 위해
search_path 에 cdb_admin 을 포함한다(없는 환경에선 자동 무시됨).

환경변수:
  RETRIEVAL_PG_DSN     예) postgresql://rada:rada_dev_pw@localhost:25432/pc_monitor
  RETRIEVAL_PG_SCHEMA  기본 pc_monitor (테이블이 위치할 스키마)
"""
from __future__ import annotations

import os
import re
from typing import List

import psycopg2

EMBED_DIM = 80

# vector 타입이 설치된 NCP 관리 스키마. search_path 후보에 포함(없으면 무시).
_VECTOR_SCHEMA = "cdb_admin"


def _schema() -> str:
    s = os.environ.get("RETRIEVAL_PG_SCHEMA", "pc_monitor")
    # SET search_path / 식별자에 직접 박으므로 단순 식별자만 허용(인젝션 방지).
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s):
        raise ValueError(f"invalid RETRIEVAL_PG_SCHEMA: {s!r}")
    return s


def _table() -> str:
    return f"{_schema()}.retrieval_segments"


def _dsn() -> str:
    return os.environ.get(
        "RETRIEVAL_PG_DSN",
        "postgresql://rada:rada_dev_pw@localhost:25432/pc_monitor",
    )


def _ddl(table: str) -> str:
    return f"""
CREATE TABLE IF NOT EXISTS {table} (
    id          BIGSERIAL PRIMARY KEY,
    segment_id  TEXT,
    pc_id       TEXT,
    slot        TEXT,
    embedding   vector({EMBED_DIM}),
    verdict     TEXT,
    score       REAL,
    start_ts    TEXT,
    end_ts      TEXT
);
CREATE INDEX IF NOT EXISTS idx_retr_slot ON {table} (slot);
CREATE INDEX IF NOT EXISTS idx_retr_emb_hnsw
    ON {table} USING hnsw (embedding vector_cosine_ops);
"""


_conn = None


def _connection():
    global _conn
    if _conn is None or _conn.closed:
        schema = _schema()
        table = _table()
        conn = psycopg2.connect(_dsn())
        conn.autocommit = True
        with conn.cursor() as cur:
            # vector 타입 해석을 위해 cdb_admin(NCP) 포함. 없는 스키마는 무시됨.
            cur.execute(
                f"SET search_path TO {schema}, {_VECTOR_SCHEMA}, public"
            )
            # extension: 이미 있으면(특히 NCP, 콘솔 설치) 아무것도 안 함.
            # 없을 때만 생성 시도(자체설치 PG). 권한/미가용으로 실패해도
            # 이후 CREATE TABLE 에서 분명한 에러가 나므로 여기선 조용히 통과.
            cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            if cur.fetchone() is None:
                try:
                    cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                except psycopg2.Error:
                    conn.rollback()
            cur.execute(_ddl(table))
        _conn = conn
    return _conn


def _vec_literal(embedding: List[float]) -> str:
    # pgvector 텍스트 리터럴: '[0.1,0.2,...]'
    return "[" + ",".join(f"{float(x):.6g}" for x in embedding) + "]"


def reset_store() -> None:
    with _connection().cursor() as cur:
        cur.execute(f"TRUNCATE {_table()}")


def add_segment(segment: dict, embedding: List[float],
                verdict: str, score: float) -> None:
    if not segment or not embedding:
        return
    slot = segment.get("slot") or "free"
    with _connection().cursor() as cur:
        cur.execute(
            f"""INSERT INTO {_table()}
                (segment_id, pc_id, slot, embedding, verdict, score, start_ts, end_ts)
                VALUES (%s,%s,%s,%s::vector,%s,%s,%s,%s)""",
            (
                segment.get("segment_id"),
                segment.get("pc_id"),
                slot,
                _vec_literal(embedding),
                verdict,
                float(score) if score is not None else 0.0,
                segment.get("start_ts"),
                segment.get("end_ts"),
            ),
        )


def search_similar(segment: dict, embedding: List[float],
                   top_k: int = 3) -> List[dict]:
    if not segment or not embedding:
        return []
    slot = segment.get("slot") or "free"
    self_id = segment.get("segment_id")
    self_end = segment.get("end_ts")
    vec = _vec_literal(embedding)
    with _connection().cursor() as cur:
        cur.execute(
            f"""SELECT segment_id, pc_id,
                       (embedding <=> %s::vector) AS distance,
                       verdict, score, start_ts, end_ts
                FROM {_table()}
                WHERE slot = %s
                  AND NOT (segment_id IS NOT DISTINCT FROM %s
                           AND end_ts IS NOT DISTINCT FROM %s)
                ORDER BY embedding <=> %s::vector
                LIMIT %s""",
            (vec, slot, self_id, self_end, vec, top_k),
        )
        rows = cur.fetchall()
    return [
        {
            "segment_id": r[0],
            "pc_id":      r[1],
            "distance":   round(float(r[2]), 4),
            "verdict":    r[3],
            "score":      r[4],
            "start_ts":   r[5],
            "end_ts":     r[6],
        }
        for r in rows
    ]


def clear_pc(pc_id: str) -> bool:
    with _connection().cursor() as cur:
        cur.execute(f"DELETE FROM {_table()} WHERE pc_id = %s", (pc_id,))
        return cur.rowcount > 0


def count() -> int:
    with _connection().cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {_table()}")
        return int(cur.fetchone()[0])
