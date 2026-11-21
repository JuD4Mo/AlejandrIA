//go:build integration

package integration

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/database"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/JuD4Mo/alejandria-backend/internal/router"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestHistoricalRatingsHTTPIsReadOnlyAndUsesAuthenticatedProfile(t *testing.T) {
	f := setup(t)
	localGoodreadsID := "000" + uuid.NewString()
	_, err := f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, f.book, localGoodreadsID)
	must(t, err)
	_, err = f.pool.Exec(f.ctx, `INSERT INTO user_goodreads_test_profiles(user_id,goodreads_user_id,model_version,created_by)
        VALUES($1,'history-profile-a','v2',$3),($2,'history-profile-b','v2',$3)`, f.a.ID, f.b.ID, f.staff.ID)
	must(t, err)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/recommendations/history" {
			t.Error("wrong upstream operation")
		}
		var input recommendation.HistoryRequest
		if e := json.NewDecoder(r.Body).Decode(&input); e != nil {
			t.Error(e)
		}
		id, title := localGoodreadsID, "Historical A"
		if input.GoodreadsUserID == "history-profile-b" {
			id, title = "external-b", "Historical B"
		} else if input.GoodreadsUserID != "history-profile-a" {
			t.Error("local ID used as historical identity")
		}
		rows := []recommendation.HistoricalRating{}
		if input.Offset == 0 {
			rows = append(rows, recommendation.HistoricalRating{GoodreadsBookID: id, Title: &title, Rating: 5})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(recommendation.HistoricalRatings{Source: "goodreads_train", ModelVersion: "v2", Total: 1, PositiveCount: 1, Limit: input.Limit, Offset: input.Offset, Data: rows})
	}))
	defer upstream.Close()
	secret := strings.Repeat("s", 32)
	identity := user.NewService(user.NewRepository(f.pool), secret)
	login := func(u user.User) string {
		token, e := identity.Login(f.ctx, user.Login{Email: u.Email, Password: "a-long-password"})
		must(t, e)
		return token
	}
	a, b, admin := login(f.a), login(f.b), login(f.staff)
	staff := login(f.newUser(t, "bibliotecario"))
	log := zerolog.Nop()
	srv := &server.Server{DB: &database.Database{Pool: f.pool}, Logger: &log, Config: &config.Config{Auth: config.AuthConfig{Secret: secret}, Recommendation: config.RecommendationConfig{URL: upstream.URL, Timeout: time.Second}}}
	api := httptest.NewServer(router.NewRouter(srv))
	defer api.Close()
	get := func(token, query string, want int) map[string]any {
		t.Helper()
		req, e := http.NewRequest("GET", api.URL+"/api/v1/users/me/ratings/historical"+query, nil)
		must(t, e)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, e := http.DefaultClient.Do(req)
		must(t, e)
		defer resp.Body.Close()
		var out map[string]any
		must(t, json.NewDecoder(resp.Body).Decode(&out))
		if resp.StatusCode != want {
			t.Fatalf("history got %d: %v", resp.StatusCode, out)
		}
		return out
	}
	get("", "?limit=1", 401)
	get(staff, "?limit=1", 403)
	get(admin, "?limit=1", 409)
	get(a, "?limit=101", 400)
	first := get(a, "?limit=1&goodreads_user_id=history-profile-b", 200)
	row := first["data"].([]any)[0].(map[string]any)
	if row["title"] != "Historical A" || row["goodreads_book_id"] != localGoodreadsID || row["local_book_id"] != float64(f.book) {
		t.Fatal("authenticated profile or exact local match lost")
	}
	other := get(b, "?limit=1", 200)["data"].([]any)[0].(map[string]any)
	if other["title"] != "Historical B" || other["local_book_id"] != nil {
		t.Fatal("history leaked or external book treated as local")
	}
	if len(get(a, "?limit=1&offset=1", 200)["data"].([]any)) != 0 {
		t.Fatal("offset ignored")
	}
	var ratings, exposures int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM book_ratings WHERE user_id=$1`, f.a.ID).Scan(&ratings))
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM recommendation_exposures WHERE user_id=$1`, f.a.ID).Scan(&exposures))
	if ratings != 0 || exposures != 0 {
		t.Fatal("historical GET wrote local activity")
	}
}
