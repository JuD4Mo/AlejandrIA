#!/usr/bin/env bash
# Ejecutar desde la raíz. Solo crea/elimina una base desechable propia.
set -euo pipefail
compose=(docker compose --env-file "${COMPOSE_ENV_FILE:-.env}")
db="test_migrations_$(date +%s)_$$"
admin_sql() {
  "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<< "$1"
}
test_sql() {
  "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1' sh "$db"
}
cleanup() { admin_sql "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"; }
trap cleanup EXIT
admin_sql "CREATE DATABASE \"$db\";"
"${compose[@]}" exec -T -e "PGDATABASE=$db" backend /app/tern migrate
"${compose[@]}" exec -T -e "PGDATABASE=$db" backend /app/tern migrate
test_sql < alejandria-backend/internal/database/tests/constraints.sql
test_sql < alejandria-backend/internal/database/tests/circulation_v7.sql
test_sql < alejandria-backend/internal/database/tests/reservation_audit_v8.sql
test_sql <<< "INSERT INTO books(title,goodreads_book_id) VALUES ('Persistence probe','probe');"
"${compose[@]}" stop backend
"${compose[@]}" restart postgres
for _ in {1..60}; do
  if "${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then break; fi
  sleep 1
done
"${compose[@]}" start backend
test_sql <<< "DO \$\$ BEGIN ASSERT (SELECT count(*) = 1 FROM books WHERE goodreads_book_id='probe'), 'Persistence failed'; END \$\$;"
"${compose[@]}" exec -T -e "PGDATABASE=$db" backend /app/tern migrate --destination 0
test_sql <<< "DO \$\$ BEGIN ASSERT (SELECT version = 0 FROM schema_version); ASSERT (SELECT count(*) = 0 FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'schema_version'); END \$\$;"
"${compose[@]}" exec -T -e "PGDATABASE=$db" backend /app/tern migrate
test_sql < alejandria-backend/internal/database/tests/constraints.sql
curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 1 "http://127.0.0.1:${BACKEND_PORT:-8080}/health/ready"
