from __future__ import annotations

import sys
from pathlib import Path

import duckdb

sys.path.insert(0,str(Path(__file__).parents[1]/"src/data"))
from audit_catalog import compare_books
from import_catalog import PHASES


def test_partitioned_comparison_detects_changed_missing_and_extra_values():
    with duckdb.connect() as db:
        ddl=PHASES[3][2]
        db.execute(f"CREATE TABLE expected_books({ddl})")
        db.execute(f"CREATE TABLE actual_books({ddl})")
        db.execute("INSERT INTO expected_books(external_id,title,description) VALUES('001','same','long text'),('002','changed',NULL),('003','absent','value')")
        db.execute("INSERT INTO actual_books(external_id,title,description) VALUES('001','same','long text'),('002','changed','new description'),('004','extra','value')")
        missing,extra,fields=compare_books(db,buckets=4)
        assert missing==2 and extra==2
        assert fields['description']==1 and fields['title']==0
        db.execute("DELETE FROM actual_books")
        db.execute("INSERT INTO actual_books SELECT * FROM expected_books")
        missing,extra,fields=compare_books(db,buckets=4)
        assert missing==extra==0 and not any(fields.values())
