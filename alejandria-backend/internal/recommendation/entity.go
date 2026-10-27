// Package recommendation integra inferencia remota sin entrenar ni asumir embeddings locales.
package recommendation

type Preferences struct {
	Genres   []string `json:"genres"`
	Authors  []string `json:"authors"`
	Keywords []string `json:"keywords"`
}
type PreferencesRequest struct {
	Preferences Preferences `json:"preferences"`
	Limit       int         `json:"limit"`
}
type UpstreamItem struct {
	BookID             string   `json:"book_id"`
	Title              *string  `json:"title"`
	Authors            []string `json:"authors"`
	Genres             []string `json:"genres"`
	Score              *float64 `json:"score"`
	Model              string   `json:"model"`
	ScoreScope         string   `json:"score_scope"`
	ContentScore       *float64 `json:"content_score"`
	CollaborativeScore *float64 `json:"collaborative_score"`
}
type UpstreamResponse struct {
	RecommendationType string         `json:"recommendation_type"`
	ModelVersion       string         `json:"model_version"`
	Count              int            `json:"count"`
	Recommendations    []UpstreamItem `json:"recommendations"`
}
type Item struct {
	GoodreadsBookID    string   `json:"goodreads_book_id"`
	LocalBookID        *int64   `json:"local_book_id"`
	InLocalCatalog     bool     `json:"in_local_catalog"`
	LocalTitle         *string  `json:"local_title"`
	TotalCopies        *int     `json:"total_copies"`
	AvailableCopies    *int     `json:"available_copies"`
	Available          *bool    `json:"available"`
	Title              *string  `json:"title"`
	Authors            []string `json:"authors"`
	Genres             []string `json:"genres"`
	Score              *float64 `json:"score"`
	Model              string   `json:"model"`
	ScoreScope         string   `json:"score_scope"`
	ContentScore       *float64 `json:"content_score"`
	CollaborativeScore *float64 `json:"collaborative_score"`
}
type Response struct {
	Status             string `json:"status"`
	Message            string `json:"message,omitempty"`
	Source             string `json:"source"`
	RecommendationType string `json:"recommendation_type"`
	ModelVersion       string `json:"model_version"`
	Count              int    `json:"count"`
	Recommendations    []Item `json:"recommendations"`
}
