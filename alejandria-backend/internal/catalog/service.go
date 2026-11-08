package catalog

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
)

type Service struct{ repo *Repository }

func (s *Service) NamedByID(ctx context.Context, kind string, id int64) (Named, error) {
	return s.repo.NamedByID(ctx, kind, id)
}

func NewService(r *Repository) *Service { return &Service{r} }
func (s *Service) SaveBook(ctx context.Context, id int64, p BookInput) (Book, error) {
	if e := p.Validate(); e != nil {
		return Book{}, e
	}
	id, e := s.repo.SaveBook(ctx, id, p)
	if e != nil {
		return Book{}, e
	}
	return s.repo.Book(ctx, id)
}
func (s *Service) Book(ctx context.Context, id int64) (Book, error)    { return s.repo.Book(ctx, id) }
func (s *Service) Books(ctx context.Context, f Filter) ([]Book, error) { return s.repo.Books(ctx, f) }
func (s *Service) Named(ctx context.Context, kind string, limit, offset int) ([]Named, error) {
	return s.repo.Named(ctx, kind, limit, offset)
}
func (s *Service) SaveNamed(ctx context.Context, kind string, id int64, p NamedInput) (int64, error) {
	if e := p.Validate(); e != nil {
		return 0, e
	}
	if (kind == "works" && p.Title == "") || (kind != "works" && p.Name == "") {
		return 0, errs.NewBadRequestError("missing resource name/title", false, nil, nil, nil)
	}
	return s.repo.SaveNamed(ctx, kind, id, p)
}
func (s *Service) Delete(ctx context.Context, kind string, id int64) error {
	return s.repo.Delete(ctx, kind, id)
}
