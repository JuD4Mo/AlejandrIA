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
	Hybrid(context.Context, string, int, []string) (UpstreamResponse, error)
	History(context.Context, string, int, int) (HistoricalRatings, error)
	LocalHybrid(context.Context, LocalVector, int, []string) (UpstreamResponse, error)
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

type SelectionStore interface {
	LocalState(context.Context, int64) (*LocalState, error)
	HistoricalProfile(context.Context, int64) (*HistoricalProfile, error)
	Exclusions(context.Context, int64) ([]string, error)
	Refresh(context.Context, int64, []string, func([]string) (Response, error)) (Response, error)
}
