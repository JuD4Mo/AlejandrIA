\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    u BIGINT;
    b BIGINT;
    r BIGINT;
BEGIN
    ASSERT (SELECT version >= 7 FROM schema_version), 'Expected version >= 7';
    ASSERT (SELECT count(*)=6 FROM pg_index WHERE indisunique AND indpred IS NOT NULL);
    INSERT INTO users(email,display_name,password_hash) VALUES ('v7@synthetic.invalid','Test','synthetic') RETURNING id INTO u;
    INSERT INTO books(title) VALUES ('Synthetic V7') RETURNING id INTO b;
    INSERT INTO loan_requests(user_id,book_id) VALUES (u,b) RETURNING id INTO r;
    BEGIN
        INSERT INTO loan_requests(user_id,book_id) VALUES (u,b);
        RAISE EXCEPTION 'Duplicate pending request accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    UPDATE loan_requests SET status='cancelled' WHERE id=r;
    INSERT INTO loan_requests(user_id,book_id) VALUES (u,b);
    ASSERT (SELECT count(*)=2 FROM loan_requests WHERE user_id=u AND book_id=b), 'History lost';
END $$;
ROLLBACK;
