#!/usr/bin/env bash
# Solo opera sobre una base test_* propia; nunca revierte la base de trabajo.
set -euo pipefail
compose=(docker compose --env-file "${COMPOSE_ENV_FILE:-.env}")
db="test_audit_$(date +%s)_$$"
admin_sql() { "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<< "$1"; }
test_sql() { "${compose[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -At' sh "$db"; }
migrate() { "${compose[@]}" exec -T -e "PGDATABASE=$db" backend /app/tern migrate "$@"; }
cleanup() { admin_sql "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"; }
trap cleanup EXIT
admin_sql "CREATE DATABASE \"$db\";"
migrate --destination 7
test_sql <<'SQL'
DO $$ DECLARE u BIGINT; b BIGINT; c BIGINT;
BEGIN
    INSERT INTO users(email,display_name,password_hash) VALUES('legacy@synthetic.invalid','Legacy fixture','synthetic') RETURNING id INTO u;
    INSERT INTO books(title) VALUES('Legacy fixture') RETURNING id INTO b;
    INSERT INTO book_copies(book_id,inventory_code) VALUES(b,'LEGACY-COPY') RETURNING id INTO c;
    INSERT INTO reservations(user_id,book_id,status,copy_id,assigned_at,assigned_by,pickup_expires_at)
        VALUES(u,b,'ready',c,now(),u,now()+interval '72 hours');
END $$;
SQL
before=$(test_sql <<< "SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM reservations r;")
migrate
after=$(test_sql <<< "SELECT md5(jsonb_agg(to_jsonb(r)-'assignment_origin' ORDER BY id)::text) FROM reservations r;")
test "$before" = "$after"
test_sql <<< "DO \$\$ BEGIN ASSERT (SELECT count(*)=1 FROM reservations WHERE assignment_origin='unknown' AND assigned_by IS NOT NULL); END \$\$;"
test_sql < alejandria-backend/internal/database/tests/reservation_audit_v8.sql
migrate --destination 7
after=$(test_sql <<< "SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM reservations r;")
test "$before" = "$after"
migrate
test_sql <<'SQL'
DO $$ DECLARE u BIGINT; b BIGINT; c BIGINT;
BEGIN
    SELECT id INTO u FROM users WHERE email='legacy@synthetic.invalid';
    INSERT INTO books(title) VALUES('System fixture') RETURNING id INTO b;
    INSERT INTO book_copies(book_id,inventory_code) VALUES(b,'SYSTEM-COPY') RETURNING id INTO c;
    INSERT INTO reservations(user_id,book_id,status,copy_id,assigned_at,pickup_expires_at,assignment_origin)
        VALUES(u,b,'ready',c,now(),now()+interval '72 hours','system');
END $$;
SQL
if migrate --destination 7; then
    printf '%s\n' 'ERROR: unsafe downgrade was accepted' >&2
    exit 1
fi
test_sql <<< "DO \$\$ BEGIN ASSERT (SELECT version=8 FROM schema_version); ASSERT (SELECT count(*)=2 FROM reservations); ASSERT (SELECT count(*)=1 FROM reservations WHERE assignment_origin='system' AND assigned_by IS NULL); END \$\$;"
printf '%s\n' 'Audit migration passed: historical preservation, safe down/up, unsafe down rejected atomically.'
