package personalization

import (
	"context"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"testing"
)

type fakeStore struct {
	Store
	userID int64
	ids    []int64
	err    error
}

func (f *fakeStore) ReplacePreferences(_ context.Context, user int64, ids []int64) error {
	f.userID = user
	f.ids = ids
	return f.err
}
func TestPreferenceValidation(t *testing.T) {
	for _, tc := range []struct {
		name string
		ids  []int64
		ok   bool
	}{{"missing", nil, false}, {"clear", []int64{}, true}, {"valid", []int64{1, 2}, true}, {"duplicate", []int64{1, 1}, false}, {"invalid", []int64{-1}, false}, {"too many", make([]int64, 101), false}} {
		t.Run(tc.name, func(t *testing.T) {
			p := GenreSelection{GenreIDs: tc.ids}
			if (p.Validate() == nil) != tc.ok {
				t.Fatal("unexpected preference validation")
			}
		})
	}
}
func TestRatingAndInteractionValidation(t *testing.T) {
	for _, v := range []int{-1, 0, 1, 5, 6} {
		t.Run(string(rune('a'+v+1)), func(t *testing.T) {
			p := RatingInput{Rating: v}
			if (p.Validate() == nil) != (v >= 1 && v <= 5) {
				t.Fatal("rating range")
			}
		})
	}
	for _, tc := range []struct {
		name, kind string
		id         int64
		ok         bool
	}{{"view", "view", 1, true}, {"click", "recommendation_click", 1, true}, {"favorite", "favorite_added", 1, true}, {"remove", "favorite_removed", 1, true}, {"loan is not event", "loan", 1, false}, {"rating is not event", "rating", 1, false}, {"bad id", "view", 0, false}} {
		t.Run(tc.name, func(t *testing.T) {
			p := InteractionInput{BookID: tc.id, Type: tc.kind}
			if (p.Validate() == nil) != tc.ok {
				t.Fatal("interaction validation")
			}
		})
	}
}
func TestServiceUsesAuthenticatedIdentityAndPropagatesFailure(t *testing.T) {
	failure := errors.New("persistence failed")
	store := &fakeStore{err: failure}
	service := NewService(store)
	actor := user.User{ID: 42, Active: true, Roles: []string{"lector"}}
	err := service.ReplacePreferences(context.Background(), actor, GenreSelection{GenreIDs: []int64{5}})
	if !errors.Is(err, failure) || store.userID != 42 {
		t.Fatal("identity or error not preserved")
	}
	store.userID = 0
	actor.Active = false
	if service.ReplacePreferences(context.Background(), actor, GenreSelection{GenreIDs: []int64{5}}) == nil || store.userID != 0 {
		t.Fatal("inactive actor reached persistence")
	}
}
