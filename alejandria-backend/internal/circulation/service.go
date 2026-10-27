package circulation

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"
	"strings"
	"time"
)

type Service struct{ repo *Repository }

func NewService(r *Repository) *Service { return &Service{r} }
func requireStaff(actor user.User) error {
	if !actor.Active || !actor.HasRole("bibliotecario", "administrador") {
		return errs.NewForbiddenError("staff role required", false)
	}
	return nil
}
func requireReader(actor user.User) error {
	if !actor.Active || !actor.HasRole("lector", "administrador") {
		return errs.NewForbiddenError("reader role required", false)
	}
	return nil
}

// Eligible es una política pura; las entradas deben leerse bajo bloqueo del lector.
func Eligible(active bool, count int, overdue bool) error {
	if !active {
		return errs.NewConflictError("reader is inactive", false)
	}
	if overdue {
		return errs.NewConflictError("reader has overdue loans", false)
	}
	if count >= 2 {
		return errs.NewConflictError("maximum two active loans", false)
	}
	return nil
}
func (t *transaction) eligible(reader int64) error {
	active, count, overdue, e := t.readerState(reader)
	if e != nil {
		return e
	}
	return Eligible(active, count, overdue)
}
func (t *transaction) reconcile() error {
	if e := t.expire(); e != nil {
		return e
	}
	for {
		reservation, e := t.nextWaiting()
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		copy, e := t.nextCopy()
		if errors.Is(e, pgx.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		if e = t.assign(reservation, copy); e != nil {
			return e
		}
	}
}
func (s *Service) Request(ctx context.Context, actor user.User, book int64) (int64, error) {
	if e := requireReader(actor); e != nil {
		return 0, e
	}
	var id int64
	e := s.repo.within(ctx, book, actor.ID, func(t *transaction) error {
		if e := t.eligible(actor.ID); e != nil {
			return e
		}
		var e error
		id, e = t.createRequest(actor.ID)
		return e
	})
	return id, e
}
func (s *Service) Reserve(ctx context.Context, actor user.User, book int64) (Reservation, error) {
	if e := requireReader(actor); e != nil {
		return Reservation{}, e
	}
	var id int64
	e := s.repo.within(ctx, book, actor.ID, func(t *transaction) error {
		active, _, _, e := t.readerState(actor.ID)
		if e != nil {
			return e
		}
		if !active {
			return errs.NewConflictError("reader is inactive", false)
		}
		id, e = t.createReservation(actor.ID)
		if e != nil {
			return e
		}
		return t.reconcile()
	})
	if e != nil {
		return Reservation{}, e
	}
	return s.repo.reservation(ctx, id)
}
func (s *Service) Deliver(ctx context.Context, actor user.User, request, copy int64) (Loan, error) {
	if e := requireStaff(actor); e != nil {
		return Loan{}, e
	}
	q, e := s.repo.request(ctx, request)
	if e != nil {
		return Loan{}, e
	}
	var id int64
	e = s.repo.within(ctx, q.BookID, q.UserID, func(t *transaction) error {
		t.assignmentStaff = actor.ID
		q, e := t.request(request)
		if e != nil {
			return e
		}
		if q.Status != "pending" {
			return errs.NewConflictError("request is not pending", false)
		}
		if e = t.eligible(q.UserID); e != nil {
			return e
		}
		if e = t.reconcile(); e != nil {
			return e
		}
		if e = t.checkCopy(copy, 0); e != nil {
			return e
		}
		if e = t.decideRequest(q.ID, actor.ID, "approved", ""); e != nil {
			return e
		}
		id, e = t.insertLoan(q.ID, q.UserID, copy, actor.ID)
		return e
	})
	if e != nil {
		return Loan{}, e
	}
	return s.repo.loan(ctx, id)
}
func (s *Service) Reject(ctx context.Context, actor user.User, id int64, reason string) error {
	if e := requireStaff(actor); e != nil {
		return e
	}
	if strings.TrimSpace(reason) == "" {
		return errs.NewBadRequestError("rejection reason required", false, nil, nil, nil)
	}
	q, e := s.repo.request(ctx, id)
	if e != nil {
		return e
	}
	return s.repo.within(ctx, q.BookID, q.UserID, func(t *transaction) error {
		q, e := t.request(id)
		if e != nil {
			return e
		}
		if q.Status != "pending" {
			return errs.NewConflictError("request is not pending", false)
		}
		return t.decideRequest(id, actor.ID, "rejected", reason)
	})
}

func (s *Service) CancelRequest(ctx context.Context, actor user.User, id int64) error {
	q, e := s.repo.request(ctx, id)
	if e != nil {
		return e
	}
	if q.UserID != actor.ID {
		return errs.NewForbiddenError("request belongs to another reader", false)
	}
	return s.repo.within(ctx, q.BookID, q.UserID, func(t *transaction) error {
		q, e := t.request(id)
		if e != nil {
			return e
		}
		if q.Status != "pending" {
			return errs.NewConflictError("request is not pending", false)
		}
		return t.cancelRequest(id)
	})
}
func (s *Service) Pickup(ctx context.Context, actor user.User, id int64) (Loan, error) {
	if e := requireStaff(actor); e != nil {
		return Loan{}, e
	}
	q, e := s.repo.reservation(ctx, id)
	if e != nil {
		return Loan{}, e
	}
	var loanID int64
	e = s.repo.within(ctx, q.BookID, q.UserID, func(t *transaction) error {
		t.assignmentStaff = actor.ID
		if e := t.reconcile(); e != nil {
			return e
		}
		q, e := t.reservation(id)
		if e != nil {
			return e
		}
		if q.Status != "ready" || q.ExpiresAt == nil || !t.now.Before(*q.ExpiresAt) {
			return errs.NewConflictError("reservation is not ready or has expired", false)
		}
		if e = t.eligible(q.UserID); e != nil {
			return e
		}
		if e = t.checkCopy(*q.CopyID, q.ID); e != nil {
			return e
		}
		request, e := t.pendingRequest(q.UserID)
		if errors.Is(e, pgx.ErrNoRows) {
			request, e = t.createRequest(q.UserID)
		}
		if e != nil {
			return e
		}
		if e = t.decideRequest(request, actor.ID, "approved", "reservation pickup"); e != nil {
			return e
		}
		loanID, e = t.insertLoan(request, q.UserID, *q.CopyID, actor.ID)
		if e != nil {
			return e
		}
		return t.fulfill(id, loanID)
	})
	if e != nil {
		return Loan{}, e
	}
	return s.repo.loan(ctx, loanID)
}
func (s *Service) Cancel(ctx context.Context, actor user.User, id int64) error {
	q, e := s.repo.reservation(ctx, id)
	if e != nil {
		return e
	}
	if q.UserID != actor.ID {
		return errs.NewForbiddenError("reservation belongs to another reader", false)
	}
	return s.repo.within(ctx, q.BookID, q.UserID, func(t *transaction) error {
		q, e := t.reservation(id)
		if e != nil {
			return e
		}
		if q.Status != "waiting" && q.Status != "ready" {
			return errs.NewConflictError("reservation is terminal", false)
		}
		if q.ExpiresAt != nil && !t.now.Before(*q.ExpiresAt) {
			return errs.NewConflictError("reservation has expired", false)
		}
		if e = t.cancelReservation(id); e != nil {
			return e
		}
		return t.reconcile()
	})
}
func (s *Service) Return(ctx context.Context, actor user.User, id int64) (Loan, error) {
	if e := requireStaff(actor); e != nil {
		return Loan{}, e
	}
	l, e := s.repo.loan(ctx, id)
	if e != nil {
		return Loan{}, e
	}
	e = s.repo.within(ctx, l.BookID, l.UserID, func(t *transaction) error {
		t.assignmentStaff = actor.ID
		l, e := t.loan(id)
		if e != nil {
			return e
		}
		if l.ReturnedAt != nil {
			return errs.NewConflictError("loan already returned", false)
		}
		if e = t.returnLoan(id, actor.ID); e != nil {
			return e
		}
		return t.reconcile()
	})
	if e != nil {
		return Loan{}, e
	}
	return s.repo.loan(ctx, id)
}
func (t *transaction) renewable(l Loan) error {
	if l.ReturnedAt != nil || !t.now.Before(l.DueAt) {
		return errs.NewConflictError("loan is returned or overdue", false)
	}
	active, _, overdue, e := t.readerState(l.UserID)
	if e != nil {
		return e
	}
	if !active || overdue {
		return errs.NewConflictError("reader is inactive or has overdue loans", false)
	}
	other, e := t.hasOtherReservations(l.UserID)
	if e != nil {
		return e
	}
	if other {
		return errs.NewConflictError("other readers have reservations", false)
	}
	approved, e := t.hasApprovedRenewal(l.ID)
	if e != nil {
		return e
	}
	if approved {
		return errs.NewConflictError("loan already renewed", false)
	}
	return nil
}
func (s *Service) Renew(ctx context.Context, actor user.User, id int64) (int64, error) {
	if e := requireReader(actor); e != nil {
		return 0, e
	}
	l, e := s.repo.loan(ctx, id)
	if e != nil {
		return 0, e
	}
	if l.UserID != actor.ID {
		return 0, errs.NewForbiddenError("loan belongs to another reader", false)
	}
	var renewal int64
	e = s.repo.within(ctx, l.BookID, l.UserID, func(t *transaction) error {
		if e := t.reconcile(); e != nil {
			return e
		}
		l, e := t.loan(id)
		if e != nil {
			return e
		}
		if e = t.renewable(l); e != nil {
			return e
		}
		renewal, e = t.createRenewal(l)
		return e
	})
	return renewal, e
}
func (s *Service) DecideRenewal(ctx context.Context, actor user.User, id int64, approve bool, reason string) error {
	if e := requireStaff(actor); e != nil {
		return e
	}
	if !approve && strings.TrimSpace(reason) == "" {
		return errs.NewBadRequestError("rejection reason required", false, nil, nil, nil)
	}
	q, e := s.repo.renewal(ctx, id)
	if e != nil {
		return e
	}
	l, e := s.repo.loan(ctx, q.LoanID)
	if e != nil {
		return e
	}
	return s.repo.within(ctx, l.BookID, l.UserID, func(t *transaction) error {
		t.assignmentStaff = actor.ID
		if e := t.reconcile(); e != nil {
			return e
		}
		l, e := t.loan(q.LoanID)
		if e != nil {
			return e
		}
		q, e := t.renewal(id)
		if e != nil {
			return e
		}
		if q.Status != "pending" {
			return errs.NewConflictError("renewal is not pending", false)
		}
		if approve {
			if e = t.renewable(l); e != nil {
				return e
			}
			if !q.PreviousDueAt.Equal(l.DueAt) || !q.RequestedAt.Before(l.DueAt) {
				return errs.NewConflictError("renewal is stale", false)
			}
		}
		return t.decideRenewal(q, actor.ID, approve, reason)
	})
}
func (s *Service) List(ctx context.Context, actor user.User, kind string, limit, offset int) ([]json.RawMessage, error) {
	reader := actor.ID
	if actor.HasRole("bibliotecario", "administrador") {
		reader = 0
	}
	return s.repo.list(ctx, kind, reader, limit, offset)
}
func (s *Service) Sweep(ctx context.Context) error {
	books, e := s.repo.actionableBooks(ctx)
	if e != nil {
		return e
	}
	for _, book := range books {
		if e = s.repo.within(ctx, book, 0, func(t *transaction) error { return t.reconcile() }); e != nil {
			return e
		}
	}
	return nil
}

func (s *Service) CancelRenewal(ctx context.Context, actor user.User, id int64) error {
	q, e := s.repo.renewal(ctx, id)
	if e != nil {
		return e
	}
	l, e := s.repo.loan(ctx, q.LoanID)
	if e != nil {
		return e
	}
	if l.UserID != actor.ID {
		return errs.NewForbiddenError("loan belongs to another reader", false)
	}
	return s.repo.within(ctx, l.BookID, l.UserID, func(t *transaction) error {
		q, e := t.renewal(id)
		if e != nil {
			return e
		}
		if q.Status != "pending" {
			return errs.NewConflictError("renewal is not pending", false)
		}
		return t.cancelRenewal(id)
	})
}
func (s *Service) Run(ctx context.Context, logger *zerolog.Logger) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		bounded, cancel := context.WithTimeout(ctx, 30*time.Second)
		e := s.Sweep(bounded)
		cancel()
		if e != nil && ctx.Err() == nil {
			logger.Error().Err(e).Msg("reservation sweep failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
