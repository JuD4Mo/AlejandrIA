//go:build integration

package catalog

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
)

// Explica exactamente el SQL del repositorio, no una consulta simplificada.
func TestImportedCatalogPlans(t *testing.T) {
	if os.Getenv("TEST_IMPORTED_CATALOG") != "true" {
		t.Skip("requires imported catalog in a disposable database")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if !strings.HasPrefix(pool.Config().ConnConfig.Database, "test_") {
		t.Fatal("refusing operational database")
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var total int
	var author, genre int64
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM books WHERE goodreads_book_id IS NOT NULL`).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total < 10000 {
		t.Fatal("import real Parquet catalog first")
	}
	if err = tx.QueryRow(ctx, `SELECT author_id FROM book_authors ORDER BY book_id LIMIT 1`).Scan(&author); err != nil {
		t.Fatal(err)
	}
	if err = tx.QueryRow(ctx, `SELECT id FROM genres ORDER BY id LIMIT 1`).Scan(&genre); err != nil {
		t.Fatal(err)
	}
	yes, no := true, false
	cases := []struct {
		name   string
		filter Filter
	}{{"first_page", Filter{Limit: 20}}, {"title", Filter{Title: "Harry Potter", Limit: 20}}, {"offset_900000", Filter{Limit: 20, Offset: 900000}}, {"cursor_900000", Filter{Limit: 20, AfterID: 900000}}, {"author", Filter{Limit: 20, AuthorID: author}}, {"genre", Filter{Limit: 20, GenreID: genre}}, {"has_copies", Filter{Limit: 20, HasCopies: &yes}}, {"no_copies", Filter{Limit: 20, HasCopies: &no}}, {"available", Filter{Limit: 20, Available: &yes}}}
	report := map[string]any{}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			query, args := bookPageQuery(tc.filter)
			var raw json.RawMessage
			start := time.Now()
			if err := tx.QueryRow(ctx, "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+query, args...).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var plan any
			if err := json.Unmarshal(raw, &plan); err != nil {
				t.Fatal(err)
			}
			report[tc.name] = map[string]any{"roundtrip_ms": float64(time.Since(start).Microseconds()) / 1000, "plan": plan}
		})
	}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if path := os.Getenv("AUDIT_PLAN_REPORT"); path != "" {
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
