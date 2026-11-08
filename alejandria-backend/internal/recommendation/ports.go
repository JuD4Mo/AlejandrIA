package recommendation

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
)

type Inference interface {
	Preferences(context.Context, Preferences, int) (UpstreamResponse, error)
	Similar(context.Context, string, int) (UpstreamResponse, error)
}
type Catalog interface {
	Book(context.Context, int64) (catalog.Book, error)
	LookupGoodreads(context.Context, []string) ([]catalog.GoodreadsMatch, error)
}
type Personalization interface {
	Preferences(context.Context, user.User, int, int) ([]personalization.GenrePreference, error)
	Ratings(context.Context, user.User, int, int) ([]personalization.Rating, error)
}
type Inventory interface {
	Availability(context.Context, []int64) (map[int64]inventory.Counts, error)
}
