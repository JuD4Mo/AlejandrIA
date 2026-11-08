from __future__ import annotations

import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.parquet_loader import ParquetBatchDataset, parquet_rating_mean
from ml.train_collaborative import run_training


def _write_partition(path: Path) -> None:
    table = pa.table(
        {
            "user_idx": list(range(10)),
            "book_idx": list(range(100, 110)),
            "rating": [float(index % 5 + 1) for index in range(10)],
        }
    )
    pq.write_table(table, path, row_group_size=3)


def _rows(dataset: ParquetBatchDataset, workers: int = 0) -> list[tuple[int, int, float]]:
    loader = DataLoader(dataset, batch_size=None, num_workers=workers)
    rows: list[tuple[int, int, float]] = []
    for users, books, ratings in loader:
        rows.extend(zip(users.tolist(), books.tolist(), ratings.tolist()))
    return rows


def test_parquet_batches_cover_each_record_once_and_are_reproducible(tmp_path: Path) -> None:
    path = tmp_path / "train.parquet"
    _write_partition(path)
    first = ParquetBatchDataset(path, batch_size=4, shuffle=True, seed=2026, epoch=1)
    second = ParquetBatchDataset(path, batch_size=4, shuffle=True, seed=2026, epoch=1)

    rows = _rows(first)
    assert rows == _rows(second)
    assert len(rows) == 10
    assert len(set(rows)) == 10
    assert {row[0] for row in rows} == set(range(10))
    assert parquet_rating_mean(path) == 3.0


def test_parquet_batches_shard_row_groups_across_workers_without_duplicates(tmp_path: Path) -> None:
    path = tmp_path / "train.parquet"
    _write_partition(path)
    dataset = ParquetBatchDataset(path, batch_size=4, shuffle=True, seed=2026, epoch=2)

    rows = _rows(dataset, workers=2)
    assert len(rows) == 10
    assert len(set(rows)) == 10
    assert {row[1] for row in rows} == set(range(100, 110))


def test_training_exports_loadable_best_checkpoint(tmp_path: Path) -> None:
    ml_dir = tmp_path / "ml"
    ml_dir.mkdir()
    interactions = pa.table(
        {
            "user_idx": [0, 0, 1, 1, 2, 2, 3, 3],
            "book_idx": [0, 1, 1, 2, 2, 3, 3, 0],
            "rating": [5.0, 4.0, 3.0, 4.0, 2.0, 5.0, 4.0, 3.0],
        }
    )
    pq.write_table(interactions, ml_dir / "train.parquet", row_group_size=3)
    pq.write_table(interactions, ml_dir / "valid.parquet", row_group_size=3)
    pq.write_table(pa.table({"user_id": ["u0", "u1", "u2", "u3"], "user_idx": [0, 1, 2, 3]}), ml_dir / "user_mapping.parquet")
    pq.write_table(pa.table({"book_id": ["b0", "b1", "b2", "b3"], "book_idx": [0, 1, 2, 3]}), ml_dir / "book_mapping.parquet")

    output = tmp_path / "artifacts"
    metrics = run_training(ml_dir, output, batch_size=4, max_epochs=2, patience=1, monitor_every=100)

    assert metrics["selection_split"] == "valid"
    assert (output / "best_model.pt").exists()
    assert (output / "loss_curve.png").exists()
    checkpoint = torch.load(output / "best_model.pt", map_location="cpu", weights_only=True)
    assert checkpoint["config"]["num_users"] == 4
    assert checkpoint["config"]["num_items"] == 4
