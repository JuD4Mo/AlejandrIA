//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/google/uuid"
)

type localFitStub struct{ fail bool }

func (*localFitStub) LocalModel(context.Context) (recommendation.LocalModelInfo, error) {
	return recommendation.LocalModelInfo{ModelSignature: strings.Repeat("a", 64), Factors: 2, MinimumRatings: 5}, nil
}
func (s *localFitStub) FitLocal(_ context.Context, info recommendation.LocalModelInfo, ratings []recommendation.LocalRating) (recommendation.FitResult, error) {
	if s.fail {
		return recommendation.FitResult{}, errors.New("synthetic unavailable")
	}
	return fitted(&recommendation.FoldInJob{Ratings: ratings}, info.ModelSignature), nil
}

func fitted(job *recommendation.FoldInJob, signature string) recommendation.FitResult {
	result := recommendation.FitResult{Status: "insufficient", Reason: "minimum_ratings", InputCount: len(job.Ratings), MatchedCount: len(job.Ratings), MinimumRatings: 5, ModelSignature: signature, Factors: 2}
	positive := []string{}
	for _, r := range job.Ratings {
		if r.Rating >= 4 {
			positive = append(positive, r.BookID)
		}
	}
	result.PositiveCount = len(positive)
	if len(job.Ratings) >= 5 && len(positive) > 0 {
		result.Status = "ready"
		result.Reason = ""
		result.Profile = &recommendation.LocalVector{ModelSignature: signature, InputHash: strings.Repeat("b", 64), Vector: []float64{0.2, 0.3}, Bias: 0.1, PositiveBookIDs: positive}
	}
	return result
}

func TestFoldInQueueRevisionConcurrencyDeletionAndModelChange(t *testing.T) {
	f := setup(t)
	repo := recommendation.NewRepository(f.pool)
	personal := personalization.NewService(personalization.NewRepository(f.pool))
	books := []int64{}
	for i := 0; i < 5; i++ {
		id, _ := f.newBook(t)
		books = append(books, id)
		_, err := f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, id, uuid.NewString())
		must(t, err)
		_, err = personal.PutRating(f.ctx, f.a, id, personalization.RatingInput{Rating: 5})
		must(t, err)
	}
	state, err := repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "pending" || state.Revision != 5 {
		t.Fatalf("ratings did not enqueue atomically: %+v", state)
	}
	var jobs [2]*recommendation.FoldInJob
	var failures [2]error
	var wg sync.WaitGroup
	wg.Add(2)
	for i := range 2 {
		go func(i int) { defer wg.Done(); jobs[i], failures[i] = repo.ClaimFoldIn(f.ctx, f.a.ID) }(i)
	}
	wg.Wait()
	must(t, failures[0])
	must(t, failures[1])
	if (jobs[0] == nil) == (jobs[1] == nil) {
		t.Fatal("two workers claimed the same reader")
	}
	job := jobs[0]
	if job == nil {
		job = jobs[1]
	}
	_, err = personal.PutRating(f.ctx, f.a, books[0], personalization.RatingInput{Rating: 1})
	must(t, err)
	published, err := repo.PublishFoldIn(f.ctx, job, fitted(job, strings.Repeat("a", 64)))
	must(t, err)
	if published {
		t.Fatal("obsolete ratings revision published")
	}
	job, err = repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	if job == nil {
		t.Fatal("new revision was lost")
	}
	published, err = repo.PublishFoldIn(f.ctx, job, fitted(job, strings.Repeat("a", 64)))
	must(t, err)
	if !published {
		t.Fatal("fresh profile was not published")
	}
	state, err = recommendation.NewRepository(f.pool).LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "ready" || state.Profile == nil || state.ProcessedRevision != 6 {
		t.Fatal("versioned profile not persisted")
	}
	other, err := repo.LocalState(f.ctx, f.b.ID)
	must(t, err)
	if other != nil {
		t.Fatal("local profile leaked to another reader")
	}
	must(t, personal.DeleteRating(f.ctx, f.a, books[1]))
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "pending" || state.Profile != nil {
		t.Fatal("deleted rating left a usable stale vector")
	}
	job, err = repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	_, err = repo.PublishFoldIn(f.ctx, job, fitted(job, strings.Repeat("a", 64)))
	must(t, err)
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "insufficient" || state.MatchedCount != 4 || state.Profile != nil {
		t.Fatal("removal did not restore content fallback")
	}
	must(t, repo.RequeueModel(f.ctx, strings.Repeat("c", 64)))
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "pending" || state.Revision != 8 {
		t.Fatal("model change did not invalidate local profile")
	}
	job, err = repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	_, err = f.pool.Exec(f.ctx, `UPDATE local_fold_in_profiles SET lease_until=now()-interval '1 second' WHERE user_id=$1`, f.a.ID)
	must(t, err)
	replacement, err := repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	if replacement == nil || replacement.Token == job.Token {
		t.Fatal("expired lease was not recovered")
	}
	published, err = repo.PublishFoldIn(f.ctx, job, fitted(job, strings.Repeat("c", 64)))
	must(t, err)
	if published {
		t.Fatal("expired lease overwrote its replacement")
	}
	// Rollback de rating revierte también la cola; perfiles simulados no entran al fold-in.
	tx, err := f.pool.Begin(f.ctx)
	must(t, err)
	_, err = tx.Exec(f.ctx, `INSERT INTO book_ratings(user_id,book_id,rating) VALUES($1,$2,5)`, f.b.ID, books[0])
	must(t, err)
	must(t, tx.Rollback(f.ctx))
	other, err = repo.LocalState(f.ctx, f.b.ID)
	must(t, err)
	if other != nil {
		t.Fatal("rolled-back rating left a job")
	}
	_, err = f.pool.Exec(f.ctx, `INSERT INTO user_goodreads_test_profiles(user_id,goodreads_user_id,model_version,created_by) VALUES($1,'test-history','v2',$2)`, f.b.ID, f.staff.ID)
	must(t, err)
	_, err = personal.PutRating(f.ctx, f.b, books[0], personalization.RatingInput{Rating: 5})
	must(t, err)
	other, err = repo.LocalState(f.ctx, f.b.ID)
	must(t, err)
	if other != nil {
		t.Fatal("fixed historical simulation was adapted as a local account")
	}
}

