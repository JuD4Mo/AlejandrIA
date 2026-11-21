-- Cola durable y perfiles numéricos locales; no modifica embeddings de Goodreads.
CREATE TABLE local_fold_in_profiles (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    processed_revision BIGINT NOT NULL DEFAULT 0 CHECK (processed_revision >= 0 AND processed_revision <= revision),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','insufficient','error')),
    profile JSONB,
    model_signature TEXT,
    input_count INTEGER NOT NULL DEFAULT 0 CHECK (input_count >= 0),
    matched_count INTEGER NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
    positive_count INTEGER NOT NULL DEFAULT 0 CHECK (positive_count >= 0),
    minimum_ratings INTEGER NOT NULL DEFAULT 5 CHECK (minimum_ratings > 0),
    reason TEXT NOT NULL DEFAULT '',
    claim_token UUID,
    lease_until TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status <> 'ready' OR (profile IS NOT NULL AND model_signature IS NOT NULL AND processed_revision=revision)),
    CHECK (profile IS NULL OR jsonb_typeof(profile)='object'),
    CHECK (matched_count<=input_count AND positive_count<=input_count),
    CHECK ((status='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX local_fold_in_pending_idx ON local_fold_in_profiles(next_attempt_at,user_id)
    WHERE status IN ('pending','processing','error');

CREATE FUNCTION enqueue_local_fold_in() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user BIGINT;
BEGIN
    IF TG_OP='DELETE' THEN target_user:=OLD.user_id; ELSE target_user:=NEW.user_id; END IF;
    IF NOT EXISTS(SELECT 1 FROM user_goodreads_test_profiles WHERE user_id=target_user) THEN
        INSERT INTO local_fold_in_profiles(user_id) VALUES(target_user)
        ON CONFLICT(user_id) DO UPDATE SET revision=local_fold_in_profiles.revision+1,
            status='pending',claim_token=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now(),reason='';
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER book_ratings_fold_in_queue AFTER INSERT OR UPDATE OR DELETE ON book_ratings
    FOR EACH ROW EXECUTE FUNCTION enqueue_local_fold_in();

-- Si personal corrige un mapeo bibliográfico, se recalculan los perfiles afectados.
CREATE FUNCTION enqueue_fold_in_book_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO local_fold_in_profiles(user_id)
    SELECT r.user_id FROM book_ratings r WHERE r.book_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM user_goodreads_test_profiles p WHERE p.user_id=r.user_id)
    ON CONFLICT(user_id) DO UPDATE SET revision=local_fold_in_profiles.revision+1,
        status='pending',claim_token=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now(),reason='';
    RETURN NULL;
END $$;
CREATE TRIGGER books_fold_in_mapping AFTER UPDATE OF goodreads_book_id ON books
    FOR EACH ROW WHEN (OLD.goodreads_book_id IS DISTINCT FROM NEW.goodreads_book_id)
    EXECUTE FUNCTION enqueue_fold_in_book_mapping();

INSERT INTO local_fold_in_profiles(user_id)
SELECT DISTINCT r.user_id FROM book_ratings r
WHERE NOT EXISTS(SELECT 1 FROM user_goodreads_test_profiles p WHERE p.user_id=r.user_id);

---- create above / drop below ----

DROP TRIGGER books_fold_in_mapping ON books;
DROP FUNCTION enqueue_fold_in_book_mapping();
DROP TRIGGER book_ratings_fold_in_queue ON book_ratings;
DROP FUNCTION enqueue_local_fold_in();
DROP TABLE local_fold_in_profiles;
