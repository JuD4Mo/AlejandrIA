from __future__ import annotations

import shutil
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from data.build_dataset import build_dataset


FIXTURE_RAW = Path(__file__).parent / "fixtures" / "raw"


def parquet_rows(path: Path, table: str) -> list[tuple]:
    connection = duckdb.connect()
    try:
        return connection.execute(f"SELECT * FROM read_parquet('{path}') ORDER BY {table}").fetchall()
    finally:
        connection.close()


def test_build_dataset_detects_cross_batch_duplicates_and_preserves_auditability(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw"
    shutil.copytree(FIXTURE_RAW, raw_dir)
    output_dir = tmp_path / "processed"
    report_dir = tmp_path / "reports"

    # r1 aparece en los dos archivos fuente y debe encontrarse aunque cada
    # archivo se normalice como un lote distinto antes de particionar por hash.
    build_dataset(
        raw_dir,
        output_dir,
        report_dir,
        ["poetry", "comics_graphic"],
        interaction_buckets=2,
    )

    connection = duckdb.connect()
    try:
        books = connection.execute(f"SELECT book_id FROM read_parquet('{output_dir / 'books.parquet'}') ORDER BY book_id").fetchall()
        assert books == [("001",), ("002",), ("003",)]
        source_rows = connection.execute(
            f"SELECT source_genre FROM read_parquet('{output_dir / 'book_source_genres.parquet'}') WHERE book_id = '001' ORDER BY source_genre"
        ).fetchall()
        assert source_rows == [("comics_graphic",), ("poetry",)]
        interactions = connection.execute(
            f"""SELECT review_id, rating, has_explicit_rating, explicit_rating
            FROM read_parquet('{output_dir / 'interactions.parquet'}')
            WHERE user_id = 'u1' ORDER BY review_id"""
        ).fetchall()
        assert interactions == [("r1", 0, False, None), ("r2", 5, True, 5)]
        audit = connection.execute(
            f"SELECT review_id, duplicate_class FROM read_parquet('{output_dir / 'duplicate_audit.parquet'}') ORDER BY review_id"
        ).fetchall()
        assert audit == [("r1", "exact_duplicate"), ("r_conflict", "conflicting_review_id")]
        assert connection.execute(
            f"SELECT count(*) FROM read_parquet('{output_dir / 'interaction_source_genres.parquet'}') WHERE interaction_id = 'r1'"
        ).fetchone()[0] == 2
        assert connection.execute(
            f"SELECT count(*) FROM read_parquet('{output_dir / 'interactions.parquet'}') WHERE review_id = 'r_conflict'"
        ).fetchone()[0] == 2
        assert connection.execute(
            f"SELECT role FROM read_parquet('{output_dir / 'book_authors.parquet'}') WHERE book_id = '001' AND author_id = 'a2'"
        ).fetchone() == ("Illustrator",)
    finally:
        connection.close()

    report = (report_dir / "quality_summary.csv").read_text(encoding="utf-8")
    assert "interaction_book_orphans,1" in report
    assert "book_author_orphans,1" in report
    assert "book_work_orphans,1" in report
