// Package circulation coordina préstamos, renovaciones y reservas como una unidad transaccional.
package circulation

import "time"

type Request struct {
	ID     int64  `json:"id"`
	UserID int64  `json:"user_id"`
	BookID int64  `json:"book_id"`
	Status string `json:"status"`
}
type Loan struct {
	ID         int64      `json:"id"`
	UserID     int64      `json:"user_id"`
	BookID     int64      `json:"book_id"`
	CopyID     int64      `json:"copy_id"`
	DueAt      time.Time  `json:"due_at"`
	ReturnedAt *time.Time `json:"returned_at"`
}
type Reservation struct {
	ID               int64      `json:"id"`
	UserID           int64      `json:"user_id"`
	BookID           int64      `json:"book_id"`
	Status           string     `json:"status"`
	CopyID           *int64     `json:"copy_id"`
	ExpiresAt        *time.Time `json:"pickup_expires_at"`
	AssignedBy       *int64     `json:"assigned_by"`
	AssignmentOrigin *string    `json:"assignment_origin"`
}

// assignmentAudit no elige sustitutos: sin actor humano, la asignación es del sistema.
func assignmentAudit(staff int64) (string, *int64) {
	if staff > 0 {
		return "manual", &staff
	}
	return "system", nil
}

type Renewal struct {
	ID            int64  `json:"id"`
	LoanID        int64  `json:"loan_id"`
	Status        string `json:"status"`
	RequestedAt   time.Time
	PreviousDueAt time.Time
}
type BookRequest struct {
	BookID int64 `json:"book_id" validate:"gt=0"`
}

func (*BookRequest) Validate() error { return nil }

type Delivery struct {
	CopyID int64 `json:"copy_id" validate:"gt=0"`
}

func (*Delivery) Validate() error { return nil }

type Decision struct {
	Approve *bool  `json:"approve" validate:"required"`
	Reason  string `json:"reason" validate:"max=1000"`
}

func (*Decision) Validate() error { return nil }

type Rejection struct {
	Reason string `json:"reason" validate:"required,max=1000"`
}

func (*Rejection) Validate() error { return nil }
