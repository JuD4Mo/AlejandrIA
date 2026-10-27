//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/database"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/router"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestPersonalizationPersistenceAndIsolation(t *testing.T) {
	f := setup(t)
	s := personalization.NewService(personalization.NewRepository(f.pool))
	var g1, g2 int64
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, uuid.NewString()).Scan(&g1))
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, uuid.NewString()).Scan(&g2))
	must(t, s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{g1, g2}}))
	prefs, e := s.Preferences(f.ctx, f.a, 1, 1)
	must(t, e)
	if len(prefs) != 1 || prefs[0].GenreID != g2 {
		t.Fatal("preference pagination")
	}
	if s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{g1, g1}}) == nil {
		t.Fatal("duplicate preferences accepted")
	}
	if s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{g2, 9223372036854775807}}) == nil {
		t.Fatal("missing genre accepted")
	}
	prefs, e = s.Preferences(f.ctx, f.a, 100, 0)
	must(t, e)
	if len(prefs) != 2 {
		t.Fatal("failed update removed preferences")
	}
	originalCreated := prefs[1].CreatedAt
	must(t, s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{g2}}))
	prefs, e = s.Preferences(f.ctx, f.a, 100, 0)
	must(t, e)
	if len(prefs) != 1 || !prefs[0].CreatedAt.Equal(originalCreated) {
		t.Fatal("retained preference timestamp lost")
	}
	other, e := s.Preferences(f.ctx, f.b, 100, 0)
	must(t, e)
	if len(other) != 0 {
		t.Fatal("cross-reader preferences leaked")
	}
	must(t, s.DeletePreference(f.ctx, f.a, g2))
	_, e = f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, f.book, "000"+uuid.NewString())
	must(t, e)
	first, e := s.PutRating(f.ctx, f.a, f.book, personalization.RatingInput{Rating: 3})
	must(t, e)
	updated, e := s.PutRating(f.ctx, f.a, f.book, personalization.RatingInput{Rating: 5})
	must(t, e)
	if !updated.CreatedAt.Equal(first.CreatedAt) || !updated.UpdatedAt.After(first.UpdatedAt) || updated.Rating != 5 || updated.GoodreadsBookID == nil || !strings.HasPrefix(*updated.GoodreadsBookID, "000") {
		t.Fatal("rating timestamps/metadata")
	}
	var count int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM book_ratings WHERE user_id=$1 AND book_id=$2`, f.a.ID, f.book).Scan(&count))
	if count != 1 {
		t.Fatal("rating duplicated")
	}
	for _, value := range []int{0, 6} {
		if _, e = s.PutRating(f.ctx, f.a, f.book, personalization.RatingInput{Rating: value}); e == nil {
			t.Fatal("invalid rating")
		}
	}
	if _, e = s.PutRating(f.ctx, f.a, 9223372036854775807, personalization.RatingInput{Rating: 4}); e == nil {
		t.Fatal("nonexistent book rated")
	}
	_, e = s.PutRating(f.ctx, f.b, f.book, personalization.RatingInput{Rating: 2})
	must(t, e)
	must(t, s.DeleteRating(f.ctx, f.a, f.book))
	ratings, e := s.Ratings(f.ctx, f.b, 100, 0)
	must(t, e)
	if len(ratings) != 1 || ratings[0].Rating != 2 {
		t.Fatal("other reader rating changed")
	}
	for _, kind := range []string{"view", "recommendation_click", "favorite_added", "favorite_removed"} {
		_, e = s.AddInteraction(f.ctx, f.a, personalization.InteractionInput{BookID: f.book, Type: kind})
		must(t, e)
	}
	events, e := s.Interactions(f.ctx, f.a, 2, 1)
	must(t, e)
	if len(events) != 2 {
		t.Fatal("event pagination")
	}
	events, e = s.Interactions(f.ctx, f.b, 100, 0)
	must(t, e)
	if len(events) != 0 {
		t.Fatal("event isolation")
	}
	if _, e = s.AddInteraction(f.ctx, f.a, personalization.InteractionInput{BookID: f.book, Type: "loan"}); e == nil {
		t.Fatal("loan duplicated as interaction")
	}
	if _, e = s.AddInteraction(f.ctx, f.a, personalization.InteractionInput{BookID: 9223372036854775807, Type: "view"}); e == nil {
		t.Fatal("event for absent book")
	}
}

func TestPreferenceFailureAfterDeleteRollsBack(t *testing.T) {
	f := setup(t)
	s := personalization.NewService(personalization.NewRepository(f.pool))
	var old, newID int64
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, uuid.NewString()).Scan(&old))
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, uuid.NewString()).Scan(&newID))
	must(t, s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{old}}))
	_, e := f.pool.Exec(f.ctx, fmt.Sprintf(`CREATE FUNCTION test_fail_preference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.genre_id=%d THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_preference BEFORE INSERT ON user_genre_preferences FOR EACH ROW EXECUTE FUNCTION test_fail_preference()`, newID))
	must(t, e)
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS test_fail_preference ON user_genre_preferences; DROP FUNCTION IF EXISTS test_fail_preference()`)
	})
	if s.ReplacePreferences(f.ctx, f.a, personalization.GenreSelection{GenreIDs: []int64{newID}}) == nil {
		t.Fatal("synthetic failure accepted")
	}
	prefs, e := s.Preferences(f.ctx, f.a, 100, 0)
	must(t, e)
	if len(prefs) != 1 || prefs[0].GenreID != old {
		t.Fatal("delete escaped rollback")
	}
}

