package user

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"strings"
	"time"
)

type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	DisplayName  string    `json:"display_name"`
	Active       bool      `json:"is_active"`
	Roles        []string  `json:"roles"`
	CreatedAt    time.Time `json:"created_at"`
	PasswordHash string    `json:"-"`
}

func (u User) HasRole(names ...string) bool {
	for _, r := range u.Roles {
		for _, n := range names {
			if r == n {
				return true
			}
		}
	}
	return false
}

type contextKey struct{}

func WithIdentity(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, contextKey{}, u)
}
func Identity(ctx context.Context) User { u, _ := ctx.Value(contextKey{}).(User); return u }

type Register struct {
	Email       string `json:"email" validate:"required,email,max=254"`
	DisplayName string `json:"display_name" validate:"required,max=200"`
	Password    string `json:"password" validate:"required,min=12"`
}

func (r *Register) Validate() error {
	r.Email = strings.ToLower(strings.TrimSpace(r.Email))
	r.DisplayName = strings.TrimSpace(r.DisplayName)
	if len(r.Password) > 72 {
		return errs.NewBadRequestError("password must be at most 72 bytes", false, nil, nil, nil)
	}
	return nil
}

type Login struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

func (r *Login) Validate() error { r.Email = strings.ToLower(strings.TrimSpace(r.Email)); return nil }

type RoleRequest struct {
	Roles []string `json:"roles" validate:"required,min=1,dive,oneof=lector bibliotecario administrador"`
}

func (*RoleRequest) Validate() error { return nil }

type ActiveRequest struct {
	Active *bool `json:"is_active" validate:"required"`
}

func (*ActiveRequest) Validate() error { return nil }

var Unauthorized = errs.NewUnauthorizedError("invalid credentials or inactive user", false)
