package recommendation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFoldInClientValidatesSignatureDimensionsAndReadiness(t *testing.T) {
	for _, mode := range []string{"valid", "wrong_signature", "wrong_dimensions", "wrong_snapshot", "insufficient_with_vector"} {
		t.Run(mode, func(t *testing.T) {
			sig := strings.Repeat("a", 64)
			info := LocalModelInfo{ModelSignature: sig, ModelVersion: "v2", Algorithm: "ridge_fold_in_v1", Factors: 2, MinimumRatings: 5, Regularization: 0.01, ContentWeight: 0.9, PolicyStatus: "experimental_validation_selected"}
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/api/v1/recommendations/local/model" {
					_ = json.NewEncoder(w).Encode(info)
					return
				}
				if r.URL.Path != "/api/v1/recommendations/local/fit" {
					t.Error("wrong adaptation operation")
				}
				var input struct {
					ExpectedSignature string        `json:"expected_signature"`
					Ratings           []LocalRating `json:"ratings"`
				}
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
					t.Error(err)
				}
				if input.ExpectedSignature != sig || len(input.Ratings) != 5 {
					t.Error("snapshot or model version lost")
				}
				out := FitResult{Status: "ready", InputCount: 5, MatchedCount: 5, PositiveCount: 1, MinimumRatings: 5, ModelSignature: sig, Factors: 2, Profile: &LocalVector{ModelSignature: sig, InputHash: ratingsHash(input.Ratings), Vector: []float64{0.1, 0.2}, PositiveBookIDs: []string{"0001"}}}
				switch mode {
				case "wrong_signature":
					out.ModelSignature = strings.Repeat("c", 64)
				case "wrong_dimensions":
					out.Profile.Vector = []float64{0.1}
				case "wrong_snapshot":
					out.Profile.InputHash = strings.Repeat("c", 64)
				case "insufficient_with_vector":
					out.Status = "insufficient"
				}
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer s.Close()
			client := NewClient(s.URL, time.Second)
			loaded, err := client.LocalModel(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.FitLocal(context.Background(), loaded, []LocalRating{{BookID: "0001", Rating: 5}, {BookID: "2", Rating: 4}, {BookID: "3", Rating: 1}, {BookID: "4", Rating: 2}, {BookID: "5", Rating: 3}})
			if mode == "valid" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				errorStatus(t, err, 502)
			}
		})
	}
}
