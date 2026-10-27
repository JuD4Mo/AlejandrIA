CREATE TABLE works (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    goodreads_work_id TEXT UNIQUE CHECK (goodreads_work_id IS NULL OR btrim(goodreads_work_id) <> '')
);
CREATE TABLE books (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    work_id BIGINT REFERENCES works(id) ON DELETE RESTRICT,
    goodreads_book_id TEXT UNIQUE CHECK (goodreads_book_id IS NULL OR btrim(goodreads_book_id) <> ''),
    title TEXT NOT NULL CHECK (btrim(title) <> ''),
    description TEXT,
    isbn TEXT,
    isbn13 TEXT,
    language_code TEXT,
    publication_year INTEGER,
    num_pages INTEGER CHECK (num_pages > 0),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX books_work_idx ON books(work_id);
CREATE INDEX books_title_idx ON books(lower(title));
CREATE TABLE authors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    goodreads_author_id TEXT UNIQUE CHECK (goodreads_author_id IS NULL OR btrim(goodreads_author_id) <> '')
);
CREATE TABLE book_authors (
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    author_id BIGINT NOT NULL REFERENCES authors(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT 'author' CHECK (btrim(role) <> ''),
    PRIMARY KEY (book_id, author_id, role)
);
CREATE INDEX book_authors_author_idx ON book_authors(author_id);
CREATE TABLE genres (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX genres_name_ci_uq ON genres(lower(btrim(name)));
CREATE TABLE book_genres (
    book_id BIGINT NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
    genre_id BIGINT NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
    PRIMARY KEY (book_id, genre_id)
);
CREATE INDEX book_genres_genre_idx ON book_genres(genre_id);

---- create above / drop below ----
DROP TABLE book_genres, genres, book_authors, authors, books, works;
