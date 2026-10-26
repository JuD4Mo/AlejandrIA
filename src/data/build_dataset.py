"""Consolida subconjuntos Goodreads JSONL en tablas Parquet para el EDA.

El procesamiento se delega a DuckDB para evitar cargar los archivos JSONL
completos en memoria. Los archivos de ``data/raw`` se usan solamente en modo
lectura.
"""

from __future__ import annotations

import argparse
import csv
import logging
import shutil
import signal
import tempfile
from pathlib import Path
from typing import Iterable

import duckdb


LOGGER = logging.getLogger(__name__)


def sql_literal(value: Path | str) -> str:
    """Devuelve un literal SQL seguro para rutas locales controladas."""
    return "'" + str(value).replace("'", "''") + "'"


def discover_source_files(raw_dir: Path, genres: Iterable[str], kind: str) -> list[tuple[str, Path]]:
    """Encuentra un archivo por género mediante su sufijo, sin fijar carpetas."""
    files: list[tuple[str, Path]] = []
    for genre in genres:
        matches = sorted(raw_dir.rglob(f"goodreads_{kind}_{genre}.json"))
        if len(matches) != 1:
            raise FileNotFoundError(
                f"Se esperaba exactamente un archivo goodreads_{kind}_{genre}.json; "
                f"se encontraron {len(matches)} en {raw_dir}."
            )
        files.append((genre, matches[0]))
    return files


def metadata_file(raw_dir: Path, name: str) -> Path:
    matches = sorted(raw_dir.rglob(name))
    if len(matches) != 1:
        raise FileNotFoundError(f"Se esperaba exactamente un {name}; se encontraron {len(matches)}.")
    return matches[0]


def json_union_sql(files: list[tuple[str, Path]], sample_rows_per_source: int | None = None) -> str:
    """Construye una unión SQL que añade la procedencia de cada archivo JSONL."""
    limit = "" if sample_rows_per_source is None else f" LIMIT {sample_rows_per_source}"
    return " UNION ALL ".join(
        "(SELECT * FROM (SELECT *, "
        f"{sql_literal(genre)} AS source_genre, "
        f"{sql_literal(path.name)} AS source_file "
        f"FROM read_json_auto({sql_literal(path)}, format='newline_delimited', union_by_name=true)){limit})"
        for genre, path in files
    )


def copy_parquet(connection: duckdb.DuckDBPyConnection, table: str, output_dir: Path) -> None:
    path = output_dir / f"{table}.parquet"
    connection.execute(f"COPY {table} TO {sql_literal(path)} (FORMAT PARQUET, COMPRESSION ZSTD)")


def copy_query_parquet(connection: duckdb.DuckDBPyConnection, query: str, path: Path) -> None:
    """Escribe una consulta como Parquet sin materializarla como tabla DuckDB."""
    path.parent.mkdir(parents=True, exist_ok=True)
    connection.execute(f"COPY ({query}) TO {sql_literal(path)} (FORMAT PARQUET, COMPRESSION ZSTD)")


def parquet_scan_sql(paths: list[Path]) -> str:
    """Devuelve un escaneo Parquet para un lote de archivos ya normalizados."""
    if not paths:
        raise ValueError("Un lote de interacciones no puede estar vacío.")
    literals = ", ".join(sql_literal(path) for path in paths)
    return f"read_parquet([{literals}], union_by_name=true)"


def scalar(connection: duckdb.DuckDBPyConnection, query: str) -> int | float:
    return connection.execute(query).fetchone()[0]


