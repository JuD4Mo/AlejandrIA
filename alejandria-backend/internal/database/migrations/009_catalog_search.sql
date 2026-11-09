-- ILIKE '%texto%' no puede aprovechar el B-tree lower(title) de 002.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX books_title_trgm_idx ON books USING gin (title gin_trgm_ops);
CREATE INDEX book_authors_author_book_idx ON book_authors(author_id,book_id);
CREATE INDEX book_genres_genre_book_idx ON book_genres(genre_id,book_id);

---- create above / drop below ----
DROP INDEX book_genres_genre_book_idx;
DROP INDEX book_authors_author_book_idx;
DROP INDEX books_title_trgm_idx;
-- Se conserva pg_trgm: podría estar siendo utilizado por otros objetos.
