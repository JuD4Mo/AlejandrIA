package catalog

import "context"

// GoodreadsMatch nunca deduce identidad por título o ISBN.
type GoodreadsMatch struct {
	ID              int64  `json:"id"`
	GoodreadsBookID string `json:"goodreads_book_id"`
	Title           string `json:"title"`
}

func (r *Repository) LookupGoodreads(ctx context.Context, ids []string) ([]GoodreadsMatch, error) {
	out := []GoodreadsMatch{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx, `SELECT id,goodreads_book_id,title FROM books WHERE goodreads_book_id=ANY($1::text[]) ORDER BY id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b GoodreadsMatch
		if err = rows.Scan(&b.ID, &b.GoodreadsBookID, &b.Title); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func (s *Service) LookupGoodreads(ctx context.Context, ids []string) ([]GoodreadsMatch, error) {
	return s.repo.LookupGoodreads(ctx, ids)
}
