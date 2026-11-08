package inventory

import "context"

type Counts struct {
	Total     int `json:"total"`
	Available int `json:"available"`
}

// Availability devuelve conteos en una consulta y usa el mismo criterio que List.
func (r *Repository) Availability(ctx context.Context, ids []int64) (map[int64]Counts, error) {
	out := map[int64]Counts{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx, `SELECT b.id,count(c.id),count(c.id) FILTER(WHERE `+available+`) FROM books b LEFT JOIN book_copies c ON c.book_id=b.id WHERE b.id=ANY($1::bigint[]) GROUP BY b.id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var counts Counts
		if err = rows.Scan(&id, &counts.Total, &counts.Available); err != nil {
			return nil, err
		}
		out[id] = counts
	}
	return out, rows.Err()
}
func (s *Service) Availability(ctx context.Context, ids []int64) (map[int64]Counts, error) {
	return s.repo.Availability(ctx, ids)
}
