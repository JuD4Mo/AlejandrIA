"""Carga explícita de inventario inicial: entre uno y tres ejemplares por libro.

Cantidad configurada por el operador, no inferida de Goodreads. Preserva ejemplares
registrados, condiciones, préstamos y reservas. No se ejecuta con Compose ni Tern.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path

import psycopg

LOGGER = logging.getLogger(__name__)
# MD5 solo distribuye cantidades de forma estable; no tiene uso criptográfico.
TARGET = "1 + mod(('x'||substr(md5(b.id::text),1,8))::bit(32)::bigint,3)::integer"


def counts(conn):
    row = conn.execute("""SELECT count(*),coalesce(sum(n),0)::bigint,min(n),max(n),
        count(*) FILTER(WHERE n=0),count(*) FILTER(WHERE n=1),
        count(*) FILTER(WHERE n=2),count(*) FILTER(WHERE n=3),count(*) FILTER(WHERE n>3)
        FROM(SELECT b.id,count(c.id) AS n FROM books b LEFT JOIN book_copies c ON c.book_id=b.id GROUP BY b.id) s""").fetchone()
    return dict(zip(("books","copies","minimum","maximum","without_copies","with_one","with_two","with_three","over_three"),row))


def initialize(conn, batch_size=5000):
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    started = time.perf_counter()
    if not conn.execute("SELECT pg_try_advisory_lock(764005)").fetchone()[0]:
        raise RuntimeError("Another inventory initialization is running")
    try:
        conn.execute("SET timezone='UTC'")
        before = counts(conn)
        upper = conn.execute("SELECT coalesce(max(id),0) FROM books").fetchone()[0]
        inserted = batches = last = 0
        while True:
            with conn.transaction():
                # Mismo orden que inventario/circulación; nunca bloquea usuarios antes de libros.
                books = conn.execute("SELECT id FROM books WHERE id>%s AND id<=%s ORDER BY id LIMIT %s FOR UPDATE",(last,upper,batch_size)).fetchall()
                if not books:
                    break
                ids = [row[0] for row in books]
                added = conn.execute(f"""WITH targets AS (
                    SELECT b.id,{TARGET} AS desired_count,
                        (SELECT count(*) FROM book_copies c WHERE c.book_id=b.id) AS existing_count
                    FROM books b WHERE b.id=ANY(%s::bigint[])
                )
                INSERT INTO book_copies(book_id,inventory_code,status)
                SELECT t.id,candidate.code,'circulating' FROM targets t
                CROSS JOIN LATERAL (
                    SELECT 'ALJ-'||t.id::text||'-'||lpad(n::text,2,'0') AS code
                    FROM generate_series(1,3) n
                    WHERE NOT EXISTS(SELECT 1 FROM book_copies c WHERE c.inventory_code='ALJ-'||t.id::text||'-'||lpad(n::text,2,'0'))
                    ORDER BY n LIMIT greatest(t.desired_count-t.existing_count,0)
                ) candidate
                WHERE true
                ON CONFLICT(inventory_code) DO NOTHING""",(ids,)).rowcount
            inserted += added
            batches += 1
            last = ids[-1]
            if batches % 25 == 0:
                LOGGER.info("Libros revisados hasta id=%s; ejemplares añadidos=%s",last,inserted)
        conn.execute("ANALYZE book_copies")
        after = counts(conn)
        under_target = conn.execute(f"SELECT count(*) FROM books b WHERE b.id<=%s AND (SELECT count(*) FROM book_copies c WHERE c.book_id=b.id)<({TARGET})",(upper,)).fetchone()[0]
        return {"database":conn.info.dbname,"before":before,"after":after,"inserted":inserted,"batches":batches,"under_target":under_target,"seconds":time.perf_counter()-started}
    finally:
        conn.execute("SELECT pg_advisory_unlock(764005)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size",type=int,default=5000)
    parser.add_argument("--report",type=Path,required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")
    with psycopg.connect(os.getenv("CATALOG_DATABASE_URL",""),autocommit=True) as conn:
        result = initialize(conn,args.batch_size)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps(result,indent=2))
    if result["under_target"]:
        raise SystemExit("Some books remain below target; inspect inventory-code collisions")