func TestLocalFoldInRoutingKeepsVectorPrivateAndFallsBackOnVersionMismatch(t *testing.T) {
	f := setup(t)
	repo := recommendation.NewRepository(f.pool)
	personal := personalization.NewService(personalization.NewRepository(f.pool))
	for i := 0; i < 5; i++ {
		book, _ := f.newBook(t)
		_, err := f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, book, uuid.NewString())
		must(t, err)
		_, err = personal.PutRating(f.ctx, f.a, book, personalization.RatingInput{Rating: 5})
		must(t, err)
	}
	job, err := repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	_, err = repo.PublishFoldIn(f.ctx, job, fitted(job, strings.Repeat("a", 64)))
	must(t, err)
	var mismatch atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		kind, model, scope := "hybrid", "hybrid", "collaborative_catalog"
		if r.URL.Path == "/api/v1/recommendations/local/hybrid" {
			if mismatch.Load() {
				w.WriteHeader(409)
				return
			}
		} else if r.URL.Path == "/api/v1/recommendations/preferences" {
			kind, model, scope = "content", "content_cold_start", "content_catalog"
		} else {
			t.Error("unexpected local inference operation")
		}
		score, content, collab := 0.8, 0.5, 4.2
		item := recommendation.UpstreamItem{BookID: "unseen-local", Score: &score, ContentScore: &content, Model: model, ScoreScope: scope}
		if kind == "hybrid" {
			item.CollaborativeScore = &collab
		}
		_ = json.NewEncoder(w).Encode(recommendation.UpstreamResponse{RecommendationType: kind, ModelVersion: "v2", ModelSignature: strings.Repeat("a", 64), Count: 1, Recommendations: []recommendation.UpstreamItem{item}})
	}))
	defer upstream.Close()
	s := recommendation.NewService(recommendation.NewClient(upstream.URL, time.Second), catalog.NewService(catalog.NewRepository(f.pool)), personal, inventory.NewService(inventory.NewRepository(f.pool)), repo)
	out, err := s.ForReader(f.ctx, f.a, 1)
	must(t, err)
	if out.RecommendationType != "hybrid" || out.ProfileOrigin != "local_fold_in" || out.FoldIn.Status != "ready" {
		t.Fatalf("ready user not routed to local hybrid: %+v", out)
	}
	encoded, err := json.Marshal(out)
	must(t, err)
	if strings.Contains(string(encoded), "vector") || strings.Contains(string(encoded), "input_hash") {
		t.Fatal("private numeric profile exposed")
	}
	mismatch.Store(true)
	out, err = s.ForReader(f.ctx, f.a, 1)
	must(t, err)
	if out.RecommendationType != "content" || out.FoldIn.Status != "stale" {
		t.Fatal("wrong-version vector used instead of content fallback")
	}
	state, err := repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "ready" {
		t.Fatal("read-only recommendation wrote training state")
	}
}

func TestFoldInWorkerRetryAndCatalogMappingCorrection(t *testing.T) {
	f := setup(t)
	personal := personalization.NewService(personalization.NewRepository(f.pool))
	repo := recommendation.NewRepository(f.pool)
	_, err := personal.PutRating(f.ctx, f.a, f.book, personalization.RatingInput{Rating: 5})
	must(t, err)
	stub := &localFitStub{fail: true}
	worker := recommendation.NewFoldInWorker(repo, stub)
	info, _ := stub.LocalModel(f.ctx)
	found, err := worker.ProcessUser(f.ctx, info, f.a.ID)
	if !found || err == nil {
		t.Fatal("failed inference was swallowed")
	}
	state, err := repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "error" || state.Profile != nil {
		t.Fatal("failure exposed a usable vector")
	}
	blocked, err := repo.ClaimFoldIn(f.ctx, f.a.ID)
	must(t, err)
	if blocked != nil {
		t.Fatal("retry backoff ignored")
	}
	_, err = f.pool.Exec(f.ctx, `UPDATE local_fold_in_profiles SET next_attempt_at=now() WHERE user_id=$1`, f.a.ID)
	must(t, err)
	stub.fail = false
	found, err = worker.ProcessUser(f.ctx, info, f.a.ID)
	must(t, err)
	if !found {
		t.Fatal("durable job lost after retry")
	}
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "insufficient" || state.InputCount != 1 || state.MatchedCount != 0 {
		t.Fatal("unmapped rating treated as an embedding")
	}
	_, err = f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, f.book, uuid.NewString())
	must(t, err)
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if state.Status != "pending" || state.Revision != 2 {
		t.Fatal("mapping correction did not enqueue adaptation")
	}
	found, err = worker.ProcessUser(f.ctx, info, f.a.ID)
	must(t, err)
	state, err = repo.LocalState(f.ctx, f.a.ID)
	must(t, err)
	if !found || state.MatchedCount != 1 {
		t.Fatal("corrected mapping did not reach adaptation")
	}
}
