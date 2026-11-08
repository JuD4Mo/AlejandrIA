package circulation

import (
	"context"
	"encoding/json"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(p *pgxpool.Pool) *Repository { return &Repository{p} }

type transaction struct {
	tx              pgx.Tx
	ctx             context.Context
	now             time.Time
	book            int64
	assignmentStaff int64
}

func (r *Repository) within(ctx context.Context, book, reader int64, fn func(*transaction) error) error {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// Todas las operaciones de circulación e inventario adquieren primero el libro.
	var id int64
	if e = tx.QueryRow(ctx, `SELECT id FROM books WHERE id=$1 FOR UPDATE`, book).Scan(&id); e != nil {
		return e
	}
	if reader > 0 {
		if e = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, reader).Scan(&id); e != nil {
			return e
		}
	}
	t := &transaction{tx: tx, ctx: ctx, book: book}
	if e = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&t.now); e != nil {
		return e
	}
	if e = fn(t); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (r *Repository) request(ctx context.Context, id int64) (Request, error) {
	return readRequest(r.pool.QueryRow(ctx, `SELECT id,user_id,book_id,status FROM loan_requests WHERE id=$1`, id))
}
func readRequest(row pgx.Row) (Request, error) {
	var q Request
	e := row.Scan(&q.ID, &q.UserID, &q.BookID, &q.Status)
	return q, e
}
func (t *transaction) request(id int64) (Request, error) {
	return readRequest(t.tx.QueryRow(t.ctx, `SELECT id,user_id,book_id,status FROM loan_requests WHERE id=$1 FOR UPDATE`, id))
}
func (t *transaction) createRequest(reader int64) (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `INSERT INTO loan_requests(user_id,book_id,created_at) VALUES($1,$2,$3) RETURNING id`, reader, t.book, t.now).Scan(&id)
	return id, e
}

