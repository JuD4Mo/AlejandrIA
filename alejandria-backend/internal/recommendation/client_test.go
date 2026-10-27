package recommendation

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func validResponse(kind string) UpstreamResponse {
	score := 0.8
	model := "content_cold_start"
	if kind == "similar" {
		model = "content_similar"
	}
	return UpstreamResponse{RecommendationType: kind, ModelVersion: "v2", Count: 1, Recommendations: []UpstreamItem{{BookID: "000123", Score: &score, Model: model, ScoreScope: "content_catalog"}}}
}
func errorStatus(t *testing.T, err error, want int) {
	t.Helper()
	var e *errs.HTTPError
	if !errors.As(err, &e) || e.Status != want {
		t.Fatalf("got %v, expected HTTP %d", err, want)
	}
}
func TestClientValidatesUpstreamContract(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		response    func() any
		contentType string
		want        int
	}{
		{"valid", 200, func() any { return validResponse("similar") }, "application/json", 0},
		{"not ready", 503, func() any { return map[string]string{"detail": "sensitive internal path"} }, "application/json", 503},
		{"missing Goodreads id", 404, func() any { return nil }, "application/json", 404},
		{"upstream failure", 500, func() any { return nil }, "application/json", 502},
		{"wrong version", 200, func() any { p := validResponse("similar"); p.ModelVersion = "v1"; return p }, "application/json", 502},
		{"mixed scope", 200, func() any {
			p := validResponse("similar")
			p.Recommendations[0].ScoreScope = "collaborative_catalog"
			return p
		}, "application/json", 502},
		{"wrong count", 200, func() any { p := validResponse("similar"); p.Count = 5; return p }, "application/json", 502},
		{"wrong type", 200, func() any { return validResponse("content") }, "application/json", 502},
		{"non JSON", 200, func() any { return validResponse("similar") }, "text/html", 502},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/recommendations/similar/000123" || r.URL.Query().Get("limit") != "1" {
					t.Error("changed Goodreads id or endpoint")
				}
				w.Header().Set("Content-Type", tc.contentType)
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(tc.response())
			}))
			defer server.Close()
			client := NewClient(server.URL, time.Second)
			result, err := client.Similar(context.Background(), "000123", 1)
			if tc.want != 0 {
				errorStatus(t, err, tc.want)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if result.Recommendations[0].BookID != "000123" {
				t.Fatal("lost leading zeros")
			}
		})
	}
}
func TestClientTimeoutCancellationAndUnavailable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	client := NewClient(server.URL, 15*time.Millisecond)
	_, err := client.Similar(context.Background(), "1", 1)
	errorStatus(t, err, 504)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.Similar(ctx, "1", 1)
	if !errors.Is(err, context.Canceled) {
		t.Fatal("context cancellation was lost")
	}
	server.Close()
	_, err = NewClient(server.URL, time.Second).Similar(context.Background(), "1", 1)
	errorStatus(t, err, 503)
}
func TestClientRejectsMalformedJSONAndRedirects(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{{"malformed", "{", 200}, {"multiple values", "{} {}", 200}, {"oversized", string(make([]byte, maxResponseBytes+1)), 200}, {"redirect", "", 307}} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Location", "http://localhost:1/forbidden")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			_, err := NewClient(s.URL, time.Second).Similar(context.Background(), "1", 1)
			errorStatus(t, err, 502)
		})
	}
}
