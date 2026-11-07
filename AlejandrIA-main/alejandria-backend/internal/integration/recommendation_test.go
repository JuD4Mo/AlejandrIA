//go:build integration

package integration

import (
	"encoding/json"
	"fmt"
	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/database"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/JuD4Mo/alejandria-backend/internal/router"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRecommendationHTTPWithLocalDatabase(t *testing.T) {
	f := setup(t)
	firstID := "000" + uuid.NewString()
	secondID := uuid.NewString()
	zeroID := uuid.NewString()
	externalID := uuid.NewString()
	_, e := f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, f.book, firstID)
	must(t, e)
	b2, c2 := f.newBook(t)
	_, e = f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, b2, secondID)
	must(t, e)
	f.loan(t, f.b, b2, c2)
	c := catalog.NewService(catalog.NewRepository(f.pool))
	zeroBook, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: "No copies", GoodreadsBookID: &zeroID})
	must(t, e)
	unmapped, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: "No Goodreads id"})
	must(t, e)
	genreName := "fantasy-" + uuid.NewString()
	var genre int64
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, genreName).Scan(&genre))
	personal := personalization.NewService(personalization.NewRepository(f.pool))
	var mode, calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		switch mode.Load() {
		case 1:
			w.WriteHeader(503)
			return
		case 2:
			_, _ = w.Write([]byte(`{"wrong":true}`))
			return
		case 3:
			w.WriteHeader(404)
			return
		case 4:
			select {
			case <-r.Context().Done():
			case <-time.After(time.Second):
			}
			return
		}
		kind, model := "content", "content_cold_start"
		ids := []string{firstID, secondID, zeroID, externalID}
		if r.Method == "GET" {
			kind = "similar"
			model = "content_similar"
			ids = ids[1:]
		} else {
			if r.URL.Path != "/api/v1/recommendations/preferences" {
				t.Error("local user sent to historical endpoint")
			}
			var p recommendation.PreferencesRequest
			if e := json.NewDecoder(r.Body).Decode(&p); e != nil {
				t.Error(e)
			}
			if len(p.Preferences.Genres) != 1 || p.Preferences.Genres[0] != genreName || len(p.Preferences.Keywords) != 1 {
				t.Error("local metadata was not translated into textual preferences")
			}
		}
		score := 0.8
		rows := []recommendation.UpstreamItem{}
		for _, id := range ids {
			title := "same title is not an identity match"
			rows = append(rows, recommendation.UpstreamItem{BookID: id, Title: &title, Score: &score, Model: model, ScoreScope: "content_catalog"})
		}
		_ = json.NewEncoder(w).Encode(recommendation.UpstreamResponse{ModelVersion: "v2", RecommendationType: kind, Count: len(rows), Recommendations: rows})
	}))
	defer upstream.Close()
	secret := strings.Repeat("s", 32)
	identity := user.NewService(user.NewRepository(f.pool), secret)
	token, e := identity.Login(f.ctx, user.Login{Email: f.a.Email, Password: "a-long-password"})
	must(t, e)
	logger := zerolog.Nop()
	srv := &server.Server{DB: &database.Database{Pool: f.pool}, Logger: &logger, Config: &config.Config{Auth: config.AuthConfig{Secret: secret}, Recommendation: config.RecommendationConfig{URL: upstream.URL, Timeout: 100 * time.Millisecond}}}
	api := httptest.NewServer(router.NewRouter(srv))
	defer api.Close()
	get := func(path, auth string, want int) map[string]any {
		t.Helper()
		req, e := http.NewRequest("GET", api.URL+"/api/v1"+path, nil)
		must(t, e)
		if auth != "" {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		resp, e := http.DefaultClient.Do(req)
		must(t, e)
		defer resp.Body.Close()
		var out map[string]any
		must(t, json.NewDecoder(resp.Body).Decode(&out))
		if resp.StatusCode != want {
			t.Fatalf("%s got %d: %v", path, resp.StatusCode, out)
		}
		return out
	}
	get("/users/me/recommendations", "", 401)
	empty := get("/users/me/recommendations", token, 200)
	if empty["status"] != "preferences_required" || calls.Load() != 0 {
		t.Fatal("empty reader caused inference")
	}
	must(t, personal.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{genre}}))
	_, e = personal.PutRating(f.ctx, f.a, f.book, personalization.RatingInput{Rating: 5})
	must(t, e)
	out := get("/users/me/recommendations?limit=4", token, 200)
	rows := out["recommendations"].([]any)
	first, second, third, external := rows[0].(map[string]any), rows[1].(map[string]any), rows[2].(map[string]any), rows[3].(map[string]any)
	if first["goodreads_book_id"] != firstID || first["local_book_id"] != float64(f.book) || first["available"] != true {
		t.Fatal("exact available match missing")
	}
	if second["available"] != false || second["total_copies"] != float64(1) || third["local_book_id"] != float64(zeroBook.ID) || third["total_copies"] != float64(0) {
		t.Fatal("inventory distinctions lost")
	}
	if external["local_book_id"] != nil || external["available"] != nil || external["in_local_catalog"] != false {
		t.Fatal("external book treated as local")
	}
	_, e = f.s.Reserve(f.ctx, f.b, f.book)
	must(t, e)
	out = get("/users/me/recommendations?limit=4", token, 200)
	if out["recommendations"].([]any)[0].(map[string]any)["available"] != false {
		t.Fatal("ready hold exposed as available")
	}
	get(fmt.Sprintf("/books/%d/similar", f.book), token, 200)
	get(fmt.Sprintf("/books/%d/similar", unmapped.ID), token, 409)
	get("/books/9223372036854775807/similar", token, 404)
	before := calls.Load()
	get("/users/me/recommendations?limit=51", token, 400)
	if calls.Load() != before {
		t.Fatal("invalid limit reached inference")
	}
	mode.Store(1)
	get("/users/me/recommendations", token, 503)
	get("/auth/me", token, 200)
	mode.Store(2)
	get("/users/me/recommendations", token, 502)
	mode.Store(3)
	get(fmt.Sprintf("/books/%d/similar", f.book), token, 404)
	mode.Store(4)
	get("/users/me/recommendations", token, 504)
	staffOnly := f.newUser(t, "bibliotecario")
	staffToken, e := identity.Login(f.ctx, user.Login{Email: staffOnly.Email, Password: "a-long-password"})
	must(t, e)
	get("/users/me/recommendations", staffToken, 403)
}
