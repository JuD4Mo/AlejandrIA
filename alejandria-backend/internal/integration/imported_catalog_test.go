//go:build integration

package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/google/uuid"
)

// TEST_IMPORTED_CATALOG obliga a preparar datos Parquet reales, sin cargar ML en Go.
func TestImportedBookRecommendationAndCirculation(t *testing.T) {
	if os.Getenv("TEST_IMPORTED_CATALOG") != "true" {
		t.Skip("requires a disposable database with imported Parquet catalog")
	}
	f := setup(t)
	var count int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM books WHERE goodreads_book_id IS NOT NULL`).Scan(&count))
	if count < 10000 {
		t.Fatal("import a representative real catalog before running this test")
	}
	var id int64
	must(t, f.pool.QueryRow(f.ctx, `SELECT b.id FROM books b WHERE goodreads_book_id IS NOT NULL AND goodreads_book_id<>b.id::text AND NOT EXISTS(SELECT 1 FROM book_copies WHERE book_id=b.id) AND EXISTS(SELECT 1 FROM book_genres WHERE book_id=b.id) ORDER BY b.id LIMIT 1`).Scan(&id))
	cat := catalog.NewService(catalog.NewRepository(f.pool))
	book, e := cat.Book(f.ctx, id)
	must(t, e)
	if book.GoodreadsBookID == nil || book.HasCopies {
		t.Fatal("invalid imported fixture")
	}
	if _, e = f.s.Request(f.ctx, f.a, id); e == nil {
		t.Fatal("uncopied imported book requested")
	}
	if _, e = f.s.Reserve(f.ctx, f.b, id); e == nil {
		t.Fatal("uncopied imported book reserved")
	}
	personal := personalization.NewService(personalization.NewRepository(f.pool))
	must(t, personal.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: book.GenreIDs[:1]}))
	_, e = personal.PutRating(f.ctx, f.a, id, personalization.RatingInput{Rating: 5})
	must(t, e)
	_, e = personal.AddInteraction(f.ctx, f.a, personalization.InteractionInput{BookID: id, Type: "recommendation_click"})
	must(t, e)
	score := 0.8123456789123
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/recommendations/preferences" {
			t.Error("local reader used a historical route")
		}
		var p recommendation.PreferencesRequest
		if e := json.NewDecoder(r.Body).Decode(&p); e != nil {
			t.Error(e)
		}
		if len(p.Preferences.Genres) != 1 || len(p.Preferences.Keywords) != 1 || p.Preferences.Keywords[0] != book.Title {
			t.Error("imported metadata not used as preferences")
		}
		rows := []recommendation.UpstreamItem{{BookID: *book.GoodreadsBookID, Title: &book.Title, Score: &score, Model: "content_cold_start", ScoreScope: "content_catalog"}, {BookID: "external-" + uuid.NewString(), Score: &score, Model: "content_cold_start", ScoreScope: "content_catalog"}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(recommendation.UpstreamResponse{RecommendationType: "content", ModelVersion: "v2", Count: 2, Recommendations: rows})
	}))
	defer upstream.Close()
	inv := inventory.NewService(inventory.NewRepository(f.pool))
	service := recommendation.NewService(recommendation.NewClient(upstream.URL, time.Second), cat, personal, inv)
	out, e := service.ForReader(f.ctx, f.a, 2)
	must(t, e)
	if out.Recommendations[0].LocalBookID == nil || *out.Recommendations[0].LocalBookID != id || out.Recommendations[0].Available == nil || *out.Recommendations[0].Available || *out.Recommendations[0].Score != score {
		t.Fatal("imported mapping/zero-copy score incorrect")
	}
	if out.Recommendations[1].InLocalCatalog || out.Recommendations[1].LocalBookID != nil {
		t.Fatal("invented external match")
	}
	copy, e := inv.Save(f.ctx, id, 0, inventory.Input{InventoryCode: uuid.NewString(), Status: "circulating"})
	must(t, e)
	out, e = service.ForReader(f.ctx, f.a, 2)
	must(t, e)
	if !*out.Recommendations[0].Available || *out.Recommendations[0].Score != score {
		t.Fatal("enrichment altered original model score")
	}
	request, e := f.s.Request(f.ctx, f.a, id)
	must(t, e)
	loan, e := f.s.Deliver(f.ctx, f.staff, request, copy)
	must(t, e)
	reservation, e := f.s.Reserve(f.ctx, f.b, id)
	must(t, e)
	if reservation.Status != "waiting" {
		t.Fatal("loaned imported book cannot be reserved")
	}
	_, e = f.s.Return(f.ctx, f.staff, loan.ID)
	must(t, e)
	picked, e := f.s.Pickup(f.ctx, f.staff, reservation.ID)
	must(t, e)
	if picked.BookID != id || picked.CopyID != copy || picked.UserID != f.b.ID {
		t.Fatal("reserved import delivered incorrectly")
	}
	var overlapping int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM loans l JOIN reservations r ON r.copy_id=l.copy_id WHERE l.book_id=$1 AND l.returned_at IS NULL AND r.status='ready'`, id).Scan(&overlapping))
	if overlapping != 0 {
		t.Fatal("active loan overlaps a ready hold")
	}
	_, e = f.s.Return(f.ctx, f.staff, picked.ID)
	must(t, e)
}
