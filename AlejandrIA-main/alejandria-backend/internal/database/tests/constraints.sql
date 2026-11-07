\set ON_ERROR_STOP on
-- Fixture sintética transaccional: no deja usuarios ni préstamos en la base.
BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement TEXT, expected_state TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN RETURN; END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'Expected SQLSTATE % for %', expected_state, statement;
END;
$$;
DO $$
DECLARE
    reader_id BIGINT;
    librarian_id BIGINT;
    book_id BIGINT;
    other_book_id BIGINT;
    copy_id BIGINT;
    other_copy_id BIGINT;
    request_id BIGINT;
    second_request_id BIGINT;
    loan_id BIGINT;
    reservation_id BIGINT;
    started TIMESTAMPTZ := '2026-01-01 12:00:00+00';
BEGIN
    ASSERT (SELECT version >= 6 FROM schema_version), 'Migration version';
    ASSERT (SELECT count(*) = 3 FROM roles), 'Seed roles';
    ASSERT (SELECT count(*) = 17 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_version'), 'Table inventory';
    INSERT INTO users(email, display_name, password_hash) VALUES ('reader@synthetic.invalid', 'Reader', 'synthetic-hash') RETURNING id INTO reader_id;
    INSERT INTO users(email, display_name, password_hash) VALUES ('librarian@synthetic.invalid', 'Librarian', 'synthetic-hash') RETURNING id INTO librarian_id;
    INSERT INTO books(title, goodreads_book_id) VALUES ('Synthetic', '000123') RETURNING id INTO book_id;
    INSERT INTO books(title) VALUES ('Other synthetic') RETURNING id INTO other_book_id;
    PERFORM pg_temp.expect_error('INSERT INTO books(title,goodreads_book_id) VALUES (''Duplicate'',''000123'')', '23505');
    PERFORM pg_temp.expect_error('INSERT INTO users(email,display_name,password_hash) VALUES (''READER@SYNTHETIC.INVALID'',''x'',''x'')', '23505');
    PERFORM pg_temp.expect_error('INSERT INTO book_copies(book_id,inventory_code) VALUES (-1,''orphan'')', '23503');
    PERFORM pg_temp.expect_error(format('INSERT INTO book_copies(book_id,inventory_code,status) VALUES (%s,''bad'',''borrowed'')', book_id), '23514');
    INSERT INTO book_copies(book_id,inventory_code) VALUES (book_id,'TEST-COPY-1') RETURNING id INTO copy_id;
    INSERT INTO book_copies(book_id,inventory_code) VALUES (other_book_id,'TEST-COPY-2') RETURNING id INTO other_copy_id;
    PERFORM pg_temp.expect_error(format('INSERT INTO book_ratings(user_id,book_id,rating) VALUES (%s,%s,0)', reader_id,book_id), '23514');
    INSERT INTO book_ratings(user_id,book_id,rating) VALUES (reader_id,book_id,4);
    PERFORM pg_temp.expect_error(format('INSERT INTO book_ratings(user_id,book_id,rating) VALUES (%s,%s,5)', reader_id,book_id), '23505');
    INSERT INTO loan_requests(user_id,book_id,status,created_at,decided_at,decided_by)
        VALUES (reader_id,book_id,'approved',started,started,librarian_id) RETURNING id INTO request_id;
    INSERT INTO loan_requests(user_id,book_id,status,created_at,decided_at,decided_by)
        VALUES (reader_id,book_id,'approved',started,started,librarian_id) RETURNING id INTO second_request_id;
    INSERT INTO loans(request_id,user_id,book_id,copy_id,delivered_by,delivered_at,initial_due_at,due_at)
        VALUES (request_id,reader_id,book_id,copy_id,librarian_id,started,started+interval '30 days',started+interval '30 days') RETURNING id INTO loan_id;
    PERFORM pg_temp.expect_error(format('INSERT INTO loans(request_id,user_id,book_id,copy_id,delivered_by,delivered_at,initial_due_at,due_at) SELECT %s,user_id,book_id,copy_id,delivered_by,delivered_at,initial_due_at,due_at FROM loans WHERE id=%s',second_request_id,loan_id), '23505');
    PERFORM pg_temp.expect_error(format('UPDATE loans SET copy_id=%s WHERE id=%s',other_copy_id,loan_id), '23503');
    PERFORM pg_temp.expect_error(format('UPDATE loans SET due_at=due_at + interval ''1 day'' WHERE id=%s',loan_id), '23514');
    INSERT INTO loan_renewals(loan_id,requested_at,previous_due_at,status,new_due_at,decided_at,decided_by)
        VALUES (loan_id,started+interval '10 days',started+interval '30 days','approved',started+interval '60 days',started+interval '11 days',librarian_id);
    PERFORM pg_temp.expect_error(format('INSERT INTO loan_renewals(loan_id,requested_at,previous_due_at,status,new_due_at,decided_at,decided_by) SELECT loan_id,requested_at,previous_due_at,status,new_due_at,decided_at,decided_by FROM loan_renewals WHERE loan_id=%s',loan_id), '23505');
    PERFORM pg_temp.expect_error(format('INSERT INTO loan_renewals(loan_id,requested_at,previous_due_at) VALUES (%s,now(),now()-interval ''1 day'')',loan_id), '23514');
    INSERT INTO reservations(user_id,book_id) VALUES (reader_id,book_id) RETURNING id INTO reservation_id;
    PERFORM pg_temp.expect_error(format('INSERT INTO reservations(user_id,book_id) VALUES (%s,%s)',reader_id,book_id), '23505');
    PERFORM pg_temp.expect_error(format('UPDATE reservations SET status=''ready'' WHERE id=%s',reservation_id), '23514');
    UPDATE reservations SET status='cancelled',closed_at=now() WHERE id=reservation_id;
    -- La nueva reserva puede entrar tras cancelar; el plazo de recogida no es arbitrario.
    INSERT INTO reservations(user_id,book_id) VALUES (reader_id,other_book_id) RETURNING id INTO reservation_id;
    PERFORM pg_temp.expect_error(format('UPDATE reservations SET status=''ready'',copy_id=%s,assigned_at=now(),assigned_by=%s,pickup_expires_at=now()+interval ''1 hour'' WHERE id=%s',other_copy_id,librarian_id,reservation_id), '23514');
    UPDATE reservations SET status='ready',copy_id=other_copy_id,assigned_at=now(),assigned_by=librarian_id,assignment_origin='manual',pickup_expires_at=now()+interval '72 hours' WHERE id=reservation_id;
    PERFORM pg_temp.expect_error(format('INSERT INTO reservations(user_id,book_id,status,copy_id,assigned_at,assigned_by,assignment_origin,pickup_expires_at) VALUES (%s,%s,''ready'',%s,now(),%s,''manual'',now()+interval ''72 hours'')',librarian_id,other_book_id,other_copy_id,librarian_id), '23505');
    PERFORM pg_temp.expect_error(format('UPDATE reservations SET status=''expired'',closed_at=now() WHERE id=%s',reservation_id), '23514');
    PERFORM pg_temp.expect_error(format('DELETE FROM users WHERE id=%s',reader_id), '23503');
    -- Un vencido permanece activo y puede registrarse su devolución tardía.
    ASSERT (SELECT returned_at IS NULL AND due_at < now() FROM loans WHERE id=loan_id);
    UPDATE loans SET returned_at=started+interval '70 days', returned_by=librarian_id WHERE id=loan_id;
    INSERT INTO loans(request_id,user_id,book_id,copy_id,delivered_by,delivered_at,initial_due_at,due_at)
        VALUES (second_request_id,reader_id,book_id,copy_id,librarian_id,started+interval '71 days',started+interval '101 days',started+interval '101 days');
END;
$$;
ROLLBACK;
SELECT 'All integrity checks passed' AS result;
