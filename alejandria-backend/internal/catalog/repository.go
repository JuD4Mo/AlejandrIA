package catalog

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"strings"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(p *pgxpool.Pool) *Repository { return &Repository{p} }
func (r *Repository) SaveBook(ctx context.Context, id int64, p BookInput) (int64, error) {
	tx, e := r.pool.Begin(ctx)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback(ctx)
	args := []any{p.Title, p.WorkID, p.GoodreadsBookID, p.Description, p.ISBN, p.ISBN13, p.LanguageCode, p.PublicationYear, p.NumPages, p.ImageURL}
	if id == 0 {
		e = tx.QueryRow(ctx, `INSERT INTO books(title,work_id,goodreads_book_id,description,isbn,isbn13,language_code,publication_year,num_pages,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, args...).Scan(&id)
	} else {
		args = append(args, id)
		e = tx.QueryRow(ctx, `UPDATE books SET title=$1,work_id=$2,goodreads_book_id=$3,description=$4,isbn=$5,isbn13=$6,language_code=$7,publication_year=$8,num_pages=$9,image_url=$10 WHERE id=$11 RETURNING id`, args...).Scan(&id)
	}
	if e != nil {
		return 0, e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM book_authors WHERE book_id=$1`, id); e != nil {
		return 0, e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM book_genres WHERE book_id=$1`, id); e != nil {
		return 0, e
	}
	for _, a := range p.Authors {
		if _, e = tx.Exec(ctx, `INSERT INTO book_authors(book_id,author_id,role) VALUES($1,$2,$3)`, id, a.AuthorID, a.Role); e != nil {
			return 0, e
		}
	}
	for _, g := range p.GenreIDs {
		if _, e = tx.Exec(ctx, `INSERT INTO book_genres(book_id,genre_id) VALUES($1,$2)`, id, g); e != nil {
			return 0, e
		}
	}
	return id, tx.Commit(ctx)
}

const bookAvailable = `c.status='circulating' AND NOT EXISTS(SELECT 1 FROM loans l WHERE l.copy_id=c.id AND l.returned_at IS NULL) AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.copy_id=c.id AND r.status='ready')`
const bookFields = `SELECT b.id,b.title,b.work_id,b.goodreads_book_id,b.description,b.isbn,b.isbn13,b.language_code,b.publication_year,b.num_pages,b.image_url,COALESCE((SELECT jsonb_agg(jsonb_build_object('author_id',author_id,'role',role) ORDER BY author_id,role) FROM book_authors WHERE book_id=b.id),'[]'),COALESCE((SELECT array_agg(genre_id ORDER BY genre_id) FROM book_genres WHERE book_id=b.id),'{}'),(SELECT count(*) FROM book_copies c WHERE c.book_id=b.id),(SELECT count(*) FROM book_copies c WHERE c.book_id=b.id AND ` + bookAvailable + `),(SELECT count(*) FROM book_copies c WHERE c.book_id=b.id AND EXISTS(SELECT 1 FROM loans l WHERE l.copy_id=c.id AND l.returned_at IS NULL)),(SELECT count(*) FROM book_copies c WHERE c.book_id=b.id AND EXISTS(SELECT 1 FROM reservations r WHERE r.copy_id=c.id AND r.status='ready')),(SELECT count(*) FROM book_copies c WHERE c.book_id=b.id AND c.status<>'circulating')`
const selectBook = bookFields + ` FROM books b `

func scanBook(row pgx.Row) (Book, error) {
	var b Book
	e := row.Scan(&b.ID, &b.Title, &b.WorkID, &b.GoodreadsBookID, &b.Description, &b.ISBN, &b.ISBN13, &b.LanguageCode, &b.PublicationYear, &b.NumPages, &b.ImageURL, &b.Authors, &b.GenreIDs, &b.TotalCopies, &b.AvailableCopies, &b.LoanedCopies, &b.ReservedCopies, &b.NonCirculatingCopies)
	b.HasCopies = b.TotalCopies > 0
	b.HasAvailableCopies = b.AvailableCopies > 0
	return b, e
}
func (r *Repository) Book(ctx context.Context, id int64) (Book, error) {
	return scanBook(r.pool.QueryRow(ctx, selectBook+`WHERE b.id=$1`, id))
}
func (r *Repository) Books(ctx context.Context, f Filter) ([]Book, error) {
	query, args := bookPageQuery(f)
	rows, e := r.pool.Query(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Book{}
	for rows.Next() {
		b, e := scanBook(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Identificadores SQL solo proceden de esta allowlist fija, nunca del cliente.

// Solo se concatenan fragmentos SQL constantes. Todos los filtros son parámetros.
func bookPageQuery(f Filter) (string, []any) {
	where := []string{"true"}
	args := []any{}
	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if f.Title != "" {
		add(`b.title ILIKE '%%'||$%d||'%%'`, f.Title)
	}
	if f.AuthorID > 0 {
		add(`b.id IN (SELECT book_id FROM book_authors WHERE author_id=$%d)`, f.AuthorID)
	}
	if f.GenreID > 0 {
		add(`b.id IN (SELECT book_id FROM book_genres WHERE genre_id=$%d)`, f.GenreID)
	}
	if f.AfterID > 0 {
		add(`b.id>$%d`, f.AfterID)
	}
	if f.HasCopies != nil {
		op := "IN"
		if !*f.HasCopies {
			op = "NOT IN"
		}
		where = append(where, `b.id `+op+` (SELECT book_id FROM book_copies)`)
	}
	if f.Available != nil {
		op := "IN"
		if !*f.Available {
			op = "NOT IN"
		}
		where = append(where, `b.id `+op+` (SELECT c.book_id FROM book_copies c WHERE `+bookAvailable+`)`)
	}
	args = append(args, f.Limit, f.Offset)
	return fmt.Sprintf(`WITH page AS MATERIALIZED (SELECT b.* FROM books b WHERE %s ORDER BY b.id LIMIT $%d OFFSET $%d) `, strings.Join(where, " AND "), len(args)-1, len(args)) + bookFields + ` FROM page b ORDER BY b.id`, args
}

type resource struct{ table, column, external string }

var resources = map[string]resource{"works": {"works", "title", "goodreads_work_id"}, "authors": {"authors", "name", "goodreads_author_id"}, "genres": {"genres", "name", ""}, "books": {"books", "title", "goodreads_book_id"}}

func (r *Repository) Named(ctx context.Context, kind string, limit, offset int) ([]Named, error) {
	res := resources[kind]
	ext := "NULL::text"
	if res.external != "" {
		ext = res.external
	}
	rows, e := r.pool.Query(ctx, fmt.Sprintf(`SELECT id,%s,%s FROM %s ORDER BY id LIMIT $1 OFFSET $2`, res.column, ext, res.table), limit, offset)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Named{}
	for rows.Next() {
		var n Named
		if e = rows.Scan(&n.ID, &n.Value, &n.GoodreadsID); e != nil {
			return nil, e
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repository) NamedByID(ctx context.Context, kind string, id int64) (Named, error) {
	res := resources[kind]
	ext := "NULL::text"
	if res.external != "" {
		ext = res.external
	}
	var n Named
	e := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT id,%s,%s FROM %s WHERE id=$1`, res.column, ext, res.table), id).Scan(&n.ID, &n.Value, &n.GoodreadsID)
	return n, e
}
func (r *Repository) SaveNamed(ctx context.Context, kind string, id int64, p NamedInput) (int64, error) {
	res := resources[kind]
	v := p.Name
	if kind == "works" {
		v = p.Title
	}
	columns := res.column
	values := "$1"
	set := res.column + "=$1"
	args := []any{v}
	if res.external != "" {
		columns += "," + res.external
		values += ",$2"
		set += "," + res.external + "=$2"
		args = append(args, p.GoodreadsID)
	}
	q := fmt.Sprintf(`INSERT INTO %s(%s) VALUES(%s) RETURNING id`, res.table, columns, values)
	if id != 0 {
		args = append(args, id)
		q = fmt.Sprintf(`UPDATE %s SET %s WHERE id=$%d RETURNING id`, res.table, set, len(args))
	}
	e := r.pool.QueryRow(ctx, q, args...).Scan(&id)
	return id, e
}
func (r *Repository) Delete(ctx context.Context, kind string, id int64) error {
	res := resources[kind]
	tag, e := r.pool.Exec(ctx, `DELETE FROM `+res.table+` WHERE id=$1`, id)
	if e == nil && tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return e
}
