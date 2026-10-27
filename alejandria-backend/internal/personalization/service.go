package personalization

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
)

type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }
func reader(actor user.User) error {
	if actor.ID <= 0 || !actor.Active || !actor.HasRole("lector", "administrador") {
		return errs.NewForbiddenError("active reader role required", false)
	}
	return nil
}
func (s *Service) Preferences(ctx context.Context, actor user.User, limit, offset int) ([]GenrePreference, error) {
	if err := reader(actor); err != nil {
		return nil, err
	}
	return s.store.Preferences(ctx, actor.ID, limit, offset)
}
func (s *Service) ReplacePreferences(ctx context.Context, actor user.User, input GenreSelection) error {
	if err := reader(actor); err != nil {
		return err
	}
	if err := input.Validate(); err != nil {
		return err
	}
	return s.store.ReplacePreferences(ctx, actor.ID, input.GenreIDs)
}
func (s *Service) DeletePreference(ctx context.Context, actor user.User, id int64) error {
	if err := reader(actor); err != nil {
		return err
	}
	if id <= 0 {
		return errs.NewBadRequestError("invalid genre identifier", false, nil, nil, nil)
	}
	return s.store.DeletePreference(ctx, actor.ID, id)
}
func (s *Service) Ratings(ctx context.Context, actor user.User, limit, offset int) ([]Rating, error) {
	if err := reader(actor); err != nil {
		return nil, err
	}
	return s.store.Ratings(ctx, actor.ID, limit, offset)
}
func (s *Service) PutRating(ctx context.Context, actor user.User, book int64, input RatingInput) (Rating, error) {
	if err := reader(actor); err != nil {
		return Rating{}, err
	}
	if book <= 0 {
		return Rating{}, errs.NewBadRequestError("invalid book identifier", false, nil, nil, nil)
	}
	if err := input.Validate(); err != nil {
		return Rating{}, err
	}
	return s.store.PutRating(ctx, actor.ID, book, input.Rating)
}
func (s *Service) DeleteRating(ctx context.Context, actor user.User, book int64) error {
	if err := reader(actor); err != nil {
		return err
	}
	if book <= 0 {
		return errs.NewBadRequestError("invalid book identifier", false, nil, nil, nil)
	}
	return s.store.DeleteRating(ctx, actor.ID, book)
}
func (s *Service) Interactions(ctx context.Context, actor user.User, limit, offset int) ([]Interaction, error) {
	if err := reader(actor); err != nil {
		return nil, err
	}
	return s.store.Interactions(ctx, actor.ID, limit, offset)
}
func (s *Service) AddInteraction(ctx context.Context, actor user.User, input InteractionInput) (Interaction, error) {
	if err := reader(actor); err != nil {
		return Interaction{}, err
	}
	if err := input.Validate(); err != nil {
		return Interaction{}, err
	}
	return s.store.AddInteraction(ctx, actor.ID, input)
}
