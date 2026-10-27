-- La circulación (prestado/reservado) se deriva de loans/reservations, no se duplica.
CREATE TABLE book_copies (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    inventory_code TEXT NOT NULL UNIQUE CHECK (btrim(inventory_code) <> ''),
    status TEXT NOT NULL DEFAULT 'circulating' CHECK (status IN ('circulating', 'maintenance', 'lost', 'withdrawn')),
    location TEXT,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, book_id)
);
CREATE INDEX book_copies_book_status_idx ON book_copies(book_id, status);

---- create above / drop below ----
DROP TABLE book_copies;
