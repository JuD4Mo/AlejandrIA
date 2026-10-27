CREATE TABLE loan_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    decided_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    decision_note TEXT,
    CHECK (decided_at IS NULL OR decided_at >= created_at),
    CHECK ((status IN ('approved', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
        OR (status IN ('pending', 'cancelled') AND decided_at IS NULL AND decided_by IS NULL)),
    UNIQUE (id, user_id, book_id)
);
CREATE INDEX loan_requests_pending_idx ON loan_requests(created_at, id) WHERE status = 'pending';
CREATE INDEX loan_requests_user_idx ON loan_requests(user_id, created_at);
CREATE INDEX loan_requests_book_idx ON loan_requests(book_id);
CREATE INDEX loan_requests_decided_by_idx ON loan_requests(decided_by) WHERE decided_by IS NOT NULL;
CREATE TABLE loans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id BIGINT NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    book_id BIGINT NOT NULL,
    copy_id BIGINT NOT NULL,
    delivered_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    delivered_at TIMESTAMPTZ NOT NULL,
    initial_due_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    returned_at TIMESTAMPTZ,
    returned_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE (id, user_id, book_id, copy_id),
    FOREIGN KEY (request_id, user_id, book_id) REFERENCES loan_requests(id, user_id, book_id) ON DELETE RESTRICT,
    FOREIGN KEY (copy_id, book_id) REFERENCES book_copies(id, book_id) ON DELETE RESTRICT,
    CHECK (initial_due_at = delivered_at + interval '720 hours'),
    CHECK (due_at = initial_due_at OR due_at = initial_due_at + interval '720 hours'),
    CHECK ((returned_at IS NULL AND returned_by IS NULL) OR (returned_at IS NOT NULL AND returned_by IS NOT NULL AND returned_at >= delivered_at))
);
CREATE UNIQUE INDEX loans_active_copy_uq ON loans(copy_id) WHERE returned_at IS NULL;
CREATE INDEX loans_active_user_idx ON loans(user_id, due_at) WHERE returned_at IS NULL;
CREATE INDEX loans_active_due_idx ON loans(due_at) WHERE returned_at IS NULL;
CREATE INDEX loans_book_idx ON loans(book_id);
CREATE INDEX loans_delivered_by_idx ON loans(delivered_by);
CREATE INDEX loans_returned_by_idx ON loans(returned_by) WHERE returned_by IS NOT NULL;
CREATE TABLE loan_renewals (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    loan_id BIGINT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    previous_due_at TIMESTAMPTZ NOT NULL,
    new_due_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    decided_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    decision_note TEXT,
    CHECK (requested_at < previous_due_at),
    CHECK (decided_at IS NULL OR decided_at >= requested_at),
    CHECK ((status IN ('approved', 'rejected') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
        OR (status IN ('pending', 'cancelled') AND decided_at IS NULL AND decided_by IS NULL)),
    CHECK ((status = 'approved' AND new_due_at IS NOT NULL AND new_due_at = previous_due_at + interval '720 hours')
        OR (status <> 'approved' AND new_due_at IS NULL))
);
CREATE UNIQUE INDEX loan_renewals_approved_uq ON loan_renewals(loan_id) WHERE status = 'approved';
CREATE UNIQUE INDEX loan_renewals_pending_uq ON loan_renewals(loan_id) WHERE status = 'pending';
CREATE INDEX loan_renewals_loan_idx ON loan_renewals(loan_id);
CREATE INDEX loan_renewals_pending_idx ON loan_renewals(requested_at, id) WHERE status = 'pending';
CREATE INDEX loan_renewals_decided_by_idx ON loan_renewals(decided_by) WHERE decided_by IS NOT NULL;

---- create above / drop below ----
DROP TABLE loan_renewals, loans, loan_requests;
