from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.collaborative import MatrixFactorization
from ml.validate_full_catalog import evaluate_validation_catalogs


def test_validation_reports_separate_catalog_universes() -> None:
    train = pd.DataFrame({"user_idx": [0], "book_idx": [0], "rating": [5.0]})
    valid = pd.DataFrame({"user_idx": [0], "book_idx": [1], "rating": [5.0]})
    matrix = sp.csr_matrix(np.eye(4, dtype=np.float32))
    model = MatrixFactorization(1, 3, 2, 3.0)
    calibration, selected = evaluate_validation_catalogs(
        train, valid, matrix, np.array([0, 1, 2]), model, torch.device("cpu"), np.array([3, 2, 1]),
        seed=1, max_users=1, k=1, weights=[0.0, 0.5, 1.0],
    )
    assert set(calibration.candidate_universe) == {"full_collaborative_eligible_catalog", "full_content_catalog"}
    assert calibration.loc[calibration.candidate_universe.eq("full_collaborative_eligible_catalog"), "catalog_coverage"].eq(0.75).all()
    assert set(selected[selected.model.eq("hybrid")].content_weight) <= {0.0, 0.5, 1.0}
