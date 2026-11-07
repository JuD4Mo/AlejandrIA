package user

import (
	"context"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

type fakeStore struct {
	Store
	u         User
	hash      string
	bootstrap bool
}

func (f *fakeStore) Create(_ context.Context, p Register, h string, admin bool) (User, error) {
	f.hash = h
	f.bootstrap = admin
	return User{ID: 1, Email: p.Email, Active: true, Roles: []string{"lector"}}, nil
}
func (f *fakeStore) ByEmail(context.Context, string) (User, error) {
	if f.u.ID == 0 {
		return User{}, pgx.ErrNoRows
	}
	return f.u, nil
}
func (f *fakeStore) ByID(context.Context, int64) (User, error) { return f.u, nil }
func TestRegisterHashesPasswordAndNeverBootstraps(t *testing.T) {
	f := new(fakeStore)
	s := NewService(f, strings.Repeat("s", 32))
	p := Register{Email: "reader@example.org", DisplayName: "Reader", Password: "a-long-password"}
	_, e := s.Register(context.Background(), p)
	if e != nil {
		t.Fatal(e)
	}
	if f.bootstrap || f.hash == p.Password || bcrypt.CompareHashAndPassword([]byte(f.hash), []byte(p.Password)) != nil {
		t.Fatal("unsafe registration")
	}
}
func TestLoginAndRevocationByDeactivation(t *testing.T) {
	hash, e := bcrypt.GenerateFromPassword([]byte("a-long-password"), bcrypt.MinCost)
	if e != nil {
		t.Fatal(e)
	}
	f := &fakeStore{u: User{ID: 1, Active: true, PasswordHash: string(hash)}}
	s := NewService(f, strings.Repeat("s", 32))
	ctx := context.Background()
	token, e := s.Login(ctx, Login{Email: "reader@example.org", Password: "a-long-password"})
	if e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		name, token string
		active      bool
		ok          bool
	}{{"valid", token, true, true}, {"tampered", token + "x", true, false}, {"inactive", token, false, false}} {
		t.Run(tc.name, func(t *testing.T) {
			f.u.Active = tc.active
			_, e := s.Authenticate(ctx, tc.token)
			if (e == nil) != tc.ok {
				t.Fatalf("unexpected authentication: %v", e)
			}
		})
	}
}
