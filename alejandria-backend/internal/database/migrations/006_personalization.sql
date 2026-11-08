CREATE TABLE user_genre_preferences (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    genre_id BIGINT NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, genre_id)
);
CREATE INDEX user_genre_preferences_genre_idx ON user_genre_preferences(genre_id);
CREATE TABLE book_ratings (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    PRIMARY KEY (user_id, book_id)
);
CREATE INDEX book_ratings_book_idx ON book_ratings(book_id);
-- Solo eventos no representados por préstamos, reservas o calificaciones.
CREATE TABLE user_book_interactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('view', 'recommendation_click', 'favorite_added', 'favorite_removed')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_book_interactions_user_time_idx ON user_book_interactions(user_id, occurred_at, id);
CREATE INDEX user_book_interactions_book_time_idx ON user_book_interactions(book_id, occurred_at);

---- create above / drop below ----
DROP TABLE user_book_interactions, book_ratings, user_genre_preferences;
