package recommendation

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
)

func validHash(value string) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == 32 && len(value) == 64
}
func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func ratingsHash(ratings []LocalRating) string {
	ordered := append([]LocalRating{}, ratings...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].BookID < ordered[j].BookID })
	digest := sha256.New()
	for _, r := range ordered {
		_, _ = fmt.Fprintf(digest, "%d:%s:%d\n", len([]byte(r.BookID)), r.BookID, r.Rating)
	}
	return hex.EncodeToString(digest.Sum(nil))
}
func validVector(p *LocalVector, info LocalModelInfo) bool {
	if p == nil || p.ModelSignature != info.ModelSignature || !validHash(p.InputHash) || len(p.Vector) != info.Factors || !finite(p.Bias) || len(p.PositiveBookIDs) == 0 {
		return false
	}
	for _, x := range p.Vector {
		if !finite(x) {
			return false
		}
	}
	for _, id := range p.PositiveBookIDs {
		if id == "" {
			return false
		}
	}
	return true
}
func (c *Client) LocalModel(ctx context.Context) (LocalModelInfo, error) {
	var out LocalModelInfo
	if err := c.requestJSON(ctx, http.MethodGet, "/api/v1/recommendations/local/model", nil, "local_model", &out); err != nil {
		return out, err
	}
	if !validHash(out.ModelSignature) || out.ModelVersion != "v2" || out.Algorithm != "ridge_fold_in_v1" || out.Factors < 1 || out.Factors > 1024 || out.MinimumRatings < 1 || !finite(out.Regularization) || out.Regularization <= 0 || !finite(out.ContentWeight) || out.ContentWeight <= 0 || out.ContentWeight >= 1 {
		return out, invalidResponse()
	}
	return out, nil
}
func (c *Client) FitLocal(ctx context.Context, info LocalModelInfo, ratings []LocalRating) (FitResult, error) {
	var out FitResult
	if ratings == nil {
		ratings = []LocalRating{}
	}
	body, err := json.Marshal(struct {
		ExpectedSignature string        `json:"expected_signature"`
		Ratings           []LocalRating `json:"ratings"`
	}{info.ModelSignature, ratings})
	if err != nil {
		return out, err
	}
	if err = c.requestJSON(ctx, http.MethodPost, "/api/v1/recommendations/local/fit", body, "local_fit", &out); err != nil {
		return out, err
	}
	if out.ModelSignature != info.ModelSignature || out.Factors != info.Factors || out.MinimumRatings != info.MinimumRatings || out.InputCount != len(ratings) || out.MatchedCount < 0 || out.MatchedCount > out.InputCount || out.PositiveCount < 0 || out.PositiveCount > out.InputCount {
		return out, invalidResponse()
	}
	if out.Status == "ready" {
		if out.MatchedCount < info.MinimumRatings || !validVector(out.Profile, info) || out.Profile.InputHash != ratingsHash(ratings) {
			return out, invalidResponse()
		}
		positive := map[string]bool{}
		for _, r := range ratings {
			if r.Rating >= 4 {
				positive[r.BookID] = true
			}
		}
		if len(out.Profile.PositiveBookIDs) != out.PositiveCount {
			return out, invalidResponse()
		}
		for _, id := range out.Profile.PositiveBookIDs {
			if !positive[id] {
				return out, invalidResponse()
			}
			delete(positive, id)
		}
	} else if out.Status != "insufficient" || out.Profile != nil {
		return out, invalidResponse()
	}
	return out, nil
}
func (c *Client) LocalHybrid(ctx context.Context, profile LocalVector, limit int, excluded []string) (UpstreamResponse, error) {
	var out UpstreamResponse
	if excluded == nil {
		excluded = []string{}
	}
	if err := validateLimit(limit); err != nil {
		return out, err
	}
	body, err := json.Marshal(struct {
		Profile        LocalVector `json:"profile"`
		Limit          int         `json:"limit"`
		ExcludeBookIDs []string    `json:"exclude_book_ids"`
	}{profile, limit, excluded})
	if err != nil {
		return out, err
	}
	if err = c.requestJSON(ctx, http.MethodPost, "/api/v1/recommendations/local/hybrid", body, "local_hybrid", &out); err != nil {
		return out, err
	}
	if out.ModelSignature != profile.ModelSignature {
		return out, invalidResponse()
	}
	if err = validateResponse(out, "hybrid", limit); err != nil {
		return out, err
	}
	return out, nil
}
