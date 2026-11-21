//go:build integration

package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
)

func TestLinkedHistoricalProfilesUseHybridWithPersistentExclusions(t *testing.T) {
	f := setup(t)
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/v1/recommendations/hybrid" {
			t.Error("historical profile sent to content cold-start")
		}
		var input recommendation.HybridRequest
		must(t, json.NewDecoder(r.Body).Decode(&input))
		if input.GoodreadsUserID != "000historical" {
			t.Error("local ID used as historical ID")
		}
		rows := []recommendation.UpstreamItem{}
		score, content, collab := 0.8, 0.4, 4.2
		for i := 0; i < 8 && len(rows) < input.Limit; i++ {
			id := fmt.Sprintf("historical-book-%d", i)
			if !slices.Contains(input.ExcludeBookIDs, id) {
				rows = append(rows, recommendation.UpstreamItem{BookID: id, Score: &score, ContentScore: &content, CollaborativeScore: &collab, Model: "hybrid", ScoreScope: "collaborative_catalog"})
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(recommendation.UpstreamResponse{RecommendationType: "hybrid", ModelVersion: "v2", Count: len(rows), Recommendations: rows})
	}))
	defer upstream.Close()
	repo := recommendation.NewRepository(f.pool)
	s := recommendation.NewService(recommendation.NewClient(upstream.URL, time.Second), catalog.NewService(catalog.NewRepository(f.pool)), personalization.NewService(personalization.NewRepository(f.pool)), inventory.NewService(inventory.NewRepository(f.pool)), repo)
	unlinked, err := s.ForReader(f.ctx, f.a, 2)
	must(t, err)
	if unlinked.Status != "preferences_required" || calls != 0 {
		t.Fatal("unlinked reader used historical model")
	}
	_, err = f.pool.Exec(f.ctx, `INSERT INTO user_goodreads_test_profiles(user_id,goodreads_user_id,model_version,created_by) VALUES($1,'000historical','v2',$2)`, f.a.ID, f.staff.ID)
	must(t, err)
	linked, err := user.NewRepository(f.pool).ByID(f.ctx, f.a.ID)
	must(t, err)
	if linked.RecommendationProfile != "goodreads_test" {
		t.Fatal("test profile missing from identity metadata")
	}
	first, err := s.ForReader(f.ctx, linked, 2)
	must(t, err)
	if first.ProfileOrigin != "goodreads_test" || first.RecommendationType != "hybrid" || first.Count != 2 {
		t.Fatalf("wrong historical response: %+v", first)
	}
	current := []string{first.Recommendations[0].GoodreadsBookID, first.Recommendations[1].GoodreadsBookID}
	next, err := s.Refresh(f.ctx, linked, 2, current)
	must(t, err)
	for _, item := range next.Recommendations {
		if slices.Contains(current, item.GoodreadsBookID) || item.CollaborativeScore == nil || item.ContentScore == nil {
			t.Fatal("hybrid repeated or fabricated components")
		}
	}
	other, err := s.ForReader(f.ctx, f.b, 2)
	must(t, err)
	if other.ProfileOrigin != "" || other.RecommendationType != "content" {
		t.Fatal("profile link leaked to another account")
	}
	before := calls
	_, err = f.pool.Exec(f.ctx, `UPDATE user_goodreads_test_profiles SET model_version='v3' WHERE user_id=$1`, f.a.ID)
	must(t, err)
	_, err = s.ForReader(f.ctx, linked, 2)
	if err == nil || calls != before {
		t.Fatal("stale model mapping used silently")
	}
}