def write_quality_report(connection: duckdb.DuckDBPyConnection, report_dir: Path) -> None:
    """Exporta métricas ligeras; los IDs de usuario nunca se incluyen en reportes."""
    metrics = {
        "books_input_rows": "SELECT count(*) FROM books_all",
        "books_unique": "SELECT count(*) FROM books",
        "books_with_description": "SELECT count(*) FROM books WHERE description IS NOT NULL AND trim(description) <> ''",
        "books_with_language": "SELECT count(*) FROM books WHERE language_code IS NOT NULL AND trim(language_code) <> ''",
        "books_with_authors": "SELECT count(DISTINCT book_id) FROM book_authors",
        "book_metadata_conflicts": "SELECT count(*) FROM book_metadata_conflicts",
        "interactions_input_rows": "SELECT interactions_input_rows FROM build_counts",
        "interactions_output_rows": "SELECT count(*) FROM interactions",
        "interactions_exact_duplicate_rows_deduplicated": "SELECT coalesce(sum(source_rows - 1), 0) FROM duplicate_audit WHERE duplicate_class = 'exact_duplicate'",
        "review_id_conflict_groups": "SELECT count(*) FROM duplicate_audit WHERE duplicate_class = 'conflicting_review_id'",
        "review_id_conflict_rows_preserved": "SELECT coalesce(sum(source_rows), 0) FROM duplicate_audit WHERE duplicate_class = 'conflicting_review_id'",
        "interactions_without_explicit_rating": "SELECT count(*) FROM interactions WHERE NOT has_explicit_rating",
        "interactions_with_explicit_rating": "SELECT count(*) FROM interactions WHERE has_explicit_rating",
        "interaction_book_orphans": "SELECT count(*) FROM interactions i LEFT JOIN books b USING (book_id) WHERE b.book_id IS NULL",
        "book_author_orphans": "SELECT count(*) FROM book_authors ba LEFT JOIN authors a USING (author_id) WHERE a.author_id IS NULL",
        "book_work_orphans": "SELECT count(*) FROM books b LEFT JOIN works w USING (work_id) WHERE b.work_id IS NOT NULL AND trim(b.work_id) <> '' AND w.work_id IS NULL",
        "source_genres": "SELECT count(DISTINCT source_genre) FROM book_source_genres",
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    with (report_dir / "quality_summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["metric", "value"])
        writer.writeheader()
        for name, query in metrics.items():
            writer.writerow({"metric": name, "value": scalar(connection, query)})
    connection.execute(
        f"COPY book_metadata_conflicts TO {sql_literal(report_dir / 'metadata_conflicts.csv')} "
        "(HEADER, DELIMITER ',')"
    )
    (report_dir / "preprocessing_recommendations.md").write_text(
        "# Recomendaciones de preprocesamiento\n\n"
        "Este reporte se genera durante la consolidación. No se ha eliminado ningún libro "
        "por faltantes, baja popularidad, ausencia de ISBN o valores atípicos. `rating = 0` "
        "permanece como interacción sin calificación explícita; para análisis de ratings use "
        "`has_explicit_rating` y `explicit_rating`. Las interacciones con distinto `review_id` "
        "para un mismo usuario y libro se conservaron para su análisis posterior. Las filas con "
        "un mismo `review_id` solo se consolidan cuando su payload es idéntico; variantes "
        "contradictorias se preservan y se clasifican en `duplicate_audit.parquet`.\n\n"
        "Antes de entrenar cualquier modelo, las decisiones de filtrado, definición de relevancia "
        "y partición temporal deben sustentarse en el notebook EDA y calcularse sin fuga de información.\n",
        encoding="utf-8",
    )


def build_dataset(
    raw_dir: Path,
    output_dir: Path,
    report_dir: Path,
    genres: list[str],
    *,
    memory_limit: str = "16GB",
    threads: int = 4,
    temp_dir: Path = Path("data/duckdb_tmp"),
    max_temp_gib: int = 300,
    output_reserve_gib: int = 30,
    interaction_buckets: int = 256,
    sample_rows_per_source: int | None = None,
) -> None:
    """Construye las tablas EDA a partir de los JSONL seleccionados."""
    raw_dir = raw_dir.resolve()
    if threads < 1:
        raise ValueError("threads debe ser mayor que cero.")
    if max_temp_gib < 1:
        raise ValueError("max_temp_gib debe ser mayor que cero.")
    if output_reserve_gib < 1:
        raise ValueError("output_reserve_gib debe ser mayor que cero.")
    if interaction_buckets < 2:
        raise ValueError("interaction_buckets debe ser al menos 2.")
    if sample_rows_per_source is not None and sample_rows_per_source < 1:
        raise ValueError("sample_rows_per_source debe ser mayor que cero.")
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.glob("*.parquet")):
        raise FileExistsError(f"El directorio de salida ya contiene Parquet: {output_dir}")
    book_files = discover_source_files(raw_dir, genres, "books")
    interaction_files = discover_source_files(raw_dir, genres, "interactions")
    authors_path = metadata_file(raw_dir, "goodreads_book_authors.json")
    genres_path = metadata_file(raw_dir, "goodreads_book_genres_initial.json")
    works_path = metadata_file(raw_dir, "goodreads_book_works.json")

    temp_dir = temp_dir.resolve()
    temp_dir.mkdir(parents=True, exist_ok=True)
    input_size_bytes = sum(path.stat().st_size for _, path in (*book_files, *interaction_files))
    # Cada fuente se normaliza una vez y luego se procesa por buckets de
    # review_id. Dos veces el tamaño fuente cubren staging, partes de salida y
    # consolidación final sin la copia global que provocaba el spill masivo.
    estimated_input_bytes = input_size_bytes if sample_rows_per_source is None else 1024**3
    estimated_workspace_bytes = (
        estimated_input_bytes * 2 + (10 + output_reserve_gib) * 1024**3
    )
    available_bytes = shutil.disk_usage(temp_dir).free
    if available_bytes < estimated_workspace_bytes:
        raise OSError(
            "Espacio insuficiente para una ejecución conservadora: "
            f"se estiman {estimated_workspace_bytes / 1024**3:.1f} GiB y hay "
            f"{available_bytes / 1024**3:.1f} GiB libres en {temp_dir}."
        )

    # El directorio de ejecución es propiedad exclusiva de esta corrida. DuckDB
    # puede derramar operadores pesados al disco sin usar el pequeño /tmp del sistema.
    run_dir = Path(tempfile.mkdtemp(prefix="goodreads_eda_", dir=temp_dir))
    spill_dir = run_dir / "spill"
    spill_dir.mkdir()
    database_path = run_dir / "build.duckdb"
    connection = duckdb.connect(database=str(database_path))
    previous_sigterm_handler = signal.getsignal(signal.SIGTERM)

    def interrupt_on_sigterm(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt("La ejecución recibió SIGTERM.")

    signal.signal(signal.SIGTERM, interrupt_on_sigterm)
    try:
        connection.execute(f"SET memory_limit = {sql_literal(memory_limit)}")
        connection.execute(f"SET threads = {threads}")
        connection.execute(f"SET temp_directory = {sql_literal(spill_dir)}")
        connection.execute(f"SET max_temp_directory_size = {sql_literal(f'{max_temp_gib}GiB')}")
        LOGGER.info(
            "Etapa 1/5: libros (%d géneros, límite de memoria %s, %d hilos)",
            len(genres), memory_limit, threads,
        )
        connection.execute(
            f"""
            CREATE TABLE books_all AS
            SELECT
                cast(book_id AS VARCHAR) AS book_id,
                nullif(cast(work_id AS VARCHAR), '') AS work_id,
                nullif(cast(title AS VARCHAR), '') AS title,
                nullif(cast(title_without_series AS VARCHAR), '') AS title_without_series,
                nullif(cast(description AS VARCHAR), '') AS description,
                nullif(cast(language_code AS VARCHAR), '') AS language_code,
                nullif(cast(isbn AS VARCHAR), '') AS isbn,
                nullif(cast(isbn13 AS VARCHAR), '') AS isbn13,
                nullif(cast(image_url AS VARCHAR), '') AS image_url,
                nullif(cast(url AS VARCHAR), '') AS url,
                nullif(cast(publisher AS VARCHAR), '') AS publisher,
                nullif(cast(format AS VARCHAR), '') AS format,
                try_cast(publication_year AS INTEGER) AS publication_year,
                try_cast(publication_month AS INTEGER) AS publication_month,
                try_cast(publication_day AS INTEGER) AS publication_day,
                try_cast(num_pages AS INTEGER) AS num_pages,
                try_cast(average_rating AS DOUBLE) AS average_rating,
                try_cast(ratings_count AS BIGINT) AS ratings_count,
                try_cast(text_reviews_count AS BIGINT) AS text_reviews_count,
                try_cast(is_ebook AS BOOLEAN) AS is_ebook,
                authors,
                source_genre,
                source_file
            FROM ({json_union_sql(book_files, sample_rows_per_source)}) AS raw_books
            WHERE book_id IS NOT NULL AND trim(cast(book_id AS VARCHAR)) <> ''
            """
        )
        connection.execute(
            """
            CREATE TABLE books AS
            SELECT * EXCLUDE (authors, source_genre, source_file, source_rank)
            FROM (
                SELECT *, row_number() OVER (PARTITION BY book_id ORDER BY source_genre, source_file) AS source_rank
                FROM books_all
            )
            WHERE source_rank = 1
            """
        )
        connection.execute(
            """
            CREATE TABLE book_source_genres AS
            SELECT DISTINCT book_id, source_genre, source_file
            FROM books_all
            """
        )
        connection.execute(
            """
            CREATE TABLE book_metadata_conflicts AS
            SELECT
                book_id,
                count(*) AS source_rows,
                count(DISTINCT coalesce(work_id, '')) AS distinct_work_ids,
                count(DISTINCT coalesce(title, '')) AS distinct_titles,
                string_agg(DISTINCT source_genre, '|') AS source_genres
            FROM books_all
            GROUP BY book_id
            HAVING count(DISTINCT coalesce(work_id, '')) > 1
                OR count(DISTINCT coalesce(title, '')) > 1
            """
        )
        connection.execute(
            """
            CREATE TABLE book_authors AS
            SELECT DISTINCT
                b.book_id,
                cast(author.author_id AS VARCHAR) AS author_id,
                nullif(cast(author.role AS VARCHAR), '') AS role
            FROM books_all b
            CROSS JOIN UNNEST(b.authors) AS authors(author)
            WHERE author.author_id IS NOT NULL AND trim(cast(author.author_id AS VARCHAR)) <> ''
            """
        )
        LOGGER.info("Etapa 2/5: metadatos globales filtrados al catálogo seleccionado")
        connection.execute(
            f"""
            CREATE TABLE authors AS
            SELECT
                cast(a.author_id AS VARCHAR) AS author_id,
                nullif(cast(a.name AS VARCHAR), '') AS name,
                try_cast(a.average_rating AS DOUBLE) AS average_rating,
                try_cast(a.ratings_count AS BIGINT) AS ratings_count,
                try_cast(a.text_reviews_count AS BIGINT) AS text_reviews_count
            FROM read_json_auto({sql_literal(authors_path)}, format='newline_delimited', union_by_name=true) a
            JOIN (SELECT DISTINCT author_id FROM book_authors) selected
              ON cast(a.author_id AS VARCHAR) = selected.author_id
            """
        )
        connection.execute(
            f"""
            CREATE TABLE works AS
            SELECT
                cast(w.work_id AS VARCHAR) AS work_id,
                nullif(cast(w.best_book_id AS VARCHAR), '') AS best_book_id,
                nullif(cast(w.original_title AS VARCHAR), '') AS original_title,
                nullif(cast(w.default_description_language_code AS VARCHAR), '') AS default_description_language_code,
                nullif(cast(w.media_type AS VARCHAR), '') AS media_type,
                try_cast(w.original_publication_year AS INTEGER) AS original_publication_year,
                try_cast(w.original_publication_month AS INTEGER) AS original_publication_month,
                try_cast(w.original_publication_day AS INTEGER) AS original_publication_day,
                try_cast(w.ratings_count AS BIGINT) AS ratings_count,
                try_cast(w.text_reviews_count AS BIGINT) AS text_reviews_count,
                try_cast(w.books_count AS BIGINT) AS books_count
            FROM read_json_auto({sql_literal(works_path)}, format='newline_delimited', union_by_name=true) w
            JOIN (SELECT DISTINCT work_id FROM books WHERE work_id IS NOT NULL) selected
              ON cast(w.work_id AS VARCHAR) = selected.work_id
            """
        )
        connection.execute(
            f"""
            CREATE TABLE book_genres AS
            SELECT
                cast(g.book_id AS VARCHAR) AS book_id,
                cast(genre.key AS VARCHAR) AS genre,
                try_cast(genre.value AS BIGINT) AS genre_weight,
                'goodreads_book_genres_initial' AS source
            FROM read_json(
                {sql_literal(genres_path)},
                columns = {{book_id: 'VARCHAR', genres: 'JSON'}},
                format='newline_delimited'
            ) g
            JOIN (SELECT book_id FROM books) selected ON cast(g.book_id AS VARCHAR) = selected.book_id
            CROSS JOIN json_each(g.genres) AS genre
            """
        )
        LOGGER.info("Etapa 3/5: normalizando interacciones por fuente y bucket")
        staging_dir = run_dir / "interaction_staging"
        staging_dir.mkdir()
        interaction_parts_dir = run_dir / "interaction_parts"
        source_parts_dir = run_dir / "interaction_source_parts"
        audit_parts_dir = run_dir / "duplicate_audit_parts"
        input_rows = 0
        for genre, path in interaction_files:
            source_dir = staging_dir / genre
            source_sql = f"""
                WITH normalized AS (
                    SELECT
                        row_number() OVER () AS source_row_number,
                        cast(user_id AS VARCHAR) AS user_id,
                        cast(book_id AS VARCHAR) AS book_id,
                        nullif(cast(review_id AS VARCHAR), '') AS review_id,
                        cast(is_read AS BOOLEAN) AS is_read,
                        try_cast(rating AS INTEGER) AS rating,
                        nullif(cast(date_added AS VARCHAR), '') AS date_added_raw,
                        nullif(cast(date_updated AS VARCHAR), '') AS date_updated_raw,
                        nullif(cast(read_at AS VARCHAR), '') AS read_at_raw,
                        nullif(cast(started_at AS VARCHAR), '') AS started_at_raw,
                        try_strptime(nullif(cast(date_added AS VARCHAR), ''), '%a %b %d %H:%M:%S %z %Y') AS date_added_utc,
                        try_strptime(nullif(cast(date_updated AS VARCHAR), ''), '%a %b %d %H:%M:%S %z %Y') AS date_updated_utc,
                        try_strptime(nullif(cast(read_at AS VARCHAR), ''), '%a %b %d %H:%M:%S %z %Y') AS read_at_utc,
                        try_strptime(nullif(cast(started_at AS VARCHAR), ''), '%a %b %d %H:%M:%S %z %Y') AS started_at_utc,
                        {sql_literal(genre)} AS source_genre,
                        {sql_literal(path.name)} AS source_file
                    FROM read_json_auto({sql_literal(path)}, format='newline_delimited', union_by_name=true)
                    WHERE user_id IS NOT NULL AND book_id IS NOT NULL
                    {"LIMIT " + str(sample_rows_per_source) if sample_rows_per_source is not None else ""}
                ), fingerprinted AS (
                    SELECT *, md5(concat_ws(
                        chr(31), user_id, book_id, coalesce(cast(is_read AS VARCHAR), ''),
                        coalesce(cast(rating AS VARCHAR), ''), coalesce(date_added_raw, ''),
                        coalesce(date_updated_raw, ''), coalesce(read_at_raw, ''), coalesce(started_at_raw, '')
                    )) AS payload_fingerprint
                    FROM normalized
                )
                SELECT *, cast(hash(coalesce(review_id, source_file || ':' || cast(source_row_number AS VARCHAR))) % {interaction_buckets} AS INTEGER) AS review_bucket
                FROM fingerprinted
            """
            connection.execute(
                f"COPY ({source_sql}) TO {sql_literal(source_dir)} "
                "(FORMAT PARQUET, COMPRESSION ZSTD, PARTITION_BY (review_bucket))"
            )
            input_rows += scalar(connection, f"SELECT count(*) FROM {parquet_scan_sql(list(source_dir.rglob('*.parquet')))}")

        bucket_files = {
            bucket: sorted(staging_dir.glob(f"*/review_bucket={bucket}/*.parquet"))
            for bucket in range(interaction_buckets)
        }
        bucket_files = {bucket: paths for bucket, paths in bucket_files.items() if paths}
        LOGGER.info("Etapa 4/5: auditando y deduplicando %d buckets", len(bucket_files))
        for bucket, paths in bucket_files.items():
            staged_scan = parquet_scan_sql(paths)
            audit_path = audit_parts_dir / f"bucket_{bucket}.parquet"
            copy_query_parquet(
                connection,
                f"""
                SELECT review_id, count(*) AS source_rows, count(DISTINCT payload_fingerprint) AS distinct_payloads,
                    CASE WHEN count(DISTINCT payload_fingerprint) = 1 THEN 'exact_duplicate' ELSE 'conflicting_review_id' END AS duplicate_class,
                    count(DISTINCT source_genre) AS source_genres, string_agg(DISTINCT source_file, '|') AS source_files
                FROM {staged_scan}
                WHERE review_id IS NOT NULL
                GROUP BY review_id
                HAVING count(*) > 1
                """,
                audit_path,
            )
            ranked_path = run_dir / "ranked" / f"bucket_{bucket}.parquet"
            copy_query_parquet(
                connection,
                f"""
                SELECT i.*, coalesce(a.duplicate_class, 'unique_review_id') AS duplicate_class,
                    CASE
                        WHEN i.review_id IS NULL THEN '__missing_review__' || i.source_file || '__' || cast(i.source_row_number AS VARCHAR)
                        WHEN a.duplicate_class = 'conflicting_review_id' THEN i.review_id || '__conflict__' || i.source_file || '__' || cast(i.source_row_number AS VARCHAR)
                        ELSE i.review_id
                    END AS interaction_id,
                    row_number() OVER (
                        PARTITION BY coalesce(i.review_id, '__missing_review__' || i.source_file || ':' || cast(i.source_row_number AS VARCHAR)), i.payload_fingerprint
                        ORDER BY i.source_genre, i.source_file, i.source_row_number
                    ) AS exact_duplicate_rank
                FROM {staged_scan} i
                LEFT JOIN {parquet_scan_sql([audit_path])} a USING (review_id)
                """,
                ranked_path,
            )
            ranked_scan = parquet_scan_sql([ranked_path])
            copy_query_parquet(
                connection,
                f"""SELECT interaction_id, user_id, book_id, review_id, is_read, rating,
                    rating BETWEEN 1 AND 5 AS has_explicit_rating,
                    CASE WHEN rating BETWEEN 1 AND 5 THEN rating ELSE NULL END AS explicit_rating,
                    date_added_raw, date_updated_raw, read_at_raw, started_at_raw,
                    date_added_utc, date_updated_utc, read_at_utc, started_at_utc
                FROM {ranked_scan}
                WHERE duplicate_class = 'conflicting_review_id' OR exact_duplicate_rank = 1""",
                interaction_parts_dir / f"bucket_{bucket}.parquet",
            )
            copy_query_parquet(
                connection,
                f"SELECT DISTINCT interaction_id, source_genre, source_file FROM {ranked_scan}",
                source_parts_dir / f"bucket_{bucket}.parquet",
            )
            ranked_path.unlink()

        interaction_part_files = sorted(interaction_parts_dir.glob("*.parquet"))
        source_part_files = sorted(source_parts_dir.glob("*.parquet"))
        audit_part_files = sorted(audit_parts_dir.glob("*.parquet"))
        copy_query_parquet(connection, f"SELECT * FROM {parquet_scan_sql(interaction_part_files)}", output_dir / "interactions.parquet")
        copy_query_parquet(connection, f"SELECT * FROM {parquet_scan_sql(source_part_files)}", output_dir / "interaction_source_genres.parquet")
        copy_query_parquet(connection, f"SELECT * FROM {parquet_scan_sql(audit_part_files)}", output_dir / "duplicate_audit.parquet")
        connection.execute(f"CREATE VIEW interactions AS SELECT * FROM {parquet_scan_sql([output_dir / 'interactions.parquet'])}")
        connection.execute(f"CREATE VIEW interaction_source_genres AS SELECT * FROM {parquet_scan_sql([output_dir / 'interaction_source_genres.parquet'])}")
        connection.execute(f"CREATE VIEW duplicate_audit AS SELECT * FROM {parquet_scan_sql([output_dir / 'duplicate_audit.parquet'])}")
        connection.execute(f"CREATE TABLE build_counts AS SELECT {input_rows} AS interactions_input_rows")
        shutil.rmtree(staging_dir)
        shutil.rmtree(interaction_parts_dir)
        shutil.rmtree(source_parts_dir)
        shutil.rmtree(audit_parts_dir)
        LOGGER.info("Etapa 4/5: exportando tablas Parquet")
        for table in (
            "books", "book_source_genres", "authors", "book_authors", "book_genres", "works",
        ):
            copy_parquet(connection, table, output_dir)
        LOGGER.info("Etapa 5/5: generando reporte de calidad")
        write_quality_report(connection, report_dir)
        LOGGER.info("Tablas Parquet escritas en %s", output_dir)
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm_handler)
        connection.close()
        shutil.rmtree(run_dir, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--report-dir", type=Path, default=Path("data/reports"))
    parser.add_argument("--genres", nargs="+", default=["poetry", "comics_graphic"])
    parser.add_argument("--memory-limit", default="16GB")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--temp-dir", type=Path, default=Path("data/duckdb_tmp"))
    parser.add_argument("--max-temp-gib", type=int, default=300)
    parser.add_argument("--output-reserve-gib", type=int, default=30)
    parser.add_argument("--interaction-buckets", type=int, default=256)
    parser.add_argument(
        "--sample-rows-per-source",
        type=int,
        help="Limita cada archivo de libros e interacciones para un smoke test reproducible.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    arguments = parse_args()
    build_dataset(
        arguments.raw_dir,
        arguments.output_dir,
        arguments.report_dir,
        arguments.genres,
        memory_limit=arguments.memory_limit,
        threads=arguments.threads,
        temp_dir=arguments.temp_dir,
        max_temp_gib=arguments.max_temp_gib,
        output_reserve_gib=arguments.output_reserve_gib,
        interaction_buckets=arguments.interaction_buckets,
        sample_rows_per_source=arguments.sample_rows_per_source,
    )
