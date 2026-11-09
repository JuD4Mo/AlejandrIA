//go:build integration

package integration

import (
	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/google/uuid"
	"sync"
	"testing"
)

func TestNoCopyBookIsBibliographicButNotCirculating(t *testing.T) {
	f := setup(t)
	c := catalog.NewService(catalog.NewRepository(f.pool))
	name := "No copies " + uuid.NewString()
	b, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: name})
	must(t, e)
	if b.HasCopies || b.HasAvailableCopies || b.TotalCopies != 0 || b.AvailableCopies != 0 {
		t.Fatal("bibliographic record implies physical availability")
	}
	if _, e = f.s.Request(f.ctx, f.a, b.ID); e == nil {
		t.Fatal("request allowed without copies")
	}
	if _, e = f.s.Reserve(f.ctx, f.a, b.ID); e == nil {
		t.Fatal("reservation allowed without copies")
	}
	var requests, reservations int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM loan_requests WHERE book_id=$1`, b.ID).Scan(&requests))
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM reservations WHERE book_id=$1`, b.ID).Scan(&reservations))
	if requests != 0 || reservations != 0 {
		t.Fatal("invalid circulation persisted")
	}
	p := personalization.NewService(personalization.NewRepository(f.pool))
	_, e = p.PutRating(f.ctx, f.a, b.ID, personalization.RatingInput{Rating: 5})
	must(t, e)
	_, e = p.AddInteraction(f.ctx, f.a, personalization.InteractionInput{BookID: b.ID, Type: "recommendation_click"})
	must(t, e)
	no, yes := false, true
	books, e := c.Books(f.ctx, catalog.Filter{Title: name, HasCopies: &no, Limit: 20})
	must(t, e)
	if len(books) != 1 {
		t.Fatal("uncopied book is hidden from catalog")
	}
	books, e = c.Books(f.ctx, catalog.Filter{Title: name, HasCopies: &yes, Limit: 20})
	must(t, e)
	if len(books) != 0 {
		t.Fatal("physical-only filter included uncopied book")
	}
	loan := f.loan(t, f.a, f.book, f.copy)
	reservation, e := f.s.Reserve(f.ctx, f.b, f.book)
	must(t, e)
	detail, e := c.Book(f.ctx, f.book)
	must(t, e)
	if !detail.HasCopies || detail.HasAvailableCopies || detail.LoanedCopies != 1 || detail.ReservedCopies != 0 {
		t.Fatal("loaned copy confused with absent copy")
	}
	_, e = f.s.Return(f.ctx, f.staff, loan.ID)
	must(t, e)
	detail, e = c.Book(f.ctx, f.book)
	must(t, e)
	if detail.LoanedCopies != 0 || detail.ReservedCopies != 1 {
		t.Fatal("reserved copy not distinguished")
	}
	must(t, f.s.Cancel(f.ctx, f.b, reservation.ID))
	_, e = inventory.NewService(inventory.NewRepository(f.pool)).Save(f.ctx, f.book, f.copy, inventory.Input{InventoryCode: uuid.NewString(), Status: "maintenance"})
	must(t, e)
	detail, e = c.Book(f.ctx, f.book)
	must(t, e)
	if detail.NonCirculatingCopies != 1 || detail.LoanedCopies != 0 || detail.ReservedCopies != 0 || detail.AvailableCopies != 0 {
		t.Fatal("noncirculating copy confused with a loan or hold")
	}
}

func TestCopyRegistrationAndReservationSerialize(t *testing.T) {
	f := setup(t)
	c := catalog.NewService(catalog.NewRepository(f.pool))
	b, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: "Inventory race " + uuid.NewString()})
	must(t, e)
	var reserveErr, copyErr error
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); <-start; _, reserveErr = f.s.Reserve(f.ctx, f.a, b.ID) }()
	go func() {
		defer wg.Done()
		<-start
		_, copyErr = inventory.NewService(inventory.NewRepository(f.pool)).Save(f.ctx, b.ID, 0, inventory.Input{InventoryCode: uuid.NewString(), Status: "circulating"})
	}()
	close(start)
	wg.Wait()
	must(t, copyErr)
	if reserveErr != nil {
		_, e = f.s.Reserve(f.ctx, f.a, b.ID)
		must(t, e)
	}
	var count int
	must(t, f.pool.QueryRow(f.ctx, `SELECT count(*) FROM reservations WHERE book_id=$1 AND status='ready'`, b.ID).Scan(&count))
	if count != 1 {
		t.Fatal("inventory race did not resolve to one ready reservation")
	}
}

func TestCatalogCursorAndInventoryFilters(t *testing.T) {
	f := setup(t)
	c := catalog.NewService(catalog.NewRepository(f.pool))
	prefix := "Cursor " + uuid.NewString()
	for range 3 {
		_, e := c.SaveBook(f.ctx, 0, catalog.BookInput{Title: prefix})
		must(t, e)
	}
	first, e := c.Books(f.ctx, catalog.Filter{Title: prefix, Limit: 2})
	must(t, e)
	if len(first) != 2 {
		t.Fatal("first page")
	}
	second, e := c.Books(f.ctx, catalog.Filter{Title: prefix, AfterID: first[1].ID, Limit: 2})
	must(t, e)
	if len(second) != 1 || second[0].ID <= first[1].ID {
		t.Fatal("cursor duplicates or skips")
	}
	own, e := c.Book(f.ctx, f.book)
	must(t, e)
	yes := true
	rows, e := c.Books(f.ctx, catalog.Filter{Title: own.Title, Available: &yes, Limit: 100})
	must(t, e)
	found := false
	for _, b := range rows {
		if !b.HasCopies || !b.HasAvailableCopies {
			t.Fatal("available filter returned nonavailable book")
		}
		if b.ID == f.book {
			found = true
		}
	}
	if !found {
		t.Fatal("available physical book not found")
	}
}
