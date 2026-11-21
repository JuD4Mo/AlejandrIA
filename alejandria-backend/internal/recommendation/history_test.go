package recommendation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHistoryClientValidatesProvenanceRatingsAndPagination(t *testing.T) {
	for _, mode := range []string{"valid", "source", "rating", "pagination", "missing_page"} {
		t.Run(mode, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/api/v1/recommendations/history" {
					t.Error("wrong historical history endpoint")
				}
				var input HistoryRequest
				if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
					t.Error(err)
				}
				if input.GoodreadsUserID != "000historical" || input.Limit != 1 || input.Offset != 0 {
					t.Error("identity or pagination changed")
				}
				fakeLocalID := int64(999)
				out := HistoricalRatings{Source: "goodreads_train", ModelVersion: "v2", Total: 1, PositiveCount: 1, Limit: 1, Offset: 0, Data: []HistoricalRating{{GoodreadsBookID: "000123", Rating: 5, LocalBookID: &fakeLocalID}}}
				switch mode {
				case "source":
					out.Source = "goodreads_test"
				case "rating":
					out.Data[0].Rating = 0
				case "pagination":
					out.Offset = 1
				case "missing_page":
					out.Data = []HistoricalRating{}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer s.Close()
			out, err := NewClient(s.URL, time.Second).History(context.Background(), "000historical", 1, 0)
			if mode != "valid" {
				errorStatus(t, err, 502)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if out.Data[0].GoodreadsBookID != "000123" || out.Data[0].LocalBookID != nil {
				t.Fatal("original ID changed or upstream local ID trusted")
			}
		})
	}
}
