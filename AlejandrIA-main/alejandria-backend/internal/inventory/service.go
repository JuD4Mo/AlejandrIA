package inventory

import "context"

// Las consultas son lecturas puras. Circulación reconcilia en escrituras y worker.
type Service struct{ repo *Repository }

func NewService(r *Repository) *Service { return &Service{repo: r} }
func (s *Service) List(ctx context.Context, book int64, limit, offset int) (Summary, error) {
	return s.repo.List(ctx, book, limit, offset)
}
func (s *Service) Save(ctx context.Context, book, id int64, p Input) (int64, error) {
	if e := p.Validate(); e != nil {
		return 0, e
	}
	return s.repo.Save(ctx, book, id, p)
}
