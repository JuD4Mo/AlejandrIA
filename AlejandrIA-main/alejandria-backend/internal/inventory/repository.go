package inventory

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(p *pgxpool.Pool) *Repository { return &Repository{p} }

const available = `c.status='circulating' AND NOT EXISTS(SELECT 1 FROM loans l WHERE l.copy_id=c.id AND l.returned_at IS NULL) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.copy_id=c.id AND r.status='ready')`

func (r *Repository) List(ctx context.Context, book int64, limit, offset int) (Summary, error) {
	tx, e := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return Summary{}, e
	}
	defer tx.Rollback(ctx)
	var exists bool
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM books WHERE id=$1)`, book).Scan(&exists); e != nil {
		return Summary{}, e
	}
	if !exists {
		return Summary{}, pgx.ErrNoRows
	}
	s := Summary{Copies: []Copy{}}
	e = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE `+available+`) FROM book_copies c WHERE book_id=$1`, book).Scan(&s.Total, &s.Available)
	if e != nil {
		return s, e
	}
	rows, e := tx.Query(ctx, `SELECT c.id,c.book_id,c.inventory_code,c.status,c.location,`+available+` FROM book_copies c WHERE book_id=$1 ORDER BY c.id LIMIT $2 OFFSET $3`, book, limit, offset)
	if e != nil {
		return s, e
	}
	defer rows.Close()
	for rows.Next() {
		var c Copy
		if e = rows.Scan(&c.ID, &c.BookID, &c.InventoryCode, &c.Status, &c.Location, &c.Available); e != nil {
			return s, e
		}
		s.Copies = append(s.Copies, c)
	}
	if e = rows.Err(); e != nil {
		return s, e
	}
	rows.Close()
	return s, tx.Commit(ctx)
}
func (r *Repository) Save(ctx context.Context, book, id int64, p Input) (int64, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	if e = tx.QueryRow(ctx, `SELECT id FROM books WHERE id=$1 FOR UPDATE`, book).Scan(&book); e != nil {
		return 0, e
	}
	if id != 0 {
		var busy bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM loans WHERE copy_id=$1 AND returned_at IS NULL) OR EXISTS(SELECT 1 FROM reservations WHERE copy_id=$1 AND status='ready')`, id).Scan(&busy)
		if e != nil {
			return 0, e
		}
		if busy && p.Status != "circulating" {
			return 0, errs.NewConflictError("copy has an active loan or ready reservation", false)
		}
		e = tx.QueryRow(ctx, `UPDATE book_copies SET inventory_code=$3,status=$4,location=$5 WHERE id=$1 AND book_id=$2 RETURNING id`, id, book, p.InventoryCode, p.Status, p.Location).Scan(&id)
	} else {
		e = tx.QueryRow(ctx, `INSERT INTO book_copies(book_id,inventory_code,status,location) VALUES($1,$2,$3,$4) RETURNING id`, book, p.InventoryCode, p.Status, p.Location).Scan(&id)
	}
	if e != nil {
		return 0, e
	}
	return id, tx.Commit(ctx)
}
