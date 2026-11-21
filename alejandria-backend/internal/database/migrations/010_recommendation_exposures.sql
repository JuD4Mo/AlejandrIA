-- Historial operativo de presentación; separado de clics y del entrenamiento Goodreads.
CREATE TABLE recommendation_exposures (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    goodreads_book_id TEXT NOT NULL CHECK (btrim(goodreads_book_id) <> ''),
    last_shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, goodreads_book_id)
);
CREATE INDEX recommendation_exposures_recent_idx
    ON recommendation_exposures(user_id, last_shown_at DESC, goodreads_book_id);
CREATE INDEX loans_user_book_idx ON loans(user_id, book_id);

---- create above / drop below ----

DROP INDEX loans_user_book_idx;
DROP TABLE recommendation_exposures;
