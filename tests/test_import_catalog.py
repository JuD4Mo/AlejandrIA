from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import duckdb
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from data.import_catalog import FILES, prepare_sources, run_import, source_manifest


@pytest.fixture
def catalog_source(tmp_path: Path) -> Path:
    directory = tmp_path / "source"
    directory.mkdir()
    records = {
        "books": [
            {"book_id": "0001", "work_id": "w1", "title": "Known", "num_pages": 0, "publication_year": 0},
            {"book_id": "0002", "work_id": "w2", "title": "Other", "num_pages": 10, "publication_year": 2001, "description": "Description"},
            {"book_id": "0003", "work_id": "w3", "title": None},
            {"book_id": "0004", "work_id": "w4", "title": "Fourth"},
        ],
        "works": [{"work_id": "w1", "best_book_id": "0001"}, {"work_id": "w2", "best_book_id": "0002", "original_title": "Original work"}, {"work_id": "w3", "original_title": "Untitled edition's work"}, {"work_id": "w4", "best_book_id": "absent"}],
        "authors": [{"author_id": "a1", "name": "Source Author"}, {"author_id": "a2", "name": "Translator"}],
        "book_authors": [{"book_id": "0001", "author_id": "a1"}, {"book_id": "0002", "author_id": "a2", "role": "Translator"}, {"book_id": "0003", "author_id": "a1"}, {"book_id": "0004", "author_id": "a1"}],
        "book_genres": [{"book_id": "0001", "genre": "Fiction"}, {"book_id": "0001", "genre": "fiction"}, {"book_id": "0002", "genre": "poetry"}, {"book_id": "0004", "genre": "fantasy, paranormal"}],
        "book_source_genres": [{"book_id": f"000{i}", "source_genre": "poetry"} for i in range(1, 5)],
    }
    for name, columns in FILES.items():
        schema = pa.schema([(column, pa.string() if kind == "string" else pa.int32()) for column, kind in columns.items()])
        pq.write_table(pa.Table.from_pylist(records[name], schema=schema), directory / f"{name}.parquet")
    return directory


def test_source_transform_does_not_invent_titles_or_roles(catalog_source: Path) -> None:
    manifest = source_manifest(catalog_source)
    assert manifest["books"]["rows"] == 4
    with duckdb.connect() as db:
        quality = prepare_sources(db, catalog_source, None)
        assert quality["eligible_books"] == 3 and quality["omitted_book_ids"] == ["0003"]
        assert quality["nonpositive_pages_to_null"] == 1 and quality["invalid_years_to_null"] == 1
        assert db.execute("SELECT external_id,title FROM import_works ORDER BY external_id").fetchall() == [("w1", "Known"), ("w2", "Original work")]
        assert quality["work_titles_unavailable"] == 1
        assert db.execute("SELECT count(*) FROM import_genres").fetchone()[0] == 3


def test_schema_validation_rejects_wrong_id_type(catalog_source: Path) -> None:
    pq.write_table(pa.table({"book_id": [1]}), catalog_source / "books.parquet")
    with pytest.raises(ValueError, match="books.book_id"):
        source_manifest(catalog_source)


@pytest.mark.skipif(not os.getenv("CATALOG_TEST_DATABASE_URL"), reason="Requires a disposable schema-9 PostgreSQL database")
def test_import_resume_failure_idempotency_and_manual_preservation(catalog_source: Path, tmp_path: Path) -> None:
    dsn = os.environ["CATALOG_TEST_DATABASE_URL"]
    with psycopg.connect(dsn, autocommit=True) as connection:
        assert connection.info.dbname.startswith("test_")
        assert connection.execute("SELECT version FROM schema_version").fetchone()[0] == 9
        assert connection.execute("SELECT count(*) FROM books").fetchone()[0] == 0, "Use a dedicated empty test database"
        work = connection.execute("INSERT INTO works(title) VALUES('Curated work') RETURNING id").fetchone()[0]
        manual = connection.execute("INSERT INTO books(title) VALUES('Manual book') RETURNING id").fetchone()[0]
        curated = connection.execute("INSERT INTO books(title,goodreads_book_id,description,num_pages,work_id) VALUES('Curated title','0001','Keep this',100,%s) RETURNING id", (work,)).fetchone()[0]
        connection.execute("INSERT INTO book_copies(book_id,inventory_code) VALUES(%s,'PREEXISTING-COPY')", (curated,))
        author = connection.execute("INSERT INTO authors(name,goodreads_author_id) VALUES('Curated Author','a1') RETURNING id").fetchone()[0]
        connection.execute("INSERT INTO book_authors VALUES(%s,%s,'local_note')", (curated, author))
        connection.execute("INSERT INTO genres(name) VALUES('FICTION')")
        args = argparse.Namespace(dsn=dsn, processed_dir=catalog_source, batch_size=5000, max_books=None, memory_limit="512MB", temp_dir=tmp_path / "spill", state_file=tmp_path / "state.json", report=tmp_path / "report.json", restart=False, stop_after_batches=1)
        paused = run_import(args)
        assert paused["status"] == "interrupted"
        connection.execute("""CREATE FUNCTION test_import_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.goodreads_book_id='0004' THEN RAISE EXCEPTION 'synthetic import failure'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER test_import_fail BEFORE INSERT ON books FOR EACH ROW EXECUTE FUNCTION test_import_fail()""")
        args.stop_after_batches = None
        try:
            with pytest.raises(psycopg.Error):
                run_import(args)
            assert connection.execute("SELECT count(*) FROM books").fetchone()[0] == 2, "Partially committed book batch"
        finally:
            connection.execute("DROP TRIGGER test_import_fail ON books; DROP FUNCTION test_import_fail()")
        completed = run_import(args)
        assert completed["status"] == "completed"
        assert completed["after"]["books"] == 4 and completed["after"]["book_copies"] == 1
        assert connection.execute("SELECT title,description,num_pages,work_id FROM books WHERE id=%s", (curated,)).fetchone() == ("Curated title", "Keep this", 100, work)
        assert connection.execute("SELECT title FROM books WHERE id=%s", (manual,)).fetchone()[0] == "Manual book"
        assert connection.execute("SELECT name FROM authors WHERE id=%s", (author,)).fetchone()[0] == "Curated Author"
        assert connection.execute("SELECT count(*) FROM book_authors WHERE book_id=%s AND role='local_note'", (curated,)).fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM book_authors WHERE role='unspecified'").fetchone()[0] == 2
        assert connection.execute("SELECT work_id FROM books WHERE goodreads_book_id='0004'").fetchone()[0] is None
        args.restart = True
        repeated = run_import(args)
        assert repeated["after"] == completed["after"] and all(value == 0 for value in repeated["delta"].values())
        assert all(phase["affected"] == 0 for phase in repeated["phases"].values())
