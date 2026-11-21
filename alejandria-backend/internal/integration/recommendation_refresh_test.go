//go:build integration

package integration

import (
	"errors"
	"slices"
	"testing"

	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/google/uuid"
)

func TestRecommendationHistoryIsolationRollbackAndConcurrency(t *testing.T) {
	f := setup(t)
	repo := recommendation.NewRepository(f.pool)
	first, second := uuid.NewString(), uuid.NewString()
	_, err := repo.Refresh(f.ctx, f.a.ID, []string{first}, func(ids []string) (recommendation.Response, error) {
		if !slices.Contains(ids, first) {
			t.Fatal("current visible selection was not excluded")
		}
		// Dos pestañas no pueden consumir simultáneamente la misma tanda.
		_, concurrent := repo.Refresh(f.ctx, f.a.ID, nil, func([]string) (recommendation.Response, error) {
			t.Fatal("concurrent generation entered callback")
			return recommendation.Response{}, nil
		})
		if concurrent == nil {
			t.Fatal("concurrent generation accepted")
		}
		return recommendation.Response{Status: "ok", Recommendations: []recommendation.Item{{GoodreadsBookID: second}}}, nil
	})
	must(t, err)
	// La persistencia no depende de la instancia Go ni de la pestaña.
	ids, err := recommendation.NewRepository(f.pool).Exclusions(f.ctx, f.a.ID)
	must(t, err)
	if !slices.Contains(ids, first) || !slices.Contains(ids, second) {
		t.Fatal("shown history lost")
	}
	other, err := repo.Exclusions(f.ctx, f.b.ID)
	must(t, err)
	if slices.Contains(other, first) || slices.Contains(other, second) {
		t.Fatal("reader history leaked")
	}
	failedID := uuid.NewString()
	_, err = repo.Refresh(f.ctx, f.a.ID, []string{failedID}, func([]string) (recommendation.Response, error) {
		return recommendation.Response{}, errors.New("synthetic inference failure")
	})
	if err == nil {
		t.Fatal("inference failure swallowed")
	}
	ids, err = repo.Exclusions(f.ctx, f.a.ID)
	must(t, err)
	if slices.Contains(ids, failedID) {
		t.Fatal("failed request consumed history")
	}
}

func TestRecommendationExclusionsCoverAllRatingsLoansAndBoundedHistory(t *testing.T) {
	f := setup(t)
	// Más de una página: también se excluyen ratings negativos fuera de los primeros 100.
	_, err := f.pool.Exec(f.ctx, `WITH inserted AS (
        INSERT INTO books(title,goodreads_book_id)
        SELECT 'Synthetic rated', $2 || n::text FROM generate_series(1,105) n RETURNING id)
        INSERT INTO book_ratings(user_id,book_id,rating) SELECT $1,id,1 FROM inserted`, f.a.ID, uuid.NewString())
	must(t, err)
	loanID := uuid.NewString()
	_, err = f.pool.Exec(f.ctx, `UPDATE books SET goodreads_book_id=$2 WHERE id=$1`, f.book, loanID)
	must(t, err)
	f.loan(t, f.a, f.book, f.copy)
	repo := recommendation.NewRepository(f.pool)
	ids, err := repo.Exclusions(f.ctx, f.a.ID)
	must(t, err)
	if len(ids) != 106 || !slices.Contains(ids, loanID) {
		t.Fatal("ratings or loan exclusions truncated")
	}
	_, err = f.pool.Exec(f.ctx, `INSERT INTO recommendation_exposures(user_id,goodreads_book_id)
        SELECT $1,'shown-' || n::text FROM generate_series(1,510) n`, f.a.ID)
	must(t, err)
	_, err = repo.Refresh(f.ctx, f.a.ID, nil, func(ids []string) (recommendation.Response, error) {
		if len(ids) != 606 {
			t.Fatalf("expected 106 permanent and 500 recent exclusions, got %d", len(ids))
		}
		return recommendation.Response{Status: "ok", Recommendations: []recommendation.Item{{GoodreadsBookID: "next"}}}, nil
	})
	must(t, err)
	var count int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM recommendation_exposures WHERE user_id=$1`, f.a.ID).Scan(&count))
	if count != 500 {
		t.Fatalf("history is unbounded: %d", count)
	}
}
