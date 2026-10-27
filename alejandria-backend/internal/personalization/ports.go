package personalization

import "context"

// Store delimita persistencia para probar autorización y políticas sin PostgreSQL.
type Store interface {
	Preferences(context.Context, int64, int, int) ([]GenrePreference, error)
	ReplacePreferences(context.Context, int64, []int64) error
	DeletePreference(context.Context, int64, int64) error
	Ratings(context.Context, int64, int, int) ([]Rating, error)
	PutRating(context.Context, int64, int64, int) (Rating, error)
	DeleteRating(context.Context, int64, int64) error
	Interactions(context.Context, int64, int, int) ([]Interaction, error)
	AddInteraction(context.Context, int64, InteractionInput) (Interaction, error)
}
