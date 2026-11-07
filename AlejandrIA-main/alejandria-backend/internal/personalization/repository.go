package personalization

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) Preferences(ctx context.Context, user int64, limit, offset int) ([]GenrePreference, error) {
	rows, err := r.pool.Query(ctx, `SELECT p.genre_id,g.name,p.created_at FROM user_genre_preferences p JOIN genres g ON g.id=p.genre_id WHERE p.user_id=$1 ORDER BY p.genre_id LIMIT $2 OFFSET $3`, user, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GenrePreference{}
	for rows.Next() {
		var p GenrePreference
		if err = rows.Scan(&p.GenreID, &p.Name, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) ReplacePreferences(ctx context.Context, user int64, ids []int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serializa sustituciones del mismo usuario sin bloquear libros de circulación.
	if err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, user).Scan(&user); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT id FROM genres WHERE id=ANY($1::bigint[]) ORDER BY id FOR KEY SHARE`, ids)
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		count++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if count != len(ids) {
		return errs.NewBadRequestError("one or more genres do not exist", false, nil, nil, nil)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM user_genre_preferences WHERE user_id=$1 AND NOT (genre_id=ANY($2::bigint[]))`, user, ids); err != nil {
		return err
	}
	// Conserva created_at para géneros que siguen seleccionados.
	if _, err = tx.Exec(ctx, `INSERT INTO user_genre_preferences(user_id,genre_id) SELECT $1,unnest($2::bigint[]) ON CONFLICT(user_id,genre_id) DO NOTHING`, user, ids); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) DeletePreference(ctx context.Context, user, genre int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, user).Scan(&user); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM user_genre_preferences WHERE user_id=$1 AND genre_id=$2`, user, genre)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

func (r *Repository) Ratings(ctx context.Context, user int64, limit, offset int) ([]Rating, error) {
	rows, err := r.pool.Query(ctx, `SELECT r.book_id,b.title,b.goodreads_book_id,r.rating,r.created_at,r.updated_at FROM book_ratings r JOIN books b ON b.id=r.book_id WHERE r.user_id=$1 ORDER BY r.book_id LIMIT $2 OFFSET $3`, user, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Rating{}
	for rows.Next() {
		p, err := scanRating(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func scanRating(row pgx.Row) (Rating, error) {
	var p Rating
	err := row.Scan(&p.BookID, &p.Title, &p.GoodreadsBookID, &p.Rating, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}
func (r *Repository) PutRating(ctx context.Context, user, book int64, value int) (Rating, error) {
	return scanRating(r.pool.QueryRow(ctx, `WITH saved AS (
        INSERT INTO book_ratings(user_id,book_id,rating) VALUES($1,$2,$3)
        ON CONFLICT(user_id,book_id) DO UPDATE SET rating=EXCLUDED.rating,
          updated_at=GREATEST(clock_timestamp(),book_ratings.updated_at)
        RETURNING book_id,rating,created_at,updated_at
    ) SELECT s.book_id,b.title,b.goodreads_book_id,s.rating,s.created_at,s.updated_at FROM saved s JOIN books b ON b.id=s.book_id`, user, book, value))
}
func (r *Repository) DeleteRating(ctx context.Context, user, book int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM book_ratings WHERE user_id=$1 AND book_id=$2`, user, book)
	if err == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return err
}

func (r *Repository) Interactions(ctx context.Context, user int64, limit, offset int) ([]Interaction, error) {
	rows, err := r.pool.Query(ctx, `SELECT i.id,i.book_id,b.title,b.goodreads_book_id,i.interaction_type,i.occurred_at FROM user_book_interactions i JOIN books b ON b.id=i.book_id WHERE i.user_id=$1 ORDER BY i.occurred_at DESC,i.id DESC LIMIT $2 OFFSET $3`, user, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Interaction{}
	for rows.Next() {
		p, err := scanInteraction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func scanInteraction(row pgx.Row) (Interaction, error) {
	var p Interaction
	err := row.Scan(&p.ID, &p.BookID, &p.Title, &p.GoodreadsBookID, &p.Type, &p.OccurredAt)
	return p, err
}
func (r *Repository) AddInteraction(ctx context.Context, user int64, p InteractionInput) (Interaction, error) {
	return scanInteraction(r.pool.QueryRow(ctx, `WITH saved AS (
        INSERT INTO user_book_interactions(user_id,book_id,interaction_type) VALUES($1,$2,$3)
        RETURNING id,book_id,interaction_type,occurred_at
    ) SELECT s.id,s.book_id,b.title,b.goodreads_book_id,s.interaction_type,s.occurred_at FROM saved s JOIN books b ON b.id=s.book_id`, user, p.BookID, p.Type))
}
