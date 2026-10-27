CREATE TABLE reservations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    copy_id BIGINT,
    assigned_at TIMESTAMPTZ,
    assigned_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    pickup_expires_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    loan_id BIGINT UNIQUE,
    FOREIGN KEY (loan_id, user_id, book_id, copy_id) REFERENCES loans(id, user_id, book_id, copy_id) ON DELETE RESTRICT,
    FOREIGN KEY (copy_id, book_id) REFERENCES book_copies(id, book_id) ON DELETE RESTRICT,
    CHECK ((copy_id IS NULL AND assigned_at IS NULL AND assigned_by IS NULL AND pickup_expires_at IS NULL)
        OR (copy_id IS NOT NULL AND assigned_at IS NOT NULL AND assigned_by IS NOT NULL
            AND pickup_expires_at IS NOT NULL AND assigned_at >= created_at AND pickup_expires_at = assigned_at + interval '72 hours')),
    CHECK (status <> 'waiting' OR copy_id IS NULL),
    CHECK (status NOT IN ('ready', 'fulfilled', 'expired') OR copy_id IS NOT NULL),
    CHECK ((status IN ('waiting', 'ready') AND closed_at IS NULL) OR (status IN ('fulfilled', 'cancelled', 'expired') AND closed_at IS NOT NULL AND closed_at >= created_at)),
    CHECK (closed_at IS NULL OR assigned_at IS NULL OR closed_at >= assigned_at),
    CHECK (status <> 'expired' OR closed_at >= pickup_expires_at),
    CHECK ((status = 'fulfilled' AND loan_id IS NOT NULL) OR (status <> 'fulfilled' AND loan_id IS NULL))
);
CREATE UNIQUE INDEX reservations_active_user_book_uq ON reservations(user_id, book_id) WHERE status IN ('waiting', 'ready');
CREATE UNIQUE INDEX reservations_ready_copy_uq ON reservations(copy_id) WHERE status = 'ready';
CREATE INDEX reservations_fifo_idx ON reservations(book_id, created_at, id) WHERE status = 'waiting';
CREATE INDEX reservations_expiry_idx ON reservations(pickup_expires_at) WHERE status = 'ready';
CREATE INDEX reservations_user_idx ON reservations(user_id);
CREATE INDEX reservations_copy_idx ON reservations(copy_id);
CREATE INDEX reservations_assigned_by_idx ON reservations(assigned_by) WHERE assigned_by IS NOT NULL;

---- create above / drop below ----
DROP TABLE reservations;
