from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.recommendation import book_ids_for_indices, ranking_metrics, weighted_hybrid_score


def test_book_ids_are_resolved_by_explicit_index_not_row_order() -> None:
    mapping = pd.DataFrame({"book_id": ["b2", "b0", "b1"], "book_idx": [2, 0, 1]})
    assert book_ids_for_indices(mapping, np.array([0, 2, 1])).tolist() == ["b0", "b2", "b1"]


def test_ranking_metrics_uses_same_candidate_rows() -> None:
    candidates = pd.DataFrame({"user_idx": [0, 0, 0], "book_idx": [1, 2, 3], "relevant": [False, True, False], "score": [0.1, 0.9, 0.2]})
    per_user, metrics = ranking_metrics(candidates, "score", k=1)
    assert per_user.iloc[0]["rank"] == 1
    assert metrics == {"precision_at_k": 1.0, "recall_at_k": 1.0, "ndcg_at_k": 1.0}


def test_weighted_hybrid_score_validates_weight() -> None:
    assert weighted_hybrid_score(np.array([1.0]), np.array([0.0]), 0.25).tolist() == [0.25]
