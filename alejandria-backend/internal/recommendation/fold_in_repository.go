package recommendation

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) LocalState(ctx context.Context, userID int64) (*LocalState, error) {
	var state LocalState
	var raw []byte
	err := r.pool.QueryRow(ctx, `SELECT status,reason,input_count,matched_count,positive_count,minimum_ratings,
        revision,processed_revision,updated_at,profile FROM local_fold_in_profiles WHERE user_id=$1`, userID).Scan(
		&state.Status, &state.Reason, &state.InputCount, &state.MatchedCount, &state.PositiveCount, &state.MinimumRatings,
		&state.Revision, &state.ProcessedRevision, &state.UpdatedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if state.Status == "ready" && state.Revision == state.ProcessedRevision && raw != nil {
		if err = json.Unmarshal(raw, &state.Profile); err != nil {
			return nil, err
		}
	}
	return &state, nil
}

func (r *Repository) RequeueModel(ctx context.Context, signature string) error {
	_, err := r.pool.Exec(ctx, `UPDATE local_fold_in_profiles SET status='pending',revision=revision+1,
        claim_token=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now(),reason='model_changed'
        WHERE model_signature IS NOT NULL AND model_signature<>$1 AND status IN ('ready','insufficient','error')
        AND NOT EXISTS(SELECT 1 FROM user_goodreads_test_profiles h WHERE h.user_id=local_fold_in_profiles.user_id)`, signature)
	return err
}

func (r *Repository) ClaimFoldIn(ctx context.Context, onlyUser int64) (*FoldInJob, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	job := &FoldInJob{Token: uuid.NewString(), Ratings: []LocalRating{}}
	err = tx.QueryRow(ctx, `WITH next AS (
        SELECT p.user_id FROM local_fold_in_profiles p JOIN users u ON u.id=p.user_id
        WHERE u.is_active AND ((p.status IN ('pending','error') AND p.next_attempt_at<=now())
            OR (p.status='processing' AND p.lease_until<now()))
        AND ($2::bigint=0 OR p.user_id=$2)
        AND NOT EXISTS(SELECT 1 FROM user_goodreads_test_profiles h WHERE h.user_id=p.user_id)
        AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id
            WHERE ur.user_id=p.user_id AND ro.name IN ('lector','administrador'))
        ORDER BY p.next_attempt_at,p.user_id FOR UPDATE OF p SKIP LOCKED LIMIT 1)
        UPDATE local_fold_in_profiles p SET status='processing',claim_token=$1::uuid,
            lease_until=now()+interval '60 seconds',updated_at=now()
        FROM next WHERE next.user_id=p.user_id RETURNING p.user_id,p.revision`, job.Token, onlyUser).Scan(&job.UserID, &job.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT b.goodreads_book_id,r.rating FROM book_ratings r JOIN books b ON b.id=r.book_id
        WHERE r.user_id=$1 ORDER BY b.goodreads_book_id NULLS LAST,b.id`, job.UserID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id *string
		var rating int
		if err = rows.Scan(&id, &rating); err != nil {
			rows.Close()
			return nil, err
		}
		job.LocalCount++
		if id != nil && *id != "" {
			job.Ratings = append(job.Ratings, LocalRating{BookID: *id, Rating: rating})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return job, nil
}

func (r *Repository) PublishFoldIn(ctx context.Context, job *FoldInJob, result FitResult) (bool, error) {
	var raw any
	if result.Profile != nil {
		bytes, err := json.Marshal(result.Profile)
		if err != nil {
			return false, err
		}
		raw = bytes
	}
	tag, err := r.pool.Exec(ctx, `UPDATE local_fold_in_profiles SET status=$4,reason=$5,
        input_count=$6,matched_count=$7,positive_count=$8,minimum_ratings=$9,model_signature=$10,
        profile=$11::jsonb,processed_revision=revision,claim_token=NULL,lease_until=NULL,updated_at=now()
        WHERE user_id=$1 AND revision=$2 AND claim_token=$3::uuid AND status='processing'`,
		job.UserID, job.Revision, job.Token, result.Status, result.Reason, job.LocalCount, result.MatchedCount,
		result.PositiveCount, result.MinimumRatings, result.ModelSignature, raw)
	return tag.RowsAffected() == 1, err
}

func (r *Repository) RetryFoldIn(ctx context.Context, job *FoldInJob) error {
	_, err := r.pool.Exec(ctx, `UPDATE local_fold_in_profiles SET status='error',reason='fit_unavailable',
        claim_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '30 seconds',updated_at=now()
        WHERE user_id=$1 AND revision=$2 AND claim_token=$3::uuid`, job.UserID, job.Revision, job.Token)
	return err
}
