from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ml.prepare_training import prepare_training


def test_temporal_split_uses_latest_pair_and_has_no_pair_overlap(tmp_path: Path) -> None:
    processed = tmp_path / "processed"
    processed.mkdir()
    rows = []
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    for user in range(5):
        for book in range(5):
            date = start + timedelta(days=(book + user) % 5)
            rows.append((f"r-{user}-{book}", f"u{user}", f"b{book}", 1 + (book % 5), True, date, date))
    # La revisión más reciente para esta pareja debe sustituir a la anterior.
    rows.append(("r-newer", "u0", "b0", 5, True, start + timedelta(days=10), start + timedelta(days=10)))
    rows.append(("r-zero", "u0", "b0", 0, False, start + timedelta(days=11), start + timedelta(days=11)))
    connection = duckdb.connect()
    try:
        connection.execute(
            "CREATE TABLE interactions(interaction_id VARCHAR, user_id VARCHAR, book_id VARCHAR, rating INTEGER, has_explicit_rating BOOLEAN, date_added_utc TIMESTAMPTZ, date_updated_utc TIMESTAMPTZ)"
        )
        connection.executemany("INSERT INTO interactions VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        connection.execute(f"COPY interactions TO '{processed / 'interactions.parquet'}' (FORMAT PARQUET)")
    finally:
        connection.close()

    summary = prepare_training(processed, tmp_path / "ml", min_user_interactions=5, min_item_interactions=3)
    connection = duckdb.connect()
    try:
        train = tmp_path / "ml" / "train.parquet"
        valid = tmp_path / "ml" / "valid.parquet"
        test = tmp_path / "ml" / "test.parquet"
        overlap = connection.execute(
            f"""SELECT count(*) FROM (
                SELECT user_idx, book_idx FROM read_parquet('{train}')
                INTERSECT SELECT user_idx, book_idx FROM read_parquet('{valid}')
                UNION ALL
                SELECT user_idx, book_idx FROM read_parquet('{train}')
                INTERSECT SELECT user_idx, book_idx FROM read_parquet('{test}')
            )"""
        ).fetchone()[0]
        assert overlap == 0
        assert summary["rows_removed_repeated_user_book"] == 1
        assert summary["train_rows"] > 0
        assert summary["valid_rows"] > 0
        assert summary["test_rows"] > 0
        assert summary["train_users"] == 5
        assert summary["core_iterations"] >= 1
        assert (tmp_path / "ml" / "activity_distribution_before_core.csv").exists()
    finally:
        connection.close()
