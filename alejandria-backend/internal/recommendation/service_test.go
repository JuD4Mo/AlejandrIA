package recommendation

import (
	"context"
	"encoding/json"
	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

type localData struct {
	genres   []personalization.GenrePreference
	ratings  []personalization.Rating
	book     catalog.Book
	matches  []catalog.GoodreadsMatch
	counts   map[int64]inventory.Counts
	seenUser int64
}

func (d *localData) Preferences(_ context.Context, u user.User, _, _ int) ([]personalization.GenrePreference, error) {
	d.seenUser = u.ID
	return d.genres, nil
}
func (d *localData) Ratings(_ context.Context, u user.User, _, _ int) ([]personalization.Rating, error) {
	d.seenUser = u.ID
	return d.ratings, nil
}
func (d *localData) Book(context.Context, int64) (catalog.Book, error) { return d.book, nil }
func (d *localData) LookupGoodreads(context.Context, []string) ([]catalog.GoodreadsMatch, error) {
	return d.matches, nil
}
func (d *localData) Availability(context.Context, []int64) (map[int64]inventory.Counts, error) {
	return d.counts, nil
}
func reader() user.User { return user.User{ID: 77, Active: true, Roles: []string{"lector"}} }
func TestLocalReaderPreferencesAndEnrichment(t *testing.T) {
	gid := "000123"
	data := &localData{genres: []personalization.GenrePreference{{GenreID: 2, Name: "fantasy"}}, ratings: []personalization.Rating{{BookID: 99, GoodreadsBookID: &gid, Title: "Positive Title", Rating: 5}, {BookID: 100, Title: "Unmapped Title", Rating: 5}, {BookID: 101, GoodreadsBookID: &gid, Title: "Negative Title", Rating: 2}}, matches: []catalog.GoodreadsMatch{{ID: 10, GoodreadsBookID: "000123", Title: "Local edition"}, {ID: 20, GoodreadsBookID: "456", Title: "No copies"}}, counts: map[int64]inventory.Counts{10: {Total: 2, Available: 1}, 20: {}}}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/recommendations/preferences" || r.Method != "POST" {
			t.Error("wrong local-user inference flow")
		}
		var payload PreferencesRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if len(payload.Preferences.Genres) != 1 || payload.Preferences.Genres[0] != "fantasy" || len(payload.Preferences.Keywords) != 1 || payload.Preferences.Keywords[0] != "Positive Title" {
			t.Errorf("incorrect preferences: %+v", payload.Preferences)
		}
		p := validResponse("content")
		p.Count = 3
		second := p.Recommendations[0]
		second.BookID = "456"
		third := second
		third.BookID = "789"
		p.Recommendations = append(p.Recommendations, second, third)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(p)
	}))
	defer s.Close()
	service := NewService(NewClient(s.URL, time.Second), data, data, data)
	out, err := service.ForReader(context.Background(), reader(), 3)
	if err != nil {
		t.Fatal(err)
	}
	if data.seenUser != 77 || out.Count != 3 {
		t.Fatal("identity or count changed")
	}
	a, b, c := out.Recommendations[0], out.Recommendations[1], out.Recommendations[2]
	if a.GoodreadsBookID != "000123" || a.LocalBookID == nil || *a.LocalBookID != 10 || a.Available == nil || !*a.Available {
		t.Fatal("available local match not enriched")
	}
	if !b.InLocalCatalog || b.Available == nil || *b.Available || b.TotalCopies == nil || *b.TotalCopies != 0 {
		t.Fatal("local zero-copy distinction lost")
	}
	if c.InLocalCatalog || c.LocalBookID != nil || c.Available != nil {
		t.Fatal("external result treated as local")
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if json.Unmarshal(raw, &decoded) != nil {
		t.Fatal("response is not JSON")
	}
}
func TestEmptyPreferencesAndAuthorizationDoNotCallInference(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer s.Close()
	data := &localData{}
	service := NewService(NewClient(s.URL, time.Second), data, data, data)
	out, err := service.ForReader(context.Background(), reader(), 10)
	if err != nil || out.Status != "preferences_required" || out.Count != 0 {
		t.Fatal("invented personalized scores")
	}
	actor := reader()
	actor.Roles = []string{"bibliotecario"}
	_, err = service.ForReader(context.Background(), actor, 10)
	errorStatus(t, err, 403)
	for _, limit := range []int{0, 51} {
		_, err = service.ForReader(context.Background(), reader(), limit)
		errorStatus(t, err, 400)
	}
	if calls.Load() != 0 {
		t.Fatal("inference called with insufficient preferences or invalid authorization")
	}
	_, err = service.Similar(context.Background(), 1, 10)
	errorStatus(t, err, 409)
}
func TestZeroContentScoresAreNotPresentedAsPersonalized(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := validResponse("content")
		zero := 0.0
		p.Recommendations[0].Score = &zero
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(p)
	}))
	defer s.Close()
	data := &localData{genres: []personalization.GenrePreference{{Name: "unknown interest"}}}
	out, err := NewService(NewClient(s.URL, time.Second), data, data, data).ForReader(context.Background(), reader(), 1)
	if err != nil || out.Status != "no_content_matches" || out.Count != 0 {
		t.Fatal("zero similarity fabricated personalized results")
	}
}
