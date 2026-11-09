"""Auditoría completa Parquet/PostgreSQL. Solo lectura en PostgreSQL operativo.

Exporta filas por cursor a un DuckDB temporal y compara valores/conjuntos completos,
no solo conteos. Los artefactos y Parquet originales nunca se modifican.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import tempfile
import time
from pathlib import Path

import duckdb
import psycopg
import pyarrow as pa

from import_catalog import PHASES, atomic_json, prepare_sources, source_manifest


OPERATIONAL = {
    "users": "id", "roles": "id", "user_roles": "user_id,role_id",
    "book_copies": "id", "loan_requests": "id", "loans": "id",
    "loan_renewals": "id", "reservations": "id",
    "user_genre_preferences": "user_id,genre_id", "book_ratings": "user_id,book_id",
    "user_book_interactions": "id",
}


def operational_snapshot(conn):
    result = {}
    for table, order in OPERATIONAL.items():
        count, digest = conn.execute(f"SELECT count(*),md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY {order})::text,'[]')) FROM {table} t").fetchone()
        result[table] = {"count": count, "digest": digest}
    return result


def compare_books(db, buckets=32):
    """Igualdad exacta por clave única, particionada para no hashear todo el texto.

    hash solo decide el bucket; las comparaciones usan IS DISTINCT FROM sobre los
    valores originales, no igualdad de hashes del contenido.
    """
    columns = PHASES[3][3].split(",")[1:]
    fields = {column: 0 for column in columns}
    missing = extra = changed = 0
    both = "e.external_id IS NOT NULL AND a.external_id IS NOT NULL"
    different = " OR ".join(f"e.{column} IS DISTINCT FROM a.{column}" for column in columns)
    per_field = ",".join(f"count(*) FILTER(WHERE {both} AND e.{column} IS DISTINCT FROM a.{column})" for column in columns)
    for bucket in range(buckets):
        row = db.execute(f"""SELECT count(*) FILTER(WHERE a.external_id IS NULL),
            count(*) FILTER(WHERE e.external_id IS NULL),count(*) FILTER(WHERE {both} AND ({different})),{per_field}
            FROM (SELECT * FROM expected_books WHERE hash(external_id)%{buckets}={bucket}) e
            FULL JOIN (SELECT * FROM actual_books WHERE hash(external_id)%{buckets}={bucket}) a USING(external_id)""").fetchone()
        missing += row[0]; extra += row[1]; changed += row[2]
        for column, count in zip(columns, row[3:]):
            fields[column] += count
    return missing + changed, extra + changed, fields


def snapshot(args):
    with psycopg.connect(os.getenv("CATALOG_DATABASE_URL", "")) as conn:
        conn.read_only = True
        result = {"database": conn.info.dbname, "operational": operational_snapshot(conn)}
        if args.compare_baseline:
            baseline = json.loads(args.compare_baseline.read_text(encoding="utf-8"))
            if baseline["database"] != conn.info.dbname:
                raise ValueError("Baseline belongs to another database")
            result["baseline_comparison"] = {}
            for table, order in OPERATIONAL.items():
                old = baseline["operational"][table]
                digest = conn.execute(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY {order})::text,'[]')) FROM(SELECT * FROM {table} ORDER BY {order} LIMIT %s) t",(old["count"],)).fetchone()[0]
                result["baseline_comparison"][table] = {"before":old["count"],"after":result["operational"][table]["count"],"original_ordered_prefix_preserved":digest==old["digest"]}
        atomic_json(args.report, result)
        print(json.dumps({"database": result["database"], "counts": {k: v["count"] for k, v in result["operational"].items()}}, indent=2))


def audit(args):
    started = time.perf_counter()
    args.temp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="audit_", dir=args.temp_dir) as workspace, psycopg.connect(os.getenv("CATALOG_DATABASE_URL", "")) as conn:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        baseline = operational_snapshot(conn)
        manifest = source_manifest(args.processed_dir)
        with duckdb.connect(str(Path(workspace) / "audit.duckdb")) as db:
            db.execute("SET memory_limit='2GB'")
            db.execute("SET threads=4")
            db.execute("SET temp_directory='" + str(Path(workspace) / "spill").replace("'", "''") + "'")
            quality = prepare_sources(db, args.processed_dir, None)
            exports = {
                "books": ("SELECT b.goodreads_book_id,w.goodreads_work_id,b.title,b.description,b.isbn,b.isbn13,b.language_code,b.publication_year,b.num_pages,b.image_url FROM books b LEFT JOIN works w ON w.id=b.work_id WHERE b.goodreads_book_id IS NOT NULL", PHASES[3][2]),
                "works": ("SELECT goodreads_work_id,title FROM works WHERE goodreads_work_id IS NOT NULL", PHASES[1][2]),
                "authors": ("SELECT goodreads_author_id,name FROM authors WHERE goodreads_author_id IS NOT NULL", PHASES[2][2]),
                "genres": ("SELECT lower(btrim(name)) FROM genres", PHASES[0][2]),
                "book_authors": ("SELECT b.goodreads_book_id,a.goodreads_author_id,ba.role FROM book_authors ba JOIN books b ON b.id=ba.book_id JOIN authors a ON a.id=ba.author_id WHERE b.goodreads_book_id IS NOT NULL AND a.goodreads_author_id IS NOT NULL", PHASES[4][2]),
                "book_genres": ("SELECT b.goodreads_book_id,lower(btrim(g.name)) FROM book_genres bg JOIN books b ON b.id=bg.book_id JOIN genres g ON g.id=bg.genre_id WHERE b.goodreads_book_id IS NOT NULL", PHASES[5][2]),
            }
            comparison = {}
            fields = {}
            for name, select, _, columns, _ in PHASES:
                query, ddl = exports[name]
                phase_start = time.perf_counter()
                db.execute(f"CREATE TABLE actual_{name}({ddl})")
                names = columns.split(",")
                arrow_schema = pa.schema([(column, pa.int64() if column in {"publication_year", "num_pages"} else pa.string()) for column in names])
                with conn.cursor(name="audit_" + name) as cursor:
                    cursor.execute(query)
                    while rows := cursor.fetchmany(10000):
                        batch = pa.Table.from_arrays([pa.array(values, type=field.type) for values, field in zip(zip(*rows), arrow_schema)], schema=arrow_schema)
                        db.register("audit_batch", batch)
                        db.execute(f"INSERT INTO actual_{name} SELECT * FROM audit_batch")
                        db.unregister("audit_batch")
                if name == "books":
                    projection = select.rsplit("ORDER BY book_id",1)[0]
                    expected = f"WITH s({columns}) AS NOT MATERIALIZED ({projection}) SELECT s.external_id,w.external_id AS work_external_id,s.* EXCLUDE(external_id,work_external_id) FROM s LEFT JOIN import_works w ON w.external_id=s.work_external_id"
                else:
                    expected = select
                db.execute(f"CREATE VIEW expected_{name} AS {expected}")
                if name == "books":
                    missing, unexpected, fields = compare_books(db)
                else:
                    missing = db.execute(f"SELECT count(*) FROM(SELECT * FROM expected_{name} EXCEPT ALL SELECT * FROM actual_{name})").fetchone()[0]
                    unexpected = db.execute(f"SELECT count(*) FROM(SELECT * FROM actual_{name} EXCEPT ALL SELECT * FROM expected_{name})").fetchone()[0]
                comparison[name] = {"expected": db.execute(f"SELECT count(*) FROM expected_{name}").fetchone()[0], "actual": db.execute(f"SELECT count(*) FROM actual_{name}").fetchone()[0], "missing_or_changed_rows": missing, "extra_or_changed_rows": unexpected, "seconds": time.perf_counter() - phase_start}
                print(json.dumps({"table": name, **comparison[name]}), flush=True)
            counts = {table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in ("books", "authors", "works", "genres", "book_authors", "book_genres")}
            nulls = conn.execute("SELECT count(*) FILTER(WHERE description IS NULL),count(*) FILTER(WHERE isbn IS NULL),count(*) FILTER(WHERE isbn13 IS NULL),count(*) FILTER(WHERE language_code IS NULL),count(*) FILTER(WHERE publication_year IS NULL),count(*) FILTER(WHERE num_pages IS NULL),count(*) FILTER(WHERE image_url IS NULL),count(*) FILTER(WHERE work_id IS NULL) FROM books").fetchone()
            duplicates = conn.execute("SELECT count(*) FROM(SELECT goodreads_book_id FROM books WHERE goodreads_book_id IS NOT NULL GROUP BY goodreads_book_id HAVING count(*)>1) d").fetchone()[0]
            fk_issues = conn.execute("SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND NOT convalidated").fetchone()[0]
            table_sizes = [dict(zip(("table", "total_bytes", "data_bytes", "index_bytes"), row)) for row in conn.execute("SELECT relname,pg_total_relation_size(relid),pg_table_size(relid),pg_indexes_size(relid) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC")]
            result = {"database": conn.info.dbname, "read_only": conn.execute("SHOW transaction_read_only").fetchone()[0], "schema_version": conn.execute("SELECT version FROM schema_version").fetchone()[0], "source": manifest, "quality": quality, "comparison": comparison, "book_field_mismatches": fields, "counts": counts, "nulls": dict(zip(("description", "isbn", "isbn13", "language_code", "publication_year", "num_pages", "image_url", "work_id"), nulls)), "duplicate_goodreads_ids": duplicates, "unvalidated_foreign_keys": fk_issues, "table_sizes": table_sizes, "database_bytes": conn.execute("SELECT pg_database_size(current_database())").fetchone()[0], "operational": baseline, "elapsed_seconds": time.perf_counter() - started, "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024}
            result["exact_source_match"] = duplicates == 0 and all(row["expected"] == row["actual"] and row["missing_or_changed_rows"] == row["extra_or_changed_rows"] == 0 for row in comparison.values())
            atomic_json(args.report, result)
            print(json.dumps({"exact_source_match": result["exact_source_match"], "elapsed_seconds": result["elapsed_seconds"], "book_field_mismatches": fields}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-only", action="store_true")
    parser.add_argument("--compare-baseline",type=Path)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed_v2"))
    parser.add_argument("--temp-dir", type=Path, default=Path("data/duckdb_tmp_audit"))
    parser.add_argument("--report", type=Path, required=True)
    arguments = parser.parse_args()
    snapshot(arguments) if arguments.snapshot_only else audit(arguments)
