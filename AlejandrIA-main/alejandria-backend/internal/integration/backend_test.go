//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/circulation"
	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/database"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/router"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"golang.org/x/crypto/bcrypt"
)

type fixture struct {
	pool        *pgxpool.Pool
	s           *circulation.Service
	staff, a, b user.User
	book, copy  int64
	ctx         context.Context
}

func must(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func setup(t *testing.T) *fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL must point at a disposable migrated database")
	}
	ctx := context.Background()
	p, e := pgxpool.New(ctx, url)
	must(t, e)
	t.Cleanup(p.Close)
	if !strings.HasPrefix(p.Config().ConnConfig.Database, "test_") {
		t.Fatal("refusing a non-test database")
	}
	var version int
	must(t, p.QueryRow(ctx, `SELECT version FROM schema_version`).Scan(&version))
	if version != 8 {
		t.Fatalf("expected schema 8, got %d", version)
	}
	f := &fixture{pool: p, ctx: ctx, s: circulation.NewService(circulation.NewRepository(p))}
	f.staff = f.newUser(t, "administrador")
	f.a = f.newUser(t, "lector")
	f.b = f.newUser(t, "lector")
	f.book, f.copy = f.newBook(t)
	return f
}
func (f *fixture) newUser(t *testing.T, role string) user.User {
	t.Helper()
	hash, e := bcrypt.GenerateFromPassword([]byte("a-long-password"), bcrypt.MinCost)
	must(t, e)
	var id int64
	must(t, f.pool.QueryRow(f.ctx, `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Synthetic test',$2) RETURNING id`, uuid.NewString()+"@synthetic.invalid", string(hash)).Scan(&id))
	_, e = f.pool.Exec(f.ctx, `INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2`, id, role)
	must(t, e)
	u, e := user.NewRepository(f.pool).ByID(f.ctx, id)
	must(t, e)
	return u
}
func (f *fixture) newBook(t *testing.T) (int64, int64) {
	t.Helper()
	book, e := catalog.NewService(catalog.NewRepository(f.pool)).SaveBook(f.ctx, 0, catalog.BookInput{Title: "Synthetic " + uuid.NewString()})
	must(t, e)
	copy, e := inventory.NewService(inventory.NewRepository(f.pool)).Save(f.ctx, book.ID, 0, inventory.Input{InventoryCode: uuid.NewString(), Status: "circulating"})
	must(t, e)
	return book.ID, copy
}
func (f *fixture) loan(t *testing.T, reader user.User, book, copy int64) circulation.Loan {
	t.Helper()
	request, e := f.s.Request(f.ctx, reader, book)
	must(t, e)
	l, e := f.s.Deliver(f.ctx, f.staff, request, copy)
	must(t, e)
	return l
}
func TestDuplicateRequestsAndRollback(t *testing.T) {
	f := setup(t)
	r, e := f.s.Request(f.ctx, f.a, f.book)
	must(t, e)
	_, e = f.s.Request(f.ctx, f.a, f.book)
	if e == nil {
		t.Fatal("duplicate pending accepted")
	}
	_, wrongCopy := f.newBook(t)
	_, e = f.s.Deliver(f.ctx, f.staff, r, wrongCopy)
	if e == nil {
		t.Fatal("wrong-book copy accepted")
	}
	var status string
	must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM loan_requests WHERE id=$1`, r).Scan(&status))
	if status != "pending" {
		t.Fatal("request did not roll back")
	}
	l, e := f.s.Deliver(f.ctx, f.staff, r, f.copy)
	must(t, e)
	if l.ReturnedAt != nil {
		t.Fatal("new loan returned")
	}
	_, e = f.s.Return(f.ctx, f.a, l.ID)
	if e == nil {
		t.Fatal("reader returned loan")
	}
	_, e = f.s.Return(f.ctx, f.staff, l.ID)
	must(t, e)
}
func TestConcurrentDeliveriesProtectCopy(t *testing.T) {
	f := setup(t)
	r1, e := f.s.Request(f.ctx, f.a, f.book)
	must(t, e)
	r2, e := f.s.Request(f.ctx, f.b, f.book)
	must(t, e)
	start := make(chan struct{})
	var wg sync.WaitGroup
	errors := make(chan error, 2)
	for _, id := range []int64{r1, r2} {
		wg.Add(1)
		go func(id int64) { defer wg.Done(); <-start; _, e := f.s.Deliver(f.ctx, f.staff, id, f.copy); errors <- e }(id)
	}
	close(start)
	wg.Wait()
	close(errors)
	success := 0
	for e := range errors {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("expected one delivery, got %d", success)
	}
}
func TestConcurrentDeliveriesProtectReaderLimit(t *testing.T) {
	f := setup(t)
	f.loan(t, f.a, f.book, f.copy)
	b1, c1 := f.newBook(t)
	b2, c2 := f.newBook(t)
	r1, e := f.s.Request(f.ctx, f.a, b1)
	must(t, e)
	r2, e := f.s.Request(f.ctx, f.a, b2)
	must(t, e)
	start := make(chan struct{})
	out := make(chan error, 2)
	var wg sync.WaitGroup
	for _, q := range [][2]int64{{r1, c1}, {r2, c2}} {
		wg.Add(1)
		go func(q [2]int64) { defer wg.Done(); <-start; _, e := f.s.Deliver(f.ctx, f.staff, q[0], q[1]); out <- e }(q)
	}
	close(start)
	wg.Wait()
	close(out)
	success := 0
	for e := range out {
		if e == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatalf("limit race accepted %d deliveries", success)
	}
}
func TestFIFOReservedPickupAndReturnAssignment(t *testing.T) {
	f := setup(t)
	l := f.loan(t, f.a, f.book, f.copy)
	r1, e := f.s.Reserve(f.ctx, f.b, f.book)
	must(t, e)
	third := f.newUser(t, "lector")
	r2, e := f.s.Reserve(f.ctx, third, f.book)
	must(t, e)
	if r1.Status != "waiting" || r2.Status != "waiting" {
		t.Fatal("busy copy assigned")
	}
	_, e = f.s.Return(f.ctx, f.staff, l.ID)
	must(t, e)
	var status string
	must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r1.ID).Scan(&status))
	if status != "ready" {
		t.Fatal("FIFO first not ready")
	}
	req, e := f.s.Request(f.ctx, third, f.book)
	must(t, e)
	_, e = f.s.Deliver(f.ctx, f.staff, req, f.copy)
	if e == nil {
		t.Fatal("held copy stolen")
	}
	pickup, e := f.s.Pickup(f.ctx, f.staff, r1.ID)
	must(t, e)
	var requestStatus string
	must(t, f.pool.QueryRow(f.ctx, `SELECT q.status FROM loans l JOIN loan_requests q ON q.id=l.request_id WHERE l.id=$1`, pickup.ID).Scan(&requestStatus))
	if requestStatus != "approved" {
		t.Fatal("pickup lacks approved request")
	}
	_, e = f.s.Return(f.ctx, f.staff, pickup.ID)
	must(t, e)
	must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r2.ID).Scan(&status))
	if status != "ready" {
		t.Fatal("next reader not assigned")
	}
}
func TestRenewalPoliciesAndOverdue(t *testing.T) {
	f := setup(t)
	l := f.loan(t, f.a, f.book, f.copy)
	id, e := f.s.Renew(f.ctx, f.a, l.ID)
	must(t, e)
	must(t, f.s.DecideRenewal(f.ctx, f.staff, id, true, ""))
	_, e = f.s.Renew(f.ctx, f.a, l.ID)
	if e == nil {
		t.Fatal("second renewal accepted")
	}
	var due time.Time
	must(t, f.pool.QueryRow(f.ctx, `SELECT due_at FROM loans WHERE id=$1`, l.ID).Scan(&due))
	if !due.Equal(l.DueAt.Add(30 * 24 * time.Hour)) {
		t.Fatal("incorrect renewal deadline")
	}
	b, c := f.newBook(t)
	other := f.loan(t, f.b, b, c)
	_, e = f.s.Reserve(f.ctx, f.a, b)
	must(t, e)
	_, e = f.s.Renew(f.ctx, f.b, other.ID)
	if e == nil {
		t.Fatal("renewal with waiting reader accepted")
	}
	_, e = f.pool.Exec(f.ctx, `UPDATE loans SET delivered_at=delivered_at-interval '90 days',initial_due_at=initial_due_at-interval '90 days',due_at=due_at-interval '90 days' WHERE id=$1`, other.ID)
	must(t, e)
	b2, _ := f.newBook(t)
	_, e = f.s.Request(f.ctx, f.b, b2)
	if e == nil {
		t.Fatal("overdue reader requested loan")
	}
}
func TestExpirationAndConcurrentPickup(t *testing.T) {
	f := setup(t)
	r, e := f.s.Reserve(f.ctx, f.a, f.book)
	must(t, e)
	r2, e := f.s.Reserve(f.ctx, f.b, f.book)
	must(t, e)
	if r.Status != "ready" || r2.Status != "waiting" {
		t.Fatal("unexpected initial queue")
	}
	_, e = f.pool.Exec(f.ctx, `UPDATE reservations SET created_at=created_at-interval '100 hours',assigned_at=assigned_at-interval '100 hours',pickup_expires_at=pickup_expires_at-interval '100 hours' WHERE id=$1`, r.ID)
	must(t, e)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = f.s.Sweep(f.ctx) }()
	var pickupErr error
	go func() { defer wg.Done(); _, pickupErr = f.s.Pickup(f.ctx, f.staff, r.ID) }()
	wg.Wait()
	if pickupErr == nil {
		t.Fatal("expired pickup accepted")
	}
	must(t, f.s.Sweep(f.ctx))
	var status string
	must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r2.ID).Scan(&status))
	if status != "ready" {
		t.Fatal("expired hold not reassigned")
	}
}

func TestHTTPMainFlowAndPermissions(t *testing.T) {
	f := setup(t)
	log := zerolog.Nop()
	cfg := &config.Config{Auth: config.AuthConfig{Secret: strings.Repeat("s", 32)}}
	srv := &server.Server{Config: cfg, Logger: &log, DB: &database.Database{Pool: f.pool}}
	api := httptest.NewServer(router.NewRouter(srv))
	defer api.Close()
	call := func(method, path, token string, payload any, status int) map[string]any {
		t.Helper()
		body, _ := json.Marshal(payload)
		req, e := http.NewRequest(method, api.URL+"/api/v1"+path, bytes.NewReader(body))
		must(t, e)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, e := http.DefaultClient.Do(req)
		must(t, e)
		defer resp.Body.Close()
		var out map[string]any
		must(t, json.NewDecoder(resp.Body).Decode(&out))
		if resp.StatusCode != status {
			t.Fatalf("%s %s got %d expected %d: %v", method, path, resp.StatusCode, status, out)
		}
		return out
	}
	login := func(u user.User) string {
		return call("POST", "/auth/login", "", map[string]any{"email": u.Email, "password": "a-long-password"}, 200)["access_token"].(string)
	}
	staff, reader := login(f.staff), login(f.a)
	registered := call("POST", "/auth/register", "", map[string]any{"email": uuid.NewString() + "@synthetic.invalid", "display_name": "New reader", "password": "a-long-password"}, 201)
	if _, leak := registered["password_hash"]; leak {
		t.Fatal("password hash leaked")
	}
	roles := registered["roles"].([]any)
	if len(roles) != 1 || roles[0] != "lector" {
		t.Fatal("unsafe signup role")
	}
	call("POST", "/auth/login", "", map[string]any{"email": f.a.Email, "password": "incorrect"}, 401)
	call("PUT", fmt.Sprintf("/users/%d/roles", f.a.ID), reader, map[string]any{"roles": []string{"administrador"}}, 403)
	call("PUT", fmt.Sprintf("/users/%d/roles", f.b.ID), staff, map[string]any{"roles": []string{"lector", "bibliotecario"}}, 200)
	call("GET", "/books", "", nil, 401)
	call("POST", "/books", reader, map[string]any{"title": "Forbidden"}, 403)
	call("POST", "/auth/register", "", map[string]any{"email": "bad@invalid.org", "display_name": "x", "password": "a-long-password", "roles": []string{"administrador"}}, 400)
	book := call("POST", "/books", staff, map[string]any{"title": "HTTP synthetic"}, 201)
	bid := int64(book["id"].(float64))
	copy := call("POST", fmt.Sprintf("/books/%d/copies", bid), staff, map[string]any{"inventory_code": uuid.NewString()}, 200)
	call("POST", "/loan-requests", reader, map[string]any{"book_id": bid, "user_id": f.b.ID}, 400)
	request := call("POST", "/loan-requests", reader, map[string]any{"book_id": bid}, 201)
	rid := int64(request["id"].(float64))
	call("POST", "/loan-requests", reader, map[string]any{"book_id": bid}, 409)
	loan := call("POST", fmt.Sprintf("/loan-requests/%d/deliver", rid), staff, map[string]any{"copy_id": copy["id"]}, 200)
	lid := int64(loan["id"].(float64))
	call("POST", fmt.Sprintf("/loans/%d/return", lid), reader, nil, 403)
	call("POST", fmt.Sprintf("/loans/%d/return", lid), staff, nil, 200)
	call("GET", "/books?limit=101", reader, nil, 400)
	call("PATCH", fmt.Sprintf("/users/%d/active", f.a.ID), staff, map[string]any{"is_active": false}, 200)
	call("GET", "/auth/me", reader, nil, 401)
}

func TestFailureAfterApprovalRollsBackAllWrites(t *testing.T) {
	f := setup(t)
	request, e := f.s.Request(f.ctx, f.a, f.book)
	must(t, e)
	// Inyección solo en base desechable: simula fallo de INSERT después de UPDATE approved.
	_, e = f.pool.Exec(f.ctx, fmt.Sprintf(`CREATE FUNCTION test_reject_loan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.book_id=%d THEN RAISE EXCEPTION 'synthetic insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_loan BEFORE INSERT ON loans FOR EACH ROW EXECUTE FUNCTION test_reject_loan()`, f.book))
	must(t, e)
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS test_reject_loan ON loans; DROP FUNCTION IF EXISTS test_reject_loan()`)
	})
	_, e = f.s.Deliver(f.ctx, f.staff, request, f.copy)
	if e == nil {
		t.Fatal("injected insert failure accepted")
	}
	var status string
	var count int
	must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM loan_requests WHERE id=$1`, request).Scan(&status))
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM loans WHERE request_id=$1`, request).Scan(&count))
	if status != "pending" || count != 0 {
		t.Fatal("approval or loan escaped rollback")
	}
}

func TestConcurrentAssignmentAndRenewalReservationOrdering(t *testing.T) {
	t.Run("two assigners one copy", func(t *testing.T) {
		f := setup(t)
		_, e := f.pool.Exec(f.ctx, `UPDATE book_copies SET status='maintenance' WHERE id=$1`, f.copy)
		must(t, e)
		r1, e := f.s.Reserve(f.ctx, f.a, f.book)
		must(t, e)
		r2, e := f.s.Reserve(f.ctx, f.b, f.book)
		must(t, e)
		_, e = f.pool.Exec(f.ctx, `UPDATE book_copies SET status='circulating' WHERE id=$1`, f.copy)
		must(t, e)
		var wg sync.WaitGroup
		out := make(chan error, 2)
		for range 2 {
			wg.Add(1)
			go func() { defer wg.Done(); out <- f.s.Sweep(f.ctx) }()
		}
		wg.Wait()
		close(out)
		for e := range out {
			must(t, e)
		}
		var first, second string
		must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r1.ID).Scan(&first))
		must(t, f.pool.QueryRow(f.ctx, `SELECT status FROM reservations WHERE id=$1`, r2.ID).Scan(&second))
		if first != "ready" || second != "waiting" {
			t.Fatal("assignment violated FIFO/exclusivity")
		}
	})
	t.Run("renewal versus new reservation", func(t *testing.T) {
		f := setup(t)
		l := f.loan(t, f.a, f.book, f.copy)
		renewal, e := f.s.Renew(f.ctx, f.a, l.ID)
		must(t, e)
		var wg sync.WaitGroup
		var approved error
		var reserved circulation.Reservation
		var reserveErr error
		start := make(chan struct{})
		wg.Add(2)
		go func() { defer wg.Done(); <-start; approved = f.s.DecideRenewal(f.ctx, f.staff, renewal, true, "") }()
		go func() { defer wg.Done(); <-start; reserved, reserveErr = f.s.Reserve(f.ctx, f.b, f.book) }()
		close(start)
		wg.Wait()
		must(t, reserveErr)
		if approved == nil {
			var decision, creation time.Time
			must(t, f.pool.QueryRow(f.ctx, `SELECT decided_at FROM loan_renewals WHERE id=$1`, renewal).Scan(&decision))
			must(t, f.pool.QueryRow(f.ctx, `SELECT created_at FROM reservations WHERE id=$1`, reserved.ID).Scan(&creation))
			if decision.After(creation) {
				t.Fatal("renewal approved after competing reservation")
			}
		} else {
			var due time.Time
			must(t, f.pool.QueryRow(f.ctx, `SELECT due_at FROM loans WHERE id=$1`, l.ID).Scan(&due))
			if !due.Equal(l.DueAt) {
				t.Fatal("failed renewal changed deadline")
			}
		}
	})
}

func TestCatalogRelationsInventoryAndCancellation(t *testing.T) {
	f := setup(t)
	c := catalog.NewService(catalog.NewRepository(f.pool))
	author, e := c.SaveNamed(f.ctx, "authors", 0, catalog.NamedInput{Name: "Synthetic author"})
	must(t, e)
	genre, e := c.SaveNamed(f.ctx, "genres", 0, catalog.NamedInput{Name: uuid.NewString()})
	must(t, e)
	work, e := c.SaveNamed(f.ctx, "works", 0, catalog.NamedInput{Title: "Synthetic work"})
	must(t, e)
	b, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: "Relations", WorkID: &work, Authors: []catalog.AuthorLink{{AuthorID: author, Role: "translator"}}, GenreIDs: []int64{genre}})
	must(t, e)
	found, e := c.Books(f.ctx, catalog.Filter{Title: "Relations", AuthorID: author, GenreID: genre, Limit: 10})
	must(t, e)
	if len(found) != 1 || len(found[0].Authors) != 1 || found[0].Authors[0].Role != "translator" {
		t.Fatal("relation/filter not preserved")
	}
	_, e = c.SaveBook(f.ctx, b.ID, catalog.BookInput{Title: "Must rollback", Authors: []catalog.AuthorLink{{AuthorID: -1, Role: "author"}}})
	if e == nil {
		t.Fatal("invalid relation accepted")
	}
	original, e := c.Book(f.ctx, b.ID)
	must(t, e)
	if original.Title != "Relations" {
		t.Fatal("book update did not rollback")
	}
	inv := inventory.NewService(inventory.NewRepository(f.pool))
	s, e := inv.List(f.ctx, f.book, 10, 0)
	must(t, e)
	if s.Total != 1 || s.Available != 1 {
		t.Fatal("bad inventory count")
	}
	r, e := f.s.Reserve(f.ctx, f.a, f.book)
	must(t, e)
	s, e = inv.List(f.ctx, f.book, 10, 0)
	must(t, e)
	if s.Available != 0 {
		t.Fatal("held copy shown available")
	}
	_, e = inv.Save(f.ctx, f.book, f.copy, inventory.Input{InventoryCode: uuid.NewString(), Status: "lost"})
	if e == nil {
		t.Fatal("held copy marked lost")
	}
	must(t, f.s.Cancel(f.ctx, f.a, r.ID))
	s, e = inv.List(f.ctx, f.book, 10, 0)
	must(t, e)
	if s.Available != 1 {
		t.Fatal("cancellation did not release copy")
	}
}
