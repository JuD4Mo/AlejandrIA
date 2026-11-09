"""Importación explícita Parquet Goodreads -> catálogo PostgreSQL, sin ejemplares.

COPY por lotes a tablas temporales; commits independientes e idempotencia por IDs
externos. No procesa JSONL, usuarios, reviews, interacciones o artefactos ML.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import resource
import tempfile
import time
from pathlib import Path

import duckdb
import psycopg
import pyarrow.parquet as pq

LOGGER = logging.getLogger(__name__)
TRANSFORM_VERSION = 1
FILES = {
    "books": {"book_id": "string", "work_id": "string", "title": "string", "description": "string", "isbn": "string", "isbn13": "string", "language_code": "string", "publication_year": "int32", "num_pages": "int32", "image_url": "string"},
    "authors": {"author_id": "string", "name": "string"},
    "works": {"work_id": "string", "best_book_id": "string", "original_title": "string"},
    "book_authors": {"book_id": "string", "author_id": "string", "role": "string"},
    "book_genres": {"book_id": "string", "genre": "string"},
    "book_source_genres": {"book_id": "string", "source_genre": "string"},
}


def literal(value: str | Path) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def clean(column: str) -> str:
    """Elimina NUL, no representable en TEXT; blanco/ausencia se convierte a NULL."""
    return f"nullif(trim(replace({column},chr(0),'')),'')"


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def source_manifest(directory: Path) -> dict:
    manifest = {}
    for name, columns in FILES.items():
        path = directory / f"{name}.parquet"
        parquet = pq.ParquetFile(path)
        schema = parquet.schema_arrow
        for column, expected in columns.items():
            if column not in schema.names or str(schema.field(column).type) != expected:
                raise ValueError(f"Esquema inesperado: {name}.{column}, requerido {expected}")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        manifest[name] = {"sha256": digest.hexdigest(), "bytes": path.stat().st_size, "rows": parquet.metadata.num_rows}
    return manifest


def prepare_sources(db: duckdb.DuckDBPyConnection, directory: Path, max_books: int | None) -> dict:
    for name in FILES:
        db.read_parquet(str(directory / f"{name}.parquet")).create_view("raw_" + name)
    for table, key in (("books", "book_id"), ("authors", "author_id"), ("works", "work_id")):
        invalid, duplicates = db.execute(f"SELECT count(*) FILTER(WHERE {clean(key)} IS NULL OR {key}<>{clean(key)}), count({clean(key)})-count(DISTINCT {clean(key)}) FROM raw_{table}").fetchone()
        if invalid or duplicates:
            raise ValueError(f"IDs inválidos/duplicados en {table}: {invalid}/{duplicates}")
    if max_books is None:
        db.execute("CREATE TABLE selected_ids AS SELECT book_id FROM raw_books")
    else:
        # Round-robin por fuente: no selecciona solo las primeras filas de un género.
        db.execute(f"""CREATE TABLE selected_ids AS
            WITH ranked AS (
                SELECT book_id,source_genre,row_number() OVER(PARTITION BY source_genre ORDER BY hash(book_id),book_id) AS n
                FROM raw_book_source_genres
            ), candidates AS (
                SELECT book_id,min(n) AS priority,min(source_genre) AS source FROM ranked GROUP BY book_id
            ), edges AS (
                SELECT book_id FROM raw_books WHERE {clean('title')} IS NULL
            )
            SELECT book_id FROM (
                SELECT book_id,0 AS priority,'' AS source FROM edges
                UNION ALL SELECT book_id,priority,source FROM candidates WHERE book_id NOT IN (SELECT book_id FROM edges)
            ) ORDER BY priority,source,book_id LIMIT {int(max_books)}""")
    db.execute(f"""CREATE VIEW selected_books AS SELECT b.* FROM raw_books b JOIN selected_ids s USING(book_id) WHERE {clean('b.title')} IS NOT NULL""")
    db.execute(f"""CREATE VIEW import_works AS
        SELECT {clean('w.work_id')} AS external_id,
            coalesce({clean('w.original_title')},{clean('b.title')}) AS title
        FROM raw_works w LEFT JOIN raw_books b ON b.book_id=w.best_book_id AND b.work_id=w.work_id
        WHERE w.work_id IN (SELECT work_id FROM selected_books)
          AND coalesce({clean('w.original_title')},{clean('b.title')}) IS NOT NULL""")
    db.execute(f"""CREATE VIEW import_authors AS SELECT {clean('a.author_id')} AS external_id,{clean('a.name')} AS name
        FROM raw_authors a WHERE a.author_id IN (
            SELECT ba.author_id FROM raw_book_authors ba JOIN selected_books b USING(book_id)
        ) AND {clean('a.name')} IS NOT NULL""")
    db.execute(f"""CREATE VIEW import_genres AS SELECT DISTINCT lower({clean('g.genre')}) AS name
        FROM raw_book_genres g JOIN selected_books b USING(book_id) WHERE {clean('g.genre')} IS NOT NULL""")
    checks = {
        "selected_books": "SELECT count(*) FROM selected_ids",
        "eligible_books": "SELECT count(*) FROM selected_books",
        "books_without_title": f"SELECT count(*) FROM raw_books b JOIN selected_ids USING(book_id) WHERE {clean('title')} IS NULL",
        "books_without_description": f"SELECT count(*) FROM selected_books WHERE {clean('description')} IS NULL",
        "nonpositive_pages_to_null": "SELECT count(*) FROM selected_books WHERE num_pages<=0",
        "invalid_years_to_null": "SELECT count(*) FROM selected_books WHERE publication_year<=0 OR publication_year>9999",
        "work_titles_unavailable": "SELECT count(DISTINCT work_id) FROM selected_books WHERE work_id NOT IN(SELECT external_id FROM import_works)",
        "books_without_importable_work": "SELECT count(*) FROM selected_books WHERE work_id NOT IN(SELECT external_id FROM import_works)",
        "author_names_unavailable": f"SELECT count(*) FROM raw_authors a WHERE {clean('a.name')} IS NULL AND a.author_id IN(SELECT author_id FROM raw_book_authors JOIN selected_books USING(book_id))",
        "unspecified_author_roles": f"SELECT count(*) FROM raw_book_authors ba JOIN selected_books b USING(book_id) WHERE {clean('ba.role')} IS NULL",
        "orphan_author_links": "SELECT count(*) FROM raw_book_authors ba JOIN selected_books b USING(book_id) LEFT JOIN raw_authors a USING(author_id) WHERE a.author_id IS NULL",
        "orphan_work_links": "SELECT count(*) FROM selected_books b LEFT JOIN raw_works w USING(work_id) WHERE b.work_id IS NOT NULL AND w.work_id IS NULL",
        "orphan_relation_books": "SELECT (SELECT count(*) FROM raw_book_authors a LEFT JOIN raw_books b USING(book_id) WHERE b.book_id IS NULL)+(SELECT count(*) FROM raw_book_genres g LEFT JOIN raw_books b USING(book_id) WHERE b.book_id IS NULL)",
        "author_links_missing_name": f"SELECT count(*) FROM raw_book_authors ba JOIN selected_books b USING(book_id) JOIN raw_authors a USING(author_id) WHERE {clean('a.name')} IS NULL",
        "empty_genre_links": f"SELECT count(*) FROM raw_book_genres g JOIN selected_books b USING(book_id) WHERE {clean('g.genre')} IS NULL",
        "author_links_excluded_title": "SELECT count(*) FROM raw_book_authors ba JOIN selected_ids s USING(book_id) LEFT JOIN selected_books b USING(book_id) WHERE b.book_id IS NULL",
        "genre_links_excluded_title": "SELECT count(*) FROM raw_book_genres g JOIN selected_ids s USING(book_id) LEFT JOIN selected_books b USING(book_id) WHERE b.book_id IS NULL",
    }
    quality = {name: db.execute(query).fetchone()[0] for name, query in checks.items()}
    quality["sources"] = dict(db.execute("SELECT source_genre,count(*) FROM raw_book_source_genres JOIN selected_ids USING(book_id) GROUP BY source_genre ORDER BY source_genre").fetchall())
    quality["omitted_book_ids"] = [row[0] for row in db.execute(f"SELECT book_id FROM raw_books JOIN selected_ids USING(book_id) WHERE {clean('title')} IS NULL ORDER BY book_id LIMIT 100").fetchall()]
    if quality["orphan_author_links"] or quality["orphan_work_links"] or quality["orphan_relation_books"]:
        raise ValueError("Referencias huérfanas en el catálogo fuente; revisar calidad antes de importar")
    return quality


BOOK_COLUMNS = "external_id,work_external_id,title,description,isbn,isbn13,language_code,publication_year,num_pages,image_url"
PHASES = [
    ("genres", "SELECT name FROM import_genres ORDER BY name", "name TEXT", "name",
     "INSERT INTO genres(name) SELECT name FROM import_stage WHERE true ON CONFLICT (lower(btrim(name))) DO NOTHING"),
    ("works", "SELECT external_id,title FROM import_works ORDER BY external_id", "external_id TEXT,title TEXT", "external_id,title",
     "INSERT INTO works(goodreads_work_id,title) SELECT external_id,title FROM import_stage WHERE true ON CONFLICT(goodreads_work_id) DO NOTHING"),
    ("authors", "SELECT external_id,name FROM import_authors ORDER BY external_id", "external_id TEXT,name TEXT", "external_id,name",
     "INSERT INTO authors(goodreads_author_id,name) SELECT external_id,name FROM import_stage WHERE true ON CONFLICT(goodreads_author_id) DO NOTHING"),
    ("books", f"""SELECT {clean('book_id')},{clean('work_id')},{clean('title')},{clean('description')},{clean('isbn')},{clean('isbn13')},{clean('language_code')},
          CASE WHEN publication_year BETWEEN 1 AND 9999 THEN publication_year END,
          CASE WHEN num_pages>0 THEN num_pages END,{clean('image_url')}
          FROM selected_books ORDER BY book_id""",
     "external_id TEXT,work_external_id TEXT,title TEXT,description TEXT,isbn TEXT,isbn13 TEXT,language_code TEXT,publication_year INTEGER,num_pages INTEGER,image_url TEXT", BOOK_COLUMNS,
     """INSERT INTO books AS existing(goodreads_book_id,work_id,title,description,isbn,isbn13,language_code,publication_year,num_pages,image_url)
          SELECT s.external_id,w.id,s.title,s.description,s.isbn,s.isbn13,s.language_code,s.publication_year,s.num_pages,s.image_url
          FROM import_stage s LEFT JOIN works w ON w.goodreads_work_id=s.work_external_id
          WHERE true
          ON CONFLICT(goodreads_book_id) DO UPDATE SET
            work_id=coalesce(existing.work_id,excluded.work_id),description=coalesce(existing.description,excluded.description),
            isbn=coalesce(existing.isbn,excluded.isbn),isbn13=coalesce(existing.isbn13,excluded.isbn13),language_code=coalesce(existing.language_code,excluded.language_code),
            publication_year=coalesce(existing.publication_year,excluded.publication_year),num_pages=coalesce(existing.num_pages,excluded.num_pages),image_url=coalesce(existing.image_url,excluded.image_url)
          WHERE (existing.work_id IS NULL AND excluded.work_id IS NOT NULL) OR (existing.description IS NULL AND excluded.description IS NOT NULL)
             OR (existing.isbn IS NULL AND excluded.isbn IS NOT NULL) OR (existing.isbn13 IS NULL AND excluded.isbn13 IS NOT NULL)
             OR (existing.language_code IS NULL AND excluded.language_code IS NOT NULL) OR (existing.publication_year IS NULL AND excluded.publication_year IS NOT NULL)
             OR (existing.num_pages IS NULL AND excluded.num_pages IS NOT NULL) OR (existing.image_url IS NULL AND excluded.image_url IS NOT NULL)"""),
    ("book_authors", f"""SELECT DISTINCT {clean('ba.book_id')},{clean('ba.author_id')},coalesce({clean('ba.role')},'unspecified') AS role
        FROM raw_book_authors ba JOIN selected_books b USING(book_id) JOIN import_authors a ON a.external_id=ba.author_id
        ORDER BY 1,2,3""", "book_external_id TEXT,author_external_id TEXT,role TEXT", "book_external_id,author_external_id,role",
     """INSERT INTO book_authors(book_id,author_id,role)
          SELECT b.id,a.id,s.role FROM import_stage s JOIN books b ON b.goodreads_book_id=s.book_external_id JOIN authors a ON a.goodreads_author_id=s.author_external_id WHERE true
          ON CONFLICT(book_id,author_id,role) DO NOTHING"""),
    ("book_genres", f"""SELECT DISTINCT {clean('g.book_id')},lower({clean('g.genre')}) AS genre
        FROM raw_book_genres g JOIN selected_books b USING(book_id) WHERE {clean('g.genre')} IS NOT NULL ORDER BY 1,2""",
     "book_external_id TEXT,genre TEXT", "book_external_id,genre",
     """INSERT INTO book_genres(book_id,genre_id) SELECT b.id,g.id FROM import_stage s JOIN books b ON b.goodreads_book_id=s.book_external_id JOIN genres g ON lower(btrim(g.name))=s.genre WHERE true
          ON CONFLICT(book_id,genre_id) DO NOTHING"""),
]


def catalog_counts(connection: psycopg.Connection) -> dict:
    return {name: connection.execute(f"SELECT count(*) FROM {name}").fetchone()[0] for name in ("works", "authors", "books", "genres", "book_authors", "book_genres", "book_copies", "users", "loans", "reservations")}


def run_import(args: argparse.Namespace) -> dict:
    started = time.perf_counter()
    if args.batch_size < 1 or (args.max_books is not None and args.max_books < 6):
        raise ValueError("batch-size positivo y max-books >= 6")
    manifest = source_manifest(args.processed_dir)
    args.temp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="catalog_", dir=args.temp_dir) as workspace, psycopg.connect(args.dsn, autocommit=True) as connection:
        connection.execute("SET timezone='UTC'")
        connection.execute("SET lock_timeout='10s'")
        connection.execute("SET statement_timeout='120s'")
        connection.execute("SET work_mem='64MB'")
        if not connection.execute("SELECT pg_try_advisory_lock(764004)").fetchone()[0]:
            raise RuntimeError("Ya existe un importador activo en esta base")
        if connection.execute("SELECT version FROM schema_version").fetchone()[0] < 9:
            raise ValueError("Aplicar migración 009 antes de importar")
        database = connection.execute("SELECT current_database(),oid FROM pg_database WHERE datname=current_database()").fetchone()
        identity = {"database": database[0], "database_oid": database[1], "host": connection.info.host, "port": connection.info.port,
                    "manifest": manifest, "max_books": args.max_books, "batch_size": args.batch_size, "transform_version": TRANSFORM_VERSION}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        state = {"key": key, "identity": identity, "phases": {}}
        if args.state_file.exists() and not args.restart:
            state = json.loads(args.state_file.read_text(encoding="utf-8"))
            if state.get("key") != key:
                raise ValueError("Checkpoint pertenece a otra fuente/base/configuración; usar otro state-file o --restart")
        before = catalog_counts(connection)
        db = duckdb.connect(str(Path(workspace) / "import.duckdb"))
        try:
            db.execute(f"SET memory_limit={literal(args.memory_limit)}")
            db.execute("SET threads=4")
            db.execute(f"SET temp_directory={literal(Path(workspace) / 'spill')}")
            quality = prepare_sources(db, args.processed_dir, args.max_books)
            result = {"database": database[0], "source": manifest, "quality": quality, "before": before, "phases": {}, "status": "completed"}
            batches_this_run = 0
            for name, select, schema, columns, merge in PHASES:
                checkpoint = state["phases"].setdefault(name, {"batches": 0, "rows": 0, "affected": 0, "done": False})
                if checkpoint["done"]:
                    result["phases"][name] = {**checkpoint, "checkpoint_skipped": True}
                    continue
                LOGGER.info("Importando %s, retomando desde lote %s", name, checkpoint["batches"])
                cursor = db.execute(select)
                batch = 0
                phase_start = time.perf_counter()
                while rows := cursor.fetchmany(args.batch_size):
                    batch += 1
                    if batch <= checkpoint["batches"]:
                        continue
                    with connection.transaction():
                        connection.execute(f"CREATE TEMPORARY TABLE import_stage({schema}) ON COMMIT DROP")
                        with connection.cursor().copy(f"COPY import_stage({columns}) FROM STDIN") as copy:
                            for row in rows:
                                copy.write_row(row)
                        affected = connection.execute(merge).rowcount
                    checkpoint.update(batches=batch, rows=checkpoint["rows"] + len(rows), affected=checkpoint["affected"] + affected)
                    atomic_json(args.state_file, state)
                    batches_this_run += 1
                    if batch % 25 == 0:
                        LOGGER.info("%s: %s filas confirmadas", name, checkpoint["rows"])
                    if args.stop_after_batches and batches_this_run >= args.stop_after_batches:
                        result["status"] = "interrupted"
                        break
                if result["status"] != "interrupted":
                    checkpoint["done"] = True
                    atomic_json(args.state_file, state)
                result["phases"][name] = {**checkpoint, "seconds_this_run": time.perf_counter() - phase_start}
                LOGGER.info("%s: filas=%s, insertadas/completadas=%s", name, checkpoint["rows"], checkpoint["affected"])
                if result["status"] == "interrupted":
                    break
            if result["status"] == "completed":
                for table in ("works", "authors", "books", "genres", "book_authors", "book_genres"):
                    connection.execute(f"ANALYZE {table}")
            result.update(after=catalog_counts(connection), elapsed_seconds=time.perf_counter() - started,
                          peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
                          committed_batches_this_run=batches_this_run)
            result["delta"] = {key: result["after"][key] - before[key] for key in before}
            atomic_json(args.report, result)
            return result
        finally:
            db.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed_v2"))
    parser.add_argument("--dsn", default=os.environ.get("CATALOG_DATABASE_URL", ""), help="Preferir CATALOG_DATABASE_URL o variables PG* para no mostrar credenciales en argumentos")
    parser.add_argument("--max-books", type=int, help="Muestra determinista por las seis procedencias")
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--memory-limit", default="2GB")
    parser.add_argument("--temp-dir", type=Path, default=Path("data/duckdb_tmp_import"))
    parser.add_argument("--state-file", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--restart", action="store_true", help="Revisita todas las fases con UPSERT seguro; no borra tablas")
    parser.add_argument("--stop-after-batches", type=int, help="Pausa controlada para comprobar reanudación")
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    arguments = parse_args()
    try:
        output = run_import(arguments)
        print(json.dumps({key: output[key] for key in ("status", "after", "delta", "quality", "elapsed_seconds", "peak_rss_bytes")}, indent=2, ensure_ascii=False))
    except Exception as error:
        # El detalle COPY puede contener texto bibliográfico; nunca se registra DSN/password.
        detail = str(error) if isinstance(error, (ValueError, RuntimeError, FileNotFoundError)) else getattr(getattr(error, "diag", None), "message_primary", "Revisar la última fase registrada")
        failure = {"status": "failed", "error_type": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None), "detail": detail}
        atomic_json(arguments.report, failure)
        LOGGER.error("Importación detenida: %s (SQLSTATE=%s): %s. El último lote no confirmado se revierte; usar checkpoint para continuar.", type(error).__name__, getattr(error, "sqlstate", None), detail)
        raise SystemExit(1) from None
