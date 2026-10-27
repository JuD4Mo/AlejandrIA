package user

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(p *pgxpool.Pool) *Repository { return &Repository{p} }

const userSelect = `SELECT u.id,u.email,u.display_name,u.password_hash,u.is_active,u.created_at,COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id),'{}') FROM users u `

func scanUser(row pgx.Row) (User, error) {
	var u User
	e := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.PasswordHash, &u.Active, &u.CreatedAt, &u.Roles)
	return u, e
}
func (r *Repository) ByID(ctx context.Context, id int64) (User, error) {
	return scanUser(r.pool.QueryRow(ctx, userSelect+`WHERE u.id=$1`, id))
}
func (r *Repository) ByEmail(ctx context.Context, email string) (User, error) {
	return scanUser(r.pool.QueryRow(ctx, userSelect+`WHERE lower(btrim(u.email))=$1`, email))
}
func (r *Repository) List(ctx context.Context, limit, offset int) ([]User, error) {
	rows, e := r.pool.Query(ctx, userSelect+`ORDER BY u.id LIMIT $1 OFFSET $2`, limit, offset)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		u, e := scanUser(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
func (r *Repository) Create(ctx context.Context, input Register, hash string, admin bool) (User, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return User{}, e
	}
	defer tx.Rollback(ctx)
	role := "lector"
	if admin {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(714001)`); e != nil {
			return User{}, e
		}
		var exists bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.name='administrador')`).Scan(&exists)
		if e != nil {
			return User{}, e
		}
		if exists {
			return User{}, errs.NewConflictError("administrator already bootstrapped", false)
		}
		role = "administrador"
	}
	var id int64
	e = tx.QueryRow(ctx, `INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id`, input.Email, input.DisplayName, hash).Scan(&id)
	if e != nil {
		return User{}, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2`, id, role)
	if e != nil {
		return User{}, e
	}
	if e = tx.Commit(ctx); e != nil {
		return User{}, e
	}
	return r.ByID(ctx, id)
}
func (r *Repository) SetRoles(ctx context.Context, id int64, roles []string) error {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if e = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, id).Scan(&id); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id=$1`, id); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO user_roles SELECT $1,id FROM roles WHERE name=ANY($2::text[])`, id, roles)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (r *Repository) SetActive(ctx context.Context, id int64, active bool) error {
	tag, e := r.pool.Exec(ctx, `UPDATE users SET is_active=$2 WHERE id=$1`, id, active)
	if e == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return e
}
