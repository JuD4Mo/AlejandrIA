package catalog

import (
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"strings"
)

type AuthorLink struct {
	AuthorID int64  `json:"author_id" validate:"gt=0"`
	Role     string `json:"role" validate:"required,max=100"`
}
type BookInput struct {
	Title           string       `json:"title" validate:"required,max=1000"`
	WorkID          *int64       `json:"work_id" validate:"omitempty,gt=0"`
	GoodreadsBookID *string      `json:"goodreads_book_id"`
	Description     *string      `json:"description"`
	ISBN            *string      `json:"isbn"`
	ISBN13          *string      `json:"isbn13"`
	LanguageCode    *string      `json:"language_code"`
	PublicationYear *int         `json:"publication_year"`
	NumPages        *int         `json:"num_pages" validate:"omitempty,gt=0"`
	ImageURL        *string      `json:"image_url"`
	Authors         []AuthorLink `json:"authors" validate:"dive"`
	GenreIDs        []int64      `json:"genre_ids" validate:"dive,gt=0"`
}

func (p *BookInput) Validate() error {
	p.Title = strings.TrimSpace(p.Title)
	if p.GoodreadsBookID != nil && strings.TrimSpace(*p.GoodreadsBookID) == "" {
		return errs.NewBadRequestError("empty Goodreads identifier", false, nil, nil, nil)
	}
	return nil
}

type Book struct {
	ID int64 `json:"id"`
	BookInput
}
type NamedInput struct {
	Name        string  `json:"name"`
	Title       string  `json:"title"`
	GoodreadsID *string `json:"goodreads_id"`
}

func (p *NamedInput) Validate() error {
	p.Name = strings.TrimSpace(p.Name)
	p.Title = strings.TrimSpace(p.Title)
	if p.Name == "" && p.Title == "" {
		return errs.NewBadRequestError("name or title required", false, nil, nil, nil)
	}
	return nil
}

type Named struct {
	ID          int64   `json:"id"`
	Value       string  `json:"value"`
	GoodreadsID *string `json:"goodreads_id,omitempty"`
}
type Filter struct {
	Title         string
	AuthorID      int64
	GenreID       int64
	Limit, Offset int
}
