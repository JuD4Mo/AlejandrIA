// Package personalization gestiona preferencias de usuarios locales, no identidades Goodreads.
package personalization

import (
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"time"
)

type GenreSelection struct {
	GenreIDs []int64 `json:"genre_ids" validate:"max=100,dive,gt=0"`
}

func (p *GenreSelection) Validate() error {
	if p.GenreIDs == nil {
		return errs.NewBadRequestError("genre_ids must be an array; use [] to clear preferences", false, nil, nil, nil)
	}
	if len(p.GenreIDs) > 100 {
		return errs.NewBadRequestError("at most 100 genres are allowed", false, nil, nil, nil)
	}
	seen := make(map[int64]bool, len(p.GenreIDs))
	for _, id := range p.GenreIDs {
		if id <= 0 {
			return errs.NewBadRequestError("invalid genre identifier", false, nil, nil, nil)
		}
		if seen[id] {
			return errs.NewBadRequestError("duplicate genre identifier", false, nil, nil, nil)
		}
		seen[id] = true
	}
	return nil
}

type GenrePreference struct {
	GenreID   int64     `json:"genre_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}
type RatingInput struct {
	Rating int `json:"rating" validate:"min=1,max=5"`
}

func (p *RatingInput) Validate() error {
	if p.Rating < 1 || p.Rating > 5 {
		return errs.NewBadRequestError("rating must be an integer between 1 and 5", false, nil, nil, nil)
	}
	return nil
}

type Rating struct {
	BookID          int64     `json:"book_id"`
	Title           string    `json:"title"`
	GoodreadsBookID *string   `json:"goodreads_book_id"`
	Rating          int       `json:"rating"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}
type InteractionInput struct {
	BookID int64  `json:"book_id" validate:"gt=0"`
	Type   string `json:"interaction_type" validate:"oneof=view recommendation_click favorite_added favorite_removed"`
}

func (p *InteractionInput) Validate() error {
	if p.BookID <= 0 {
		return errs.NewBadRequestError("invalid book identifier", false, nil, nil, nil)
	}
	switch p.Type {
	case "view", "recommendation_click", "favorite_added", "favorite_removed":
		return nil
	}
	return errs.NewBadRequestError("invalid interaction type", false, nil, nil, nil)
}

type Interaction struct {
	ID              int64     `json:"id"`
	BookID          int64     `json:"book_id"`
	Title           string    `json:"title"`
	GoodreadsBookID *string   `json:"goodreads_book_id"`
	Type            string    `json:"interaction_type"`
	OccurredAt      time.Time `json:"occurred_at"`
}
