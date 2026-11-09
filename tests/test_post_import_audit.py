from pathlib import Path
import sys
from types import SimpleNamespace

import psycopg.conninfo
import pytest

sys.path.insert(0,str(Path(__file__).parents[1]/"alejandria-backend/scripts"))
from post_import_audit import verified_import_environment


def test_reimport_does_not_inherit_operational_url(monkeypatch):
    monkeypatch.setenv("CATALOG_DATABASE_URL","dbname=operative host=localhost")
    conn=SimpleNamespace(info=SimpleNamespace(dbname="test_verified",dsn="dbname=test_verified host=localhost user=audit",password="fixture-only"))
    environment=verified_import_environment(conn)
    parsed=psycopg.conninfo.conninfo_to_dict(environment["CATALOG_DATABASE_URL"])
    assert parsed["dbname"]=="test_verified" and environment["PGDATABASE"]=="test_verified"


def test_reimport_rejects_non_test_connection():
    conn=SimpleNamespace(info=SimpleNamespace(dbname="operative"))
    with pytest.raises(ValueError,match="non-test"):
        verified_import_environment(conn)
