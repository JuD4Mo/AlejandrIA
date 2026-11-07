\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    u BIGINT;
    b BIGINT;
    c BIGINT;
    r BIGINT;
BEGIN
    ASSERT (SELECT version=8 FROM schema_version), 'Expected schema 8';
    INSERT INTO users(email,display_name,password_hash) VALUES('audit8@synthetic.invalid','Test','synthetic') RETURNING id INTO u;
    INSERT INTO books(title) VALUES('Audit test') RETURNING id INTO b;
    INSERT INTO book_copies(book_id,inventory_code) VALUES(b,'AUDIT8-SYNTHETIC') RETURNING id INTO c;
    INSERT INTO reservations(user_id,book_id) VALUES(u,b) RETURNING id INTO r;
    BEGIN
        UPDATE reservations SET assignment_origin='system' WHERE id=r;
        RAISE EXCEPTION 'Origin without assignment accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE reservations SET status='ready',copy_id=c,assigned_at=now(),pickup_expires_at=now()+interval '72 hours',assignment_origin='system' WHERE id=r;
    ASSERT (SELECT assigned_by IS NULL FROM reservations WHERE id=r);
    BEGIN
        UPDATE reservations SET assigned_by=u WHERE id=r;
        RAISE EXCEPTION 'System assignment with impersonated actor accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE reservations SET assignment_origin='manual' WHERE id=r;
        RAISE EXCEPTION 'Manual assignment without actor accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE reservations SET assignment_origin='manual',assigned_by=u WHERE id=r;
    UPDATE reservations SET assignment_origin='unknown' WHERE id=r;
    ASSERT (SELECT assigned_by=u FROM reservations WHERE id=r);
    BEGIN
        UPDATE reservations SET pickup_expires_at=assigned_at+interval '1 hour' WHERE id=r;
        RAISE EXCEPTION 'Invalid pickup duration accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END $$;
ROLLBACK;
