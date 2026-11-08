from __future__ import annotations

import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.collaborative import MatrixFactorization, rating_metrics


def test_matrix_factorization_forward_and_metrics() -> None:
    model = MatrixFactorization(num_users=3, num_items=4, factors=5, global_mean=3.5)
    predictions = model(torch.tensor([0, 2]), torch.tensor([1, 3]))
    assert predictions.shape == (2,)
    metrics = rating_metrics(predictions, torch.tensor([3.0, 4.0]))
    assert set(metrics) == {"mae", "rmse"}
    assert metrics["rmse"] >= metrics["mae"] >= 0
