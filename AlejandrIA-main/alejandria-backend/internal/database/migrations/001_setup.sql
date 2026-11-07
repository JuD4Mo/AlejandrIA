-- Identidades propias de la biblioteca; nunca son identificadores Goodreads.
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL CHECK (btrim(email) <> ''),
    display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
    password_hash TEXT NOT NULL CHECK (btrim(password_hash) <> ''),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_ci_uq ON users (lower(btrim(email)));
CREATE TABLE roles (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (name IN ('lector', 'bibliotecario', 'administrador'))
);
INSERT INTO roles (name) VALUES ('lector'), ('bibliotecario'), ('administrador');
CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles(role_id);

---- create above / drop below ----

DROP TABLE user_roles, roles, users;
