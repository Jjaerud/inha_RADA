"""Retrieval-Augmented Time-Series Evidence Layer.

논문 적용 매뉴얼 7단계 구현. statistical embedding 기반 segment 검색.
"""
import os as _os

from .segment_builder import build_segment
from .segment_embedding import build_embedding

# 백엔드 선택(PoC): RETRIEVAL_BACKEND=pgvector 면 영속 pgvector store, 아니면
# 기존 in-memory store. 시그니처가 동일해 호출부(analyze_router 등)는 불변.
if _os.environ.get("RETRIEVAL_BACKEND", "").lower() == "pgvector":
    from .retrieval_store_pgvector import (
        add_segment,
        search_similar,
        clear_pc,
        reset_store,
    )
    segment_history_by_slot = {}  # pgvector 백엔드엔 없음(호환용 빈 dict)
else:
    from .retrieval_store import (
        add_segment,
        search_similar,
        clear_pc,
        reset_store,
        segment_history_by_slot,
    )
from .retrieval_evidence import build_retrieval_evidence

__all__ = [
    "build_segment",
    "build_embedding",
    "add_segment",
    "search_similar",
    "clear_pc",
    "reset_store",
    "segment_history_by_slot",
    "build_retrieval_evidence",
]
