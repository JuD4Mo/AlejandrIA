import os
import sys
from pathlib import Path
import uuid

import psycopg
import pytest

sys.path.insert(0,str(Path(__file__).parents[1]/"src/data"))
from initialize_inventory import initialize


@pytest.mark.skipif(not os.getenv("INVENTORY_TEST_DATABASE_URL"),reason="requires disposable migrated PostgreSQL database")
def test_initial_inventory_is_idempotent_and_preserves_existing_copies():
    with psycopg.connect(os.environ["INVENTORY_TEST_DATABASE_URL"],autocommit=True) as conn:
        assert conn.info.dbname.startswith("test_")
        assert conn.execute("SELECT count(*) FROM books").fetchone()[0]==0
        ids=[]
        for _ in range(12):
            ids.append(conn.execute("INSERT INTO books(title) VALUES(%s) RETURNING id",("Inventory fixture "+uuid.uuid4().hex,)).fetchone()[0])
        existing=conn.execute("INSERT INTO book_copies(book_id,inventory_code,status,location) VALUES(%s,'PREEXISTING','maintenance','Keep location') RETURNING id",(ids[0],)).fetchone()[0]
        result=initialize(conn,batch_size=3)
        assert result["under_target"]==0
        assert result["after"]["minimum"]>=1 and result["after"]["maximum"]<=3
        row=conn.execute("SELECT inventory_code,status,location FROM book_copies WHERE id=%s",(existing,)).fetchone()
        assert row==('PREEXISTING','maintenance','Keep location')
        repeated=initialize(conn,batch_size=3)
        assert repeated["inserted"]==0 and repeated["after"]==result["after"]
