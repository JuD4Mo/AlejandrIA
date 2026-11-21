package recommendation

import (
	"context"
	"errors"

	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) HistoricalProfile(ctx context.Context, userID int64) (*HistoricalProfile, error) {
	var profile HistoricalProfile
	err := r.pool.QueryRow(ctx, `SELECT goodreads_user_id,model_version FROM user_goodreads_test_profiles WHERE user_id=$1`, userID).Scan(&profile.GoodreadsUserID, &profile.ModelVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// Todas las valoraciones (también negativas) y préstamos; máximo 500 exposiciones recientes.
func exclusions(ctx context.Context, db querier, userID int64) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT b.goodreads_book_id FROM book_ratings r
        JOIN books b ON b.id=r.book_id WHERE r.user_id=$1 AND b.goodreads_book_id IS NOT NULL
        UNION SELECT b.goodreads_book_id FROM loans l JOIN books b ON b.id=l.book_id
        WHERE l.user_id=$1 AND b.goodreads_book_id IS NOT NULL
        UNION SELECT goodreads_book_id FROM (
            SELECT goodreads_book_id FROM recommendation_exposures WHERE user_id=$1
            ORDER BY last_shown_at DESC,goodreads_book_id LIMIT 500) recent`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func (r *Repository) Exclusions(ctx context.Context, userID int64) ([]string, error) {
	return exclusions(ctx, r.pool, userID)
}

func (r *Repository) Refresh(ctx context.Context, userID int64, current []string, generate func([]string) (Response, error)) (Response, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Response{}, err
	}
	defer tx.Rollback(ctx)
	// Serializa solo generaciones del mismo lector, sin bloquear circulación ni valoraciones.
	var locked bool
	err = tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended('recommendations:' || $1::bigint::text,0))`, userID).Scan(&locked)
	if err != nil {
		return Response{}, err
	}
	if !locked {
		return Response{}, errs.NewConflictError("Ya hay una generación en curso para este usuario.", false)
	}
	ids, err := exclusions(ctx, tx, userID)
	if err != nil {
		return Response{}, err
	}
	ids = append(ids, current...)
	out, err := generate(ids)
	if err != nil {
		return Response{}, err
	}
	if out.Status == "ok" {
		shown := append([]string{}, current...)
		for _, item := range out.Recommendations {
			shown = append(shown, item.GoodreadsBookID)
		}
		_, err = tx.Exec(ctx, `INSERT INTO recommendation_exposures(user_id,goodreads_book_id,last_shown_at)
            SELECT $1,id,clock_timestamp() FROM (SELECT DISTINCT unnest($2::text[]) AS id) s
            ON CONFLICT(user_id,goodreads_book_id) DO UPDATE SET last_shown_at=EXCLUDED.last_shown_at`, userID, shown)
		if err != nil {
			return Response{}, err
		}
		_, err = tx.Exec(ctx, `DELETE FROM recommendation_exposures WHERE user_id=$1 AND goodreads_book_id NOT IN (
            SELECT goodreads_book_id FROM recommendation_exposures WHERE user_id=$1
            ORDER BY last_shown_at DESC,goodreads_book_id LIMIT 500)`, userID)
		if err != nil {
			return Response{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return Response{}, err
	}
	return out, nil
}