func (t *transaction) cancelRequest(id int64) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE loan_requests SET status='cancelled' WHERE id=$1`, id)
	return e
}
func (t *transaction) decideRequest(id, staff int64, status, note string) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE loan_requests SET status=$2,decided_at=$3,decided_by=$4,decision_note=$5 WHERE id=$1`, id, status, t.now, staff, note)
	return e
}
func (t *transaction) readerState(reader int64) (bool, int, bool, error) {
	var active, overdue bool
	var count int
	e := t.tx.QueryRow(t.ctx, `SELECT u.is_active,(SELECT count(*) FROM loans WHERE user_id=u.id AND returned_at IS NULL),EXISTS(SELECT 1 FROM loans WHERE user_id=u.id AND returned_at IS NULL AND due_at <= $2) FROM users u WHERE id=$1`, reader, t.now).Scan(&active, &count, &overdue)
	return active, count, overdue, e
}
func (t *transaction) expire() error {
	_, e := t.tx.Exec(t.ctx, `UPDATE reservations SET status='expired',closed_at=$2 WHERE book_id=$1 AND status='ready' AND pickup_expires_at <= $2`, t.book, t.now)
	return e
}
func (t *transaction) nextWaiting() (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `SELECT r.id FROM reservations r JOIN users u ON u.id=r.user_id WHERE r.book_id=$1 AND r.status='waiting' AND u.is_active ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r`, t.book).Scan(&id)
	return id, e
}
func (t *transaction) nextCopy() (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `SELECT c.id FROM book_copies c WHERE c.book_id=$1 AND c.status='circulating' AND NOT EXISTS(SELECT 1 FROM loans l WHERE l.copy_id=c.id AND l.returned_at IS NULL) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.copy_id=c.id AND r.status='ready') ORDER BY c.id LIMIT 1 FOR UPDATE OF c`, t.book).Scan(&id)
	return id, e
}
func (t *transaction) assign(reservation, copy int64) error {
	origin, staff := assignmentAudit(t.assignmentStaff)
	_, e := t.tx.Exec(t.ctx, `UPDATE reservations SET status='ready',copy_id=$2,assigned_at=$3,pickup_expires_at=$3::timestamptz+interval '72 hours',assigned_by=$4,assignment_origin=$5 WHERE id=$1`, reservation, copy, t.now, staff, origin)
	return e
}
func (t *transaction) createReservation(reader int64) (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `INSERT INTO reservations(user_id,book_id,created_at) VALUES($1,$2,$3) RETURNING id`, reader, t.book, t.now).Scan(&id)
	return id, e
}
func readReservation(row pgx.Row) (Reservation, error) {
	var q Reservation
	e := row.Scan(&q.ID, &q.UserID, &q.BookID, &q.Status, &q.CopyID, &q.ExpiresAt, &q.AssignedBy, &q.AssignmentOrigin)
	return q, e
}
func (r *Repository) reservation(ctx context.Context, id int64) (Reservation, error) {
	return readReservation(r.pool.QueryRow(ctx, `SELECT id,user_id,book_id,status,copy_id,pickup_expires_at,assigned_by,assignment_origin FROM reservations WHERE id=$1`, id))
}
func (t *transaction) reservation(id int64) (Reservation, error) {
	return readReservation(t.tx.QueryRow(t.ctx, `SELECT id,user_id,book_id,status,copy_id,pickup_expires_at,assigned_by,assignment_origin FROM reservations WHERE id=$1 FOR UPDATE`, id))
}
func (t *transaction) cancelReservation(id int64) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE reservations SET status='cancelled',closed_at=$2 WHERE id=$1`, id, t.now)
	return e
}
func (t *transaction) pendingRequest(reader int64) (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `SELECT id FROM loan_requests WHERE user_id=$1 AND book_id=$2 AND status='pending' FOR UPDATE`, reader, t.book).Scan(&id)
	return id, e
}
func (t *transaction) checkCopy(copy, reservation int64) error {
	var status string
	var book int64
	e := t.tx.QueryRow(t.ctx, `SELECT book_id,status FROM book_copies WHERE id=$1 FOR UPDATE`, copy).Scan(&book, &status)
	if e != nil {
		return e
	}
	if book != t.book || status != "circulating" {
		return errs.NewConflictError("copy is not eligible", false)
	}
	var busy bool
	e = t.tx.QueryRow(t.ctx, `SELECT EXISTS(SELECT 1 FROM loans WHERE copy_id=$1 AND returned_at IS NULL) OR EXISTS(SELECT 1 FROM reservations WHERE copy_id=$1 AND status='ready' AND id<>$2)`, copy, reservation).Scan(&busy)
	if e != nil {
		return e
	}
	if busy {
		return errs.NewConflictError("copy is already loaned or reserved", false)
	}
	return nil
}
func (t *transaction) insertLoan(request, reader, copy, staff int64) (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `INSERT INTO loans(request_id,user_id,book_id,copy_id,delivered_by,delivered_at,initial_due_at,due_at) VALUES($1,$2,$3,$4,$5,$6,$6::timestamptz+interval '720 hours',$6::timestamptz+interval '720 hours') RETURNING id`, request, reader, t.book, copy, staff, t.now).Scan(&id)
	return id, e
}
func (t *transaction) fulfill(reservation, loan int64) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE reservations SET status='fulfilled',closed_at=$3,loan_id=$2 WHERE id=$1`, reservation, loan, t.now)
	return e
}
func readLoan(row pgx.Row) (Loan, error) {
	var q Loan
	e := row.Scan(&q.ID, &q.UserID, &q.BookID, &q.CopyID, &q.DueAt, &q.ReturnedAt)
	return q, e
}
func (r *Repository) loan(ctx context.Context, id int64) (Loan, error) {
	return readLoan(r.pool.QueryRow(ctx, `SELECT id,user_id,book_id,copy_id,due_at,returned_at FROM loans WHERE id=$1`, id))
}
func (t *transaction) loan(id int64) (Loan, error) {
	return readLoan(t.tx.QueryRow(t.ctx, `SELECT id,user_id,book_id,copy_id,due_at,returned_at FROM loans WHERE id=$1 FOR UPDATE`, id))
}
func (t *transaction) returnLoan(id, staff int64) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE loans SET returned_at=$2,returned_by=$3 WHERE id=$1`, id, t.now, staff)
	return e
}
func (t *transaction) hasOtherReservations(reader int64) (bool, error) {
	var b bool
	e := t.tx.QueryRow(t.ctx, `SELECT EXISTS(SELECT 1 FROM reservations WHERE book_id=$1 AND user_id<>$2 AND status IN ('waiting','ready'))`, t.book, reader).Scan(&b)
	return b, e
}
func (t *transaction) hasApprovedRenewal(loan int64) (bool, error) {
	var b bool
	e := t.tx.QueryRow(t.ctx, `SELECT EXISTS(SELECT 1 FROM loan_renewals WHERE loan_id=$1 AND status='approved')`, loan).Scan(&b)
	return b, e
}
func (t *transaction) createRenewal(l Loan) (int64, error) {
	var id int64
	e := t.tx.QueryRow(t.ctx, `INSERT INTO loan_renewals(loan_id,requested_at,previous_due_at) VALUES($1,$2,$3) RETURNING id`, l.ID, t.now, l.DueAt).Scan(&id)
	return id, e
}

func (t *transaction) cancelRenewal(id int64) error {
	_, e := t.tx.Exec(t.ctx, `UPDATE loan_renewals SET status='cancelled' WHERE id=$1`, id)
	return e
}
func readRenewal(row pgx.Row) (Renewal, error) {
	var q Renewal
	e := row.Scan(&q.ID, &q.LoanID, &q.Status, &q.RequestedAt, &q.PreviousDueAt)
	return q, e
}
func (r *Repository) renewal(ctx context.Context, id int64) (Renewal, error) {
	return readRenewal(r.pool.QueryRow(ctx, `SELECT id,loan_id,status,requested_at,previous_due_at FROM loan_renewals WHERE id=$1`, id))
}
func (t *transaction) renewal(id int64) (Renewal, error) {
	return readRenewal(t.tx.QueryRow(t.ctx, `SELECT id,loan_id,status,requested_at,previous_due_at FROM loan_renewals WHERE id=$1 FOR UPDATE`, id))
}
func (t *transaction) decideRenewal(q Renewal, staff int64, approve bool, note string) error {
	status := "rejected"
	var due *time.Time
	if approve {
		status = "approved"
		d := q.PreviousDueAt.Add(30 * 24 * time.Hour)
		due = &d
	}
	if _, e := t.tx.Exec(t.ctx, `UPDATE loan_renewals SET status=$2,decided_at=$3,decided_by=$4,decision_note=$5,new_due_at=$6 WHERE id=$1`, q.ID, status, t.now, staff, note, due); e != nil {
		return e
	}
	if approve {
		_, e := t.tx.Exec(t.ctx, `UPDATE loans SET due_at=$2 WHERE id=$1`, q.LoanID, due)
		return e
	}
	return nil
}
func (r *Repository) actionableBooks(ctx context.Context) ([]int64, error) {
	rows, e := r.pool.Query(ctx, `SELECT b.id FROM books b WHERE EXISTS(SELECT 1 FROM reservations r WHERE r.book_id=b.id AND r.status='ready' AND r.pickup_expires_at<=clock_timestamp()) OR (EXISTS(SELECT 1 FROM reservations r JOIN users u ON u.id=r.user_id WHERE r.book_id=b.id AND r.status='waiting' AND u.is_active) AND EXISTS(SELECT 1 FROM book_copies c WHERE c.book_id=b.id AND c.status='circulating' AND NOT EXISTS(SELECT 1 FROM loans l WHERE l.copy_id=c.id AND l.returned_at IS NULL) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.copy_id=c.id AND r.status='ready'))) ORDER BY b.id LIMIT 100`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if e = rows.Scan(&id); e != nil {
			return nil, e
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
func (r *Repository) list(ctx context.Context, kind string, reader int64, limit, offset int) ([]json.RawMessage, error) {
	queries := map[string]string{
		"requests":     `SELECT row_to_json(q) FROM loan_requests q WHERE ($1::bigint=0 OR q.user_id=$1) ORDER BY q.id DESC LIMIT $2 OFFSET $3`,
		"loans":        `SELECT row_to_json(q) FROM loans q WHERE ($1::bigint=0 OR q.user_id=$1) ORDER BY q.id DESC LIMIT $2 OFFSET $3`,
		"reservations": `SELECT row_to_json(q) FROM reservations q WHERE ($1::bigint=0 OR q.user_id=$1) ORDER BY q.created_at,q.id LIMIT $2 OFFSET $3`,
		"renewals":     `SELECT row_to_json(q) FROM loan_renewals q JOIN loans l ON l.id=q.loan_id WHERE ($1::bigint=0 OR l.user_id=$1) ORDER BY q.id DESC LIMIT $2 OFFSET $3`,
	}
	rows, e := r.pool.Query(ctx, queries[kind], reader, limit, offset)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var j json.RawMessage
		if e = rows.Scan(&j); e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
