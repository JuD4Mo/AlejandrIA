package recommendation

import (
	"context"
	"time"
)

type LocalRating struct {
	BookID string `json:"book_id"`
	Rating int    `json:"rating"`
}
type LocalVector struct {
	ModelSignature  string    `json:"model_signature"`
	InputHash       string    `json:"input_hash"`
	Vector          []float64 `json:"vector"`
	Bias            float64   `json:"bias"`
	PositiveBookIDs []string  `json:"positive_book_ids"`
}
type LocalModelInfo struct {
	ModelSignature string  `json:"model_signature"`
	ModelVersion   string  `json:"model_version"`
	Algorithm      string  `json:"algorithm"`
	Factors        int     `json:"factors"`
	MinimumRatings int     `json:"minimum_ratings"`
	Regularization float64 `json:"regularization"`
	ContentWeight  float64 `json:"content_weight"`
	PolicyStatus   string  `json:"policy_status"`
}
type FitResult struct {
	Status         string       `json:"status"`
	Reason         string       `json:"reason"`
	InputCount     int          `json:"input_count"`
	MatchedCount   int          `json:"matched_count"`
	PositiveCount  int          `json:"positive_count"`
	MinimumRatings int          `json:"minimum_ratings"`
	ModelSignature string       `json:"model_signature"`
	Factors        int          `json:"factors"`
	Profile        *LocalVector `json:"profile"`
}

// FoldInStatus es público; el vector y el historial numérico nunca se envían al navegador.
type FoldInStatus struct {
	Status            string     `json:"status"`
	Reason            string     `json:"reason,omitempty"`
	InputCount        int        `json:"input_count"`
	MatchedCount      int        `json:"matched_count"`
	PositiveCount     int        `json:"positive_count"`
	MinimumRatings    int        `json:"minimum_ratings"`
	Revision          int64      `json:"revision"`
	ProcessedRevision int64      `json:"processed_revision"`
	UpdatedAt         *time.Time `json:"updated_at,omitempty"`
}
type LocalState struct {
	FoldInStatus
	Profile *LocalVector
}
type FoldInJob struct {
	UserID     int64
	Revision   int64
	Token      string
	LocalCount int
	Ratings    []LocalRating
}
type FoldInInference interface {
	LocalModel(context.Context) (LocalModelInfo, error)
	FitLocal(context.Context, LocalModelInfo, []LocalRating) (FitResult, error)
}
