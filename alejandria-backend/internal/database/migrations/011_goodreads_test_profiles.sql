-- Vínculos operativos explícitos para simular perfiles históricos; no vinculan identidades reales.
CREATE TABLE user_goodreads_test_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    goodreads_user_id TEXT NOT NULL CHECK (btrim(goodreads_user_id) <> ''),
    model_version TEXT NOT NULL CHECK (btrim(model_version) <> ''),
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

---- create above / drop below ----

DROP TABLE user_goodreads_test_profiles;
