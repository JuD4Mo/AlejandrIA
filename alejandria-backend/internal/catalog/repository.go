package catalog

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

const selectBook = `SELECT b.id,b.title,b.work_id,b.goodreads_book_id,b.description,b.isbn,b.isbn13,b.language_code,b.publication_year,b.num_pages,b.image_url,COALESCE((SELECT jsonb_agg(jsonb_build_object('author_id',author_id,'role',role) ORDER BY author_id,role) FROM book_authors WHERE book_id=b.id),'[]'),COALESCE((SELECT array_agg(genre_id ORDER BY genre_id) FROM book_genres WHERE book_id=b.id),'{}') FROM books b `

func scanBook(row pgx.Row) (Book, error) {
	var b Book
	e := row.Scan(&b.ID, &b.Title, &b.WorkID, &b.GoodreadsBookID, &b.Description, &b.ISBN, &b.ISBN13, &b.LanguageCode, &b.PublicationYear, &b.NumPages, &b.ImageURL, &b.Authors, &b.GenreIDs)
	return b, e
}
func (r *Repository) Book(ctx context.Context, id int64) (Book, error) {
	return scanBook(r.pool.QueryRow(ctx, selectBook+`WHERE b.id=$1`, id))
}
func (r *Repository) Books(ctx context.Context, f Filter) ([]Book, error) {
	rows, e := r.pool.Query(ctx, selectBook+`WHERE ($1='' OR b.title ILIKE '%'||$1||'%') AND ($2::bigint=0 OR EXISTS(SELECT 1 FROM book_authors WHERE book_id=b.id AND author_id=$2)) AND ($3::bigint=0 OR EXISTS(SELECT 1 FROM book_genres WHERE book_id=b.id AND genre_id=$3)) ORDER BY b.id LIMIT $4 OFFSET $5`, f.Title, f.AuthorID, f.GenreID, f.Limit, f.Offset)
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
