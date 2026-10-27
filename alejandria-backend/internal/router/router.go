package router

import (
	"context"
	"net/http"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/catalog"
	"github.com/JuD4Mo/alejandria-backend/internal/circulation"
	"github.com/JuD4Mo/alejandria-backend/internal/inventory"
	"github.com/JuD4Mo/alejandria-backend/internal/middleware"
	"github.com/JuD4Mo/alejandria-backend/internal/personalization"
	"github.com/JuD4Mo/alejandria-backend/internal/recommendation"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
	"github.com/JuD4Mo/alejandria-backend/internal/user"

	"github.com/go-chi/chi/v5"
)

func NewRouter(s *server.Server) *chi.Mux {
	r := chi.NewRouter()

	globalMw := middleware.NewGlobalMiddlewares(s)

	r.Use(globalMw.Recover)
	r.Use(globalMw.RequestLogger)
	r.Use(globalMw.CORS)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	r.Get("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.DB.Pool.Ping(ctx); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ready"))
	})
	users := user.NewService(user.NewRepository(s.DB.Pool), s.Config.Auth.Secret)
	u := user.NewController(users)
	personalizationService := personalization.NewService(personalization.NewRepository(s.DB.Pool))
	p := personalization.NewController(personalizationService)
	catalogService := catalog.NewService(catalog.NewRepository(s.DB.Pool))
	c := catalog.NewController(catalogService)
	circulationService := circulation.NewService(circulation.NewRepository(s.DB.Pool))
	inventoryService := inventory.NewService(inventory.NewRepository(s.DB.Pool))
	i := inventory.NewController(inventoryService)
	l := circulation.NewController(circulationService)
	recommendations := recommendation.NewController(recommendation.NewService(recommendation.NewClient(s.Config.Recommendation.URL, s.Config.Recommendation.Timeout), catalogService, personalizationService, inventoryService))
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", u.Register)
		r.Post("/auth/login", u.Login)
		r.Group(func(r chi.Router) {
			r.Use(middleware.Authentication(users))
			r.Get("/auth/me", u.Me)
			r.With(middleware.Roles("administrador")).Get("/users", u.List)
			r.With(middleware.Roles("administrador")).Put("/users/{id}/roles", u.Roles)
			r.With(middleware.Roles("administrador")).Patch("/users/{id}/active", u.Active)
			r.Get("/books", c.Books)
			r.Get("/books/{id}", c.Book)
			r.Get("/books/{id}/copies", i.List)
			r.Get("/books/{id}/similar", recommendations.Similar)
			for _, kind := range []string{"works", "authors", "genres"} {
				r.Get("/"+kind, c.Named(kind))
				r.Get("/"+kind+"/{id}", c.NamedByID(kind))
			}
			r.Get("/loan-requests", l.List("requests"))
			r.Get("/loans", l.List("loans"))
			r.Get("/reservations", l.List("reservations"))
			r.Get("/renewals", l.List("renewals"))
			r.Group(func(r chi.Router) {
				r.Use(middleware.Roles("lector", "administrador"))
				r.Get("/users/me/recommendations", recommendations.ForReader)
				r.Get("/users/me/preferences/genres", p.Preferences)
				r.Put("/users/me/preferences/genres", p.ReplacePreferences)
				r.Delete("/users/me/preferences/genres", p.ClearPreferences)
				r.Delete("/users/me/preferences/genres/{genreID}", p.DeletePreference)
				r.Get("/users/me/ratings", p.Ratings)
				r.Put("/users/me/ratings/{bookID}", p.PutRating)
				r.Delete("/users/me/ratings/{bookID}", p.DeleteRating)
				r.Get("/users/me/interactions", p.Interactions)
				r.Post("/users/me/interactions", p.AddInteraction)
				r.Post("/loan-requests", l.Create(false))
				r.Post("/loan-requests/{id}/cancel", l.Action("cancel-request"))
				r.Post("/reservations", l.Create(true))
				r.Post("/reservations/{id}/cancel", l.Action("cancel"))
				r.Post("/loans/{id}/renewals", l.Action("renew"))
				r.Post("/renewals/{id}/cancel", l.Action("cancel-renewal"))
			})
			r.Group(func(r chi.Router) {
				r.Use(middleware.Roles("bibliotecario", "administrador"))
				r.Post("/books", c.SaveBook)
				r.Put("/books/{id}", c.SaveBook)
				r.Delete("/books/{id}", c.Delete("books"))
				for _, kind := range []string{"works", "authors", "genres"} {
					r.Post("/"+kind, c.SaveNamed(kind))
					r.Put("/"+kind+"/{id}", c.SaveNamed(kind))
					r.Delete("/"+kind+"/{id}", c.Delete(kind))
				}
				r.Post("/books/{id}/copies", i.Save)
				r.Put("/books/{id}/copies/{copyID}", i.Save)
				r.Post("/loan-requests/{id}/deliver", l.Action("deliver"))
				r.Post("/loan-requests/{id}/reject", l.Action("reject"))
				r.Post("/loans/{id}/return", l.Action("return"))
				r.Post("/reservations/{id}/pickup", l.Action("pickup"))
				r.Post("/renewals/{id}/decision", l.Action("decide"))
			})
		})
	})

	return r
}
