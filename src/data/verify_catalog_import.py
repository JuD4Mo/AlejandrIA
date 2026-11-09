"""Verificación de solo lectura del catálogo y correspondencias FastAPI reales."""

import argparse
import json
import os
import statistics
import subprocess
import time
from pathlib import Path

import psycopg


def verify(args):
    with psycopg.connect(os.getenv("CATALOG_DATABASE_URL", ""), autocommit=True) as connection:
        connection.execute("SET default_transaction_read_only=on")
        counts = {table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in ("books", "authors", "works", "genres", "book_authors", "book_genres", "book_copies", "users", "loan_requests", "loans", "reservations", "book_ratings", "user_book_interactions")}
        checks = {
            "duplicate_external_books": "SELECT count(*) FROM(SELECT goodreads_book_id FROM books WHERE goodreads_book_id IS NOT NULL GROUP BY goodreads_book_id HAVING count(*)>1) d",
            "orphan_author_links": "SELECT count(*) FROM book_authors ba LEFT JOIN books b ON b.id=ba.book_id LEFT JOIN authors a ON a.id=ba.author_id WHERE b.id IS NULL OR a.id IS NULL",
            "orphan_genre_links": "SELECT count(*) FROM book_genres bg LEFT JOIN books b ON b.id=bg.book_id LEFT JOIN genres g ON g.id=bg.genre_id WHERE b.id IS NULL OR g.id IS NULL",
            "orphan_work_links": "SELECT count(*) FROM books b LEFT JOIN works w ON w.id=b.work_id WHERE b.work_id IS NOT NULL AND w.id IS NULL",
            "blank_titles": "SELECT count(*) FROM books WHERE btrim(title)=''",
        }
        quality = {key: connection.execute(query).fetchone()[0] for key, query in checks.items()}
        if any(quality.values()):
            raise ValueError(f"Integridad inesperada: {quality}")
        author = connection.execute("SELECT author_id FROM book_authors LIMIT 1").fetchone()[0]
        genre = connection.execute("SELECT id FROM genres ORDER BY id LIMIT 1").fetchone()[0]
        queries = {
            "first_page": ("SELECT id,title FROM books ORDER BY id LIMIT 20", ()),
            "title_search": ("SELECT id,title FROM books WHERE title ILIKE %s ORDER BY id LIMIT 20", ("%Harry Potter%",)),
            "deep_offset": ("SELECT id,title FROM books ORDER BY id LIMIT 20 OFFSET 900000", ()),
            "cursor": ("SELECT id,title FROM books WHERE id>900000 ORDER BY id LIMIT 20", ()),
            "author_filter": ("SELECT id,title FROM books WHERE id IN(SELECT book_id FROM book_authors WHERE author_id=%s) ORDER BY id LIMIT 20", (author,)),
            "genre_filter": ("SELECT id,title FROM books WHERE id IN(SELECT book_id FROM book_genres WHERE genre_id=%s) ORDER BY id LIMIT 20", (genre,)),
            "physical_only": ("SELECT id,title FROM books WHERE id IN(SELECT book_id FROM book_copies) ORDER BY id LIMIT 20", ()),
            "no_physical_copies": ("SELECT id,title FROM books WHERE id NOT IN(SELECT book_id FROM book_copies) ORDER BY id LIMIT 20", ()),
            "detail": ("SELECT * FROM books WHERE id=(SELECT min(id) FROM books)", ()),
        }
        performance = {}
        for name, (query, parameters) in queries.items():
            plan = connection.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + query, parameters).fetchone()[0][0]
            elapsed = []
            rows = []
            for _ in range(3):
                start = time.perf_counter()
                rows = connection.execute(query, parameters).fetchall()
                elapsed.append((time.perf_counter() - start) * 1000)
            performance[name] = {"server_execution_ms": plan["Execution Time"], "median_roundtrip_ms": statistics.median(elapsed), "rows": len(rows)}
        code = "import json,urllib.request; p=json.dumps({'preferences':{'genres':['fantasy'],'authors':[],'keywords':[]},'limit':10}).encode(); r=urllib.request.Request('http://127.0.0.1:8000/api/v1/recommendations/preferences',data=p,headers={'Content-Type':'application/json'}); print(urllib.request.urlopen(r,timeout=30).read().decode())"
        upstream = json.loads(subprocess.check_output(["docker", "compose", "--env-file", args.compose_env, "exec", "-T", "recommendations", "python", "-c", code]))
        ids = [row["book_id"] for row in upstream["recommendations"]]
        matched = connection.execute("SELECT id,goodreads_book_id,title FROM books WHERE goodreads_book_id=ANY(%s::text[])", (ids,)).fetchall()
        result = {"counts": counts, "quality": quality, "performance": performance,
                  "database_bytes": connection.execute("SELECT pg_database_size(current_database())").fetchone()[0],
                  "schema_version": connection.execute("SELECT version FROM schema_version").fetchone()[0],
                  "recommendations": {"returned": len(ids), "matched_local": len(matched), "matches": [{"local_book_id": row[0], "goodreads_book_id": row[1], "title": row[2]} for row in matched]}}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-env", default=".env")
    parser.add_argument("--report", type=Path, required=True)
    verify(parser.parse_args())
