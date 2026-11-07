package user

import (
	"context"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"strconv"
	"time"
)

type Service struct {
	store  Store
	secret []byte
}

func NewService(store Store, secret string) *Service {
	return &Service{store: store, secret: []byte(secret)}
}
func (s *Service) Register(ctx context.Context, input Register) (User, error) {
	return s.create(ctx, input, false)
}
func (s *Service) Bootstrap(ctx context.Context, input Register) (User, error) {
	return s.create(ctx, input, true)
}
func (s *Service) create(ctx context.Context, input Register, admin bool) (User, error) {
	if e := input.Validate(); e != nil {
		return User{}, e
	}
	if len(input.Password) < 12 {
		return User{}, Unauthorized
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(input.Password), 12)
	if e != nil {
		return User{}, e
	}
	return s.store.Create(ctx, input, string(hash), admin)
}
func (s *Service) Login(ctx context.Context, input Login) (string, error) {
	u, e := s.store.ByEmail(ctx, input.Email)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return "", Unauthorized
		}
		return "", e
	}
	if !u.Active || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(input.Password)) != nil {
		return "", Unauthorized
	}
	claims := jwt.RegisteredClaims{Subject: strconv.FormatInt(u.ID, 10), Issuer: "alejandria", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now())}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	claims := new(jwt.RegisteredClaims)
	_, e := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return s.secret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithIssuer("alejandria"))
	if e != nil {
		return User{}, Unauthorized
	}
	id, e := strconv.ParseInt(claims.Subject, 10, 64)
	if e != nil || id <= 0 {
		return User{}, Unauthorized
	}
	u, e := s.store.ByID(ctx, id)
	if e != nil {
		if errors.Is(e, pgx.ErrNoRows) {
			return User{}, Unauthorized
		}
		return User{}, e
	}
	if !u.Active {
		return User{}, Unauthorized
	}
	return u, nil
}
func (s *Service) List(ctx context.Context, limit, offset int) ([]User, error) {
	return s.store.List(ctx, limit, offset)
}
func (s *Service) SetRoles(ctx context.Context, id int64, roles []string) error {
	return s.store.SetRoles(ctx, id, roles)
}
func (s *Service) SetActive(ctx context.Context, id int64, active bool) error {
	return s.store.SetActive(ctx, id, active)
}
