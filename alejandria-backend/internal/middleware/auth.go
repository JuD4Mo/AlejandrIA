package middleware

import (
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
	"strings"
)

func Authentication(s *user.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			parts := strings.Fields(r.Header.Get("Authorization"))
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				web.Fail(w, r, user.Unauthorized)
				return
			}
			u, e := s.Authenticate(r.Context(), parts[1])
			if e != nil {
				web.Fail(w, r, e)
				return
			}
			next.ServeHTTP(w, r.WithContext(user.WithIdentity(r.Context(), u)))
		})
	}
}
func Roles(names ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !user.Identity(r.Context()).HasRole(names...) {
				web.Fail(w, r, errs.NewForbiddenError("insufficient role", false))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
