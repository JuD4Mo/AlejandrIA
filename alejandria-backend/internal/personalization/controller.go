package personalization

import (
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
)

type Controller struct{ service *Service }

func NewController(service *Service) *Controller { return &Controller{service: service} }
func (c *Controller) Preferences(w http.ResponseWriter, r *http.Request) {
	p, err := web.Pagination(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	rows, err := c.service.Preferences(r.Context(), user.Identity(r.Context()), p.Limit, p.Offset)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]any{"data": rows, "pagination": p})
}
func (c *Controller) ReplacePreferences(w http.ResponseWriter, r *http.Request) {
	var p GenreSelection
	if err := validation.BindAndValidate(r, &p); err != nil {
		web.Fail(w, r, err)
		return
	}
	if err := c.service.ReplacePreferences(r.Context(), user.Identity(r.Context()), p); err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]bool{"updated": true})
}
func (c *Controller) ClearPreferences(w http.ResponseWriter, r *http.Request) {
	if err := c.service.ReplacePreferences(r.Context(), user.Identity(r.Context()), GenreSelection{GenreIDs: []int64{}}); err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]bool{"deleted": true})
}
func (c *Controller) DeletePreference(w http.ResponseWriter, r *http.Request) {
	id, err := web.ID(r, "genreID")
	if err == nil {
		err = c.service.DeletePreference(r.Context(), user.Identity(r.Context()), id)
	}
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]bool{"deleted": true})
}
func (c *Controller) Ratings(w http.ResponseWriter, r *http.Request) {
	p, err := web.Pagination(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	rows, err := c.service.Ratings(r.Context(), user.Identity(r.Context()), p.Limit, p.Offset)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]any{"data": rows, "pagination": p})
}
func (c *Controller) PutRating(w http.ResponseWriter, r *http.Request) {
	id, err := web.ID(r, "bookID")
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	var p RatingInput
	if err = validation.BindAndValidate(r, &p); err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.PutRating(r.Context(), user.Identity(r.Context()), id, p)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, out)
}
func (c *Controller) DeleteRating(w http.ResponseWriter, r *http.Request) {
	id, err := web.ID(r, "bookID")
	if err == nil {
		err = c.service.DeleteRating(r.Context(), user.Identity(r.Context()), id)
	}
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]bool{"deleted": true})
}
func (c *Controller) Interactions(w http.ResponseWriter, r *http.Request) {
	p, err := web.Pagination(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.Interactions(r.Context(), user.Identity(r.Context()), p.Limit, p.Offset)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, map[string]any{"data": out, "pagination": p})
}
func (c *Controller) AddInteraction(w http.ResponseWriter, r *http.Request) {
	var p InteractionInput
	if err := validation.BindAndValidate(r, &p); err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.AddInteraction(r.Context(), user.Identity(r.Context()), p)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 201, out)
}