func TestAuditAutomaticManualAndWorkerWithoutStaff(t *testing.T) {
	t.Run("manual return preserves staff", func(t *testing.T) {
		f := setup(t)
		l := f.loan(t, f.a, f.book, f.copy)
		r, e := f.s.Reserve(f.ctx, f.b, f.book)
		must(t, e)
		_, e = f.s.Return(f.ctx, f.staff, l.ID)
		must(t, e)
		var origin string
		var by int64
		must(t, f.pool.QueryRow(f.ctx, `SELECT assignment_origin,assigned_by FROM reservations WHERE id=$1`, r.ID).Scan(&origin, &by))
		if origin != "manual" || by != f.staff.ID {
			t.Fatal("return actor not preserved")
		}
		_, e = f.s.Pickup(f.ctx, f.staff, r.ID)
		must(t, e)
		must(t, f.pool.QueryRow(f.ctx, `SELECT assignment_origin,assigned_by FROM reservations WHERE id=$1`, r.ID).Scan(&origin, &by))
		if origin != "manual" || by != f.staff.ID {
			t.Fatal("pickup rewrote assignment history")
		}
	})
	t.Run("worker and reservation require no staff", func(t *testing.T) {
		f := setup(t)
		// Los tests de integración son secuenciales y solo alteran una base test_*.
		rows, e := f.pool.Query(f.ctx, `UPDATE users u SET is_active=false WHERE is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('bibliotecario','administrador')) RETURNING id`)
		must(t, e)
		ids := []int64{}
		for rows.Next() {
			var id int64
			must(t, rows.Scan(&id))
			ids = append(ids, id)
		}
		must(t, rows.Err())
		rows.Close()
		t.Cleanup(func() {
			_, _ = f.pool.Exec(context.Background(), `UPDATE users SET is_active=true WHERE id=ANY($1::bigint[])`, ids)
		})
		var staffCount int
		must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM users u WHERE is_active AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('bibliotecario','administrador'))`).Scan(&staffCount))
		if staffCount != 0 {
			t.Fatal("test still has staff")
		}
		r, e := f.s.Reserve(f.ctx, f.a, f.book)
		must(t, e)
		if r.Status != "ready" || r.AssignedBy != nil || r.AssignmentOrigin == nil || *r.AssignmentOrigin != "system" {
			t.Fatal("automatic assignment impersonates staff")
		}
		next, e := f.s.Reserve(f.ctx, f.b, f.book)
		must(t, e)
		_, e = f.pool.Exec(f.ctx, `UPDATE reservations SET created_at=created_at-interval '100 hours',assigned_at=assigned_at-interval '100 hours',pickup_expires_at=pickup_expires_at-interval '100 hours' WHERE id=$1`, r.ID)
		must(t, e)
		must(t, f.s.Sweep(f.ctx))
		var origin string
		var actor *int64
		var status string
		must(t, f.pool.QueryRow(f.ctx, `SELECT status,assignment_origin,assigned_by FROM reservations WHERE id=$1`, next.ID).Scan(&status, &origin, &actor))
		if status != "ready" || origin != "system" || actor != nil {
			t.Fatal("worker assignment without staff failed")
		}
		must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r.ID).Scan(&status))
		if status != "expired" {
			t.Fatal("expiration failed")
		}
	})
}

func TestHTTPGetDoesNotWriteAndPersonalizationAccess(t *testing.T) {
	f := setup(t)
	reservation, e := f.s.Reserve(f.ctx, f.a, f.book)
	must(t, e)
	_, e = f.pool.Exec(f.ctx, `UPDATE reservations SET created_at=created_at-interval '100 hours',assigned_at=assigned_at-interval '100 hours',pickup_expires_at=pickup_expires_at-interval '100 hours' WHERE id=$1`, reservation.ID)
	must(t, e)
	secret := strings.Repeat("s", 32)
	identity := user.NewService(user.NewRepository(f.pool), secret)
	token, e := identity.Login(f.ctx, user.Login{Email: f.a.Email, Password: "a-long-password"})
	must(t, e)
	log := zerolog.Nop()
	srv := &server.Server{Config: &config.Config{Auth: config.AuthConfig{Secret: secret}}, Logger: &log, DB: &database.Database{Pool: f.pool}}
	api := httptest.NewServer(router.NewRouter(srv))
	defer api.Close()
	call := func(method, path string, body any, expected int) map[string]any {
		t.Helper()
		raw, _ := json.Marshal(body)
		req, e := http.NewRequest(method, api.URL+"/api/v1"+path, bytes.NewReader(raw))
		must(t, e)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, e := http.DefaultClient.Do(req)
		must(t, e)
		defer resp.Body.Close()
		var out map[string]any
		must(t, json.NewDecoder(resp.Body).Decode(&out))
		if resp.StatusCode != expected {
			t.Fatalf("%s %s got %d: %v", method, path, resp.StatusCode, out)
		}
		return out
	}
	fingerprint := func() string {
		t.Helper()
		var v string
		must(t, f.pool.QueryRow(f.ctx, `SELECT md5(jsonb_build_object('reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM reservations r WHERE book_id=$1),'loans',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM loans l WHERE book_id=$1),'copies',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM book_copies c WHERE book_id=$1))::text)`, f.book).Scan(&v))
		return v
	}
	before := fingerprint()
	out := call("GET", fmt.Sprintf("/books/%d/copies", f.book), nil, 200)
	if out["available"].(float64) != 0 {
		t.Fatal("stale ready hold exposed as freely available")
	}
	call("GET", "/reservations", nil, 200)
	if fingerprint() != before {
		t.Fatal("GET modified persistent circulation records")
	}
	must(t, f.s.Sweep(f.ctx))
	out = call("GET", fmt.Sprintf("/books/%d/copies", f.book), nil, 200)
	if out["available"].(float64) != 1 {
		t.Fatal("worker did not free expired hold")
	}
	var genre int64
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO genres(name) VALUES($1) RETURNING id`, uuid.NewString()).Scan(&genre))
	call("PUT", "/users/me/preferences/genres", map[string]any{"genre_ids": []int64{genre}}, 200)
	call("PUT", "/users/me/preferences/genres", map[string]any{"genre_ids": []int64{genre, genre}}, 400)
	call("PUT", "/users/me/preferences/genres", map[string]any{"genre_ids": []int64{genre}, "user_id": f.b.ID}, 400)
	path := fmt.Sprintf("/users/me/ratings/%d", f.book)
	call("PUT", path, map[string]any{"rating": 4, "user_id": f.b.ID}, 400)
	call("PUT", path, map[string]any{"rating": 4.5}, 400)
	call("PUT", path, map[string]any{"rating": 6}, 400)
	call("PUT", path, map[string]any{"rating": 4}, 200)
	call("POST", "/users/me/interactions", map[string]any{"book_id": f.book, "interaction_type": "view", "user_id": f.b.ID}, 400)
	call("POST", "/users/me/interactions", map[string]any{"book_id": f.book, "interaction_type": "rating"}, 400)
	call("POST", "/users/me/interactions", map[string]any{"book_id": f.book, "interaction_type": "view"}, 201)
	call("GET", "/users/me/ratings?limit=0", nil, 400)
	req, e := http.NewRequest("GET", api.URL+"/api/v1/users/me/ratings", nil)
	must(t, e)
	response, e := http.DefaultClient.Do(req)
	must(t, e)
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("unauthenticated personalization access")
	}
	s := personalization.NewService(personalization.NewRepository(f.pool))
	other, e := s.Ratings(f.ctx, f.b, 100, 0)
	must(t, e)
	if len(other) != 0 {
		t.Fatal("HTTP mutated another reader")
	}
	call("DELETE", path, nil, 200)
	call("DELETE", "/users/me/preferences/genres", nil, 200)
}
