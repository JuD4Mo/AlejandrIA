"""Prepara particiones temporales de ratings explícitos para factorización matricial.

No modifica ``data/processed``. La última interacción explícita por pareja
usuario-libro, ordenada por ``date_added_utc`` y desempates deterministas, es
la única utilizada para entrenamiento. ``date_added`` representa incorporación
y no lectura; por ello la partición temporal es un protocolo inicial auditable.
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import signal
import tempfile
from pathlib import Path

import duckdb


LOGGER = logging.getLogger(__name__)


def _literal(path: Path | str) -> str:
    return "'" + str(path).replace("'", "''") + "'"


def _count(connection: duckdb.DuckDBPyConnection, table: str) -> int:
    return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def _copy_query(connection: duckdb.DuckDBPyConnection, query: str, path: Path, header: bool = False) -> None:
    """Exporta una consulta sin mover sus resultados a pandas."""
    path.parent.mkdir(parents=True, exist_ok=True)
    options = "(HEADER, DELIMITER ',')" if header else "(FORMAT PARQUET, COMPRESSION ZSTD)"
    connection.execute(f"COPY ({query}) TO {_literal(path)} {options}")


def _activity_stats(connection: duckdb.DuckDBPyConnection, table: str, entity: str) -> dict[str, float | int]:
    row = connection.execute(
        f"""
        SELECT count(*) AS entities, sum(activity_count) AS rows,
               min(activity_count) AS min_count, max(activity_count) AS max_count,
               approx_quantile(activity_count, 0.5) AS median_count,
               approx_quantile(activity_count, 0.95) AS p95_count,
               approx_quantile(activity_count, 0.99) AS p99_count
        FROM (SELECT {entity}, count(*) AS activity_count FROM {table} GROUP BY {entity})
        """
    ).fetchone()
    keys = ("entities", "rows", "min_count", "max_count", "median_count", "p95_count", "p99_count")
    return {key: (int(value) if key in {"entities", "rows", "min_count", "max_count"} else float(value)) for key, value in zip(keys, row)}


def prepare_training(
    processed_dir: Path,
    output_dir: Path,
    min_user_interactions: int = 5,
    min_item_interactions: int = 5,
    seed: int = 2026,
    *,
    memory_limit: str = "16GB",
    threads: int = 4,
    temp_dir: Path = Path("data/duckdb_ml_tmp"),
    max_temp_gib: int = 200,
) -> dict[str, int | float | str]:
    """Crea train/valid/test y mapeos consecutivos para ``torch.nn.Embedding``.

    El núcleo usuario-ítem se poda iterativamente, para que ambos umbrales se
    cumplan de forma simultánea. Como se aplica antes de la partición, conoce
    actividad retenida para evaluación: asegura mapeos entrenables, pero
    selecciona una población sobreviviente y no reproduce por completo nuevos
    usuarios o libros futuros. Por usuario, la observación más reciente va a
    prueba, la segunda a validación y las restantes a entrenamiento. Las filas
    de evaluación con ítems ausentes de entrenamiento se descartan y registran.
    """
    if min_user_interactions < 3:
        raise ValueError("min_user_interactions debe ser al menos 3 para conservar entrenamiento, validación y prueba.")
    if min_item_interactions < 1:
        raise ValueError("min_item_interactions debe ser positivo.")
    if threads < 1:
        raise ValueError("threads debe ser mayor que cero.")
    if max_temp_gib < 1:
        raise ValueError("max_temp_gib debe ser mayor que cero.")
    interactions_path = processed_dir / "interactions.parquet"
    if not interactions_path.exists():
        raise FileNotFoundError(f"No existe {interactions_path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.glob("*.parquet")):
        raise FileExistsError(f"El directorio de salida ya contiene Parquet: {output_dir}")

    temp_dir = temp_dir.resolve()
    temp_dir.mkdir(parents=True, exist_ok=True)
    available_bytes = shutil.disk_usage(temp_dir).free
    estimated_workspace_bytes = interactions_path.stat().st_size * 5 + 20 * 1024**3
    if available_bytes < estimated_workspace_bytes:
        raise OSError(
            "Espacio insuficiente para la preparación ML: "
            f"se estiman {estimated_workspace_bytes / 1024**3:.1f} GiB y hay "
            f"{available_bytes / 1024**3:.1f} GiB libres en {temp_dir}."
        )
    run_dir = Path(tempfile.mkdtemp(prefix="goodreads_ml_", dir=temp_dir))
    spill_dir = run_dir / "spill"
    spill_dir.mkdir()
    database_path = run_dir / "prepare_training.duckdb"
    connection = duckdb.connect(str(database_path))
    previous_sigterm_handler = signal.getsignal(signal.SIGTERM)

    def interrupt_on_sigterm(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt("La preparación ML recibió SIGTERM.")

    signal.signal(signal.SIGTERM, interrupt_on_sigterm)
    try:
        connection.execute(f"SET memory_limit = {_literal(memory_limit)}")
        connection.execute(f"SET threads = {threads}")
        connection.execute(f"SET temp_directory = {_literal(spill_dir)}")
        connection.execute(f"SET max_temp_directory_size = {_literal(f'{max_temp_gib}GiB')}")
        LOGGER.info("Etapa 1/5: filtrando ratings explícitos con fecha de incorporación")
        connection.execute(
            f"""
            CREATE TABLE explicit_input AS
            SELECT interaction_id, user_id, book_id, rating, date_added_utc, date_updated_utc
            FROM read_parquet({_literal(interactions_path)})
            WHERE has_explicit_rating AND rating BETWEEN 1 AND 5 AND date_added_utc IS NOT NULL
            """
        )
        explicit_rows = _count(connection, "explicit_input")
        # Las tablas ligeras permiten inspeccionar actividad sin conservar IDs en el resumen JSON.
        _copy_query(
            connection,
            """SELECT 'before_pair_resolution' AS stage, 'user' AS entity, activity_count, count(*) AS entities
               FROM (SELECT user_id, count(*) AS activity_count FROM explicit_input GROUP BY user_id)
               GROUP BY activity_count
               UNION ALL
               SELECT 'before_pair_resolution', 'book', activity_count, count(*)
               FROM (SELECT book_id, count(*) AS activity_count FROM explicit_input GROUP BY book_id)
               GROUP BY activity_count
               ORDER BY entity, activity_count""",
            output_dir / "activity_distribution_before_core.csv",
            header=True,
        )
        activity_before = {
            "users": _activity_stats(connection, "explicit_input", "user_id"),
            "books": _activity_stats(connection, "explicit_input", "book_id"),
        }
        LOGGER.info("Etapa 2/5: resolviendo parejas usuario-libro repetidas")
        connection.execute(
            """
            CREATE TABLE pair_resolved AS
            SELECT * EXCLUDE(pair_rank)
            FROM (
                SELECT *, row_number() OVER (
                    PARTITION BY user_id, book_id
                    ORDER BY date_added_utc DESC, date_updated_utc DESC NULLS LAST, interaction_id DESC
                ) AS pair_rank
                FROM explicit_input
            )
            WHERE pair_rank = 1
            """
        )
        pair_resolved_rows = _count(connection, "pair_resolved")
        connection.execute("CREATE TABLE core AS SELECT * FROM pair_resolved")
        core_iterations = 0
        LOGGER.info("Etapa 3/5: aplicando núcleo iterativo usuario-libro")
        while True:
            before = _count(connection, "core")
            connection.execute(
                f"""
                CREATE TABLE core_next AS
                SELECT c.*
                FROM core c
                JOIN (SELECT user_id FROM core GROUP BY user_id HAVING count(*) >= {min_user_interactions}) users USING(user_id)
                JOIN (SELECT book_id FROM core GROUP BY book_id HAVING count(*) >= {min_item_interactions}) books USING(book_id)
                """
            )
            after = _count(connection, "core_next")
            connection.execute("DROP TABLE core")
            connection.execute("ALTER TABLE core_next RENAME TO core")
            core_iterations += 1
            if after == before:
                break
        core_rows = _count(connection, "core")
        activity_after = {
            "users": _activity_stats(connection, "core", "user_id"),
            "books": _activity_stats(connection, "core", "book_id"),
        }
        LOGGER.info("Etapa 4/5: creando particiones temporales y mapeos")
        connection.execute(
            """
            CREATE TABLE temporal_ranked AS
            SELECT *, row_number() OVER (
                PARTITION BY user_id
                ORDER BY date_added_utc DESC, date_updated_utc DESC NULLS LAST, interaction_id DESC
            ) AS temporal_rank
            FROM core
            """
        )
        connection.execute("CREATE TABLE train_raw AS SELECT * EXCLUDE(temporal_rank) FROM temporal_ranked WHERE temporal_rank > 2")
        connection.execute("CREATE TABLE valid_raw AS SELECT * EXCLUDE(temporal_rank) FROM temporal_ranked WHERE temporal_rank = 2")
        connection.execute("CREATE TABLE test_raw AS SELECT * EXCLUDE(temporal_rank) FROM temporal_ranked WHERE temporal_rank = 1")
        connection.execute("CREATE TABLE train_books AS SELECT DISTINCT book_id FROM train_raw")
        valid_before, test_before = _count(connection, "valid_raw"), _count(connection, "test_raw")
        connection.execute("CREATE TABLE valid_known AS SELECT v.* FROM valid_raw v JOIN train_books USING(book_id)")
        connection.execute("CREATE TABLE test_known AS SELECT t.* FROM test_raw t JOIN train_books USING(book_id)")
        connection.execute("CREATE TABLE user_mapping AS SELECT user_id, row_number() OVER (ORDER BY user_id) - 1 AS user_idx FROM (SELECT DISTINCT user_id FROM train_raw)")
        connection.execute("CREATE TABLE book_mapping AS SELECT book_id, row_number() OVER (ORDER BY book_id) - 1 AS book_idx FROM train_books")
        for split in ("train", "valid", "test"):
            source = "train_raw" if split == "train" else f"{split}_known"
            connection.execute(
                f"""
                CREATE TABLE {split} AS
                SELECT m.user_idx::BIGINT AS user_idx, b.book_idx::BIGINT AS book_idx,
                       s.rating::FLOAT AS rating, s.interaction_id, s.date_added_utc
                FROM {source} s
                JOIN user_mapping m USING(user_id)
                JOIN book_mapping b USING(book_id)
                """
            )
        split_counts = {split: _count(connection, split) for split in ("train", "valid", "test")}
        for table in ("train", "valid", "test", "user_mapping", "book_mapping"):
            connection.execute(f"COPY {table} TO {_literal(output_dir / f'{table}.parquet')} (FORMAT PARQUET, COMPRESSION ZSTD)")
        summary: dict[str, int | float | str] = {
            "seed": seed,
            "split_strategy": "temporal_per_user_date_added",
            "pair_rule": "latest_date_added_then_date_updated_then_interaction_id",
            "min_user_interactions": min_user_interactions,
            "min_item_interactions": min_item_interactions,
            "explicit_rows_before_pair_resolution": explicit_rows,
            "rows_after_pair_resolution": pair_resolved_rows,
            "rows_removed_repeated_user_book": explicit_rows - pair_resolved_rows,
            "rows_after_iterative_core": core_rows,
            "rows_removed_core": pair_resolved_rows - core_rows,
            "core_iterations": core_iterations,
            "train_rows": split_counts["train"],
            "valid_rows": split_counts["valid"],
            "test_rows": split_counts["test"],
            "valid_rows_dropped_unknown_book": valid_before - split_counts["valid"],
            "test_rows_dropped_unknown_book": test_before - split_counts["test"],
            "train_users": _count(connection, "user_mapping"),
            "train_books": _count(connection, "book_mapping"),
            "activity_before_core": activity_before,
            "activity_after_core": activity_after,
            "memory_limit": memory_limit,
            "threads": threads,
            "temporal_split_limitations": (
                "date_added_utc representa incorporación a Goodreads, no lectura efectiva; "
                "el núcleo se aplica antes del split y condiciona la población evaluada."
            ),
        }
        LOGGER.info("Etapa 5/5: escribiendo resumen de entrenamiento")
        (output_dir / "training_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return summary
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm_handler)
        connection.close()
        shutil.rmtree(run_dir, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/ml"))
    parser.add_argument("--min-user-interactions", type=int, default=5)
    parser.add_argument("--min-item-interactions", type=int, default=5)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--memory-limit", default="16GB")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--temp-dir", type=Path, default=Path("data/duckdb_ml_tmp"))
    parser.add_argument("--max-temp-gib", type=int, default=200)
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    summary = prepare_training(
        args.processed_dir, args.output_dir, args.min_user_interactions, args.min_item_interactions, args.seed,
        memory_limit=args.memory_limit,
        threads=args.threads,
        temp_dir=args.temp_dir,
        max_temp_gib=args.max_temp_gib,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))
