package catalog

import (
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
	"strconv"
)

type Controller struct{ s *Service }

func (c *Controller) NamedByID(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, e := web.ID(r, "id")
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		n, e := c.s.NamedByID(r.Context(), kind, id)
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, n)
	}
}

func NewController(s *Service) *Controller { return &Controller{s} }
func (c *Controller) Books(w http.ResponseWriter, r *http.Request) {
	p, e := web.Pagination(r)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	f := Filter{Title: r.URL.Query().Get("title"), Limit: p.Limit, Offset: p.Offset}
	for _, name := range []string{"author_id", "genre_id"} {
		if v := r.URL.Query().Get(name); v != "" {
			n, e := strconv.ParseInt(v, 10, 64)
			if e != nil || n <= 0 {
				web.Fail(w, r, errs.NewBadRequestError("invalid filter", false, nil, nil, nil))
				return
			}
			if name == "author_id" {
				f.AuthorID = n
			} else {
				f.GenreID = n
			}
		}
	}
	b, e := c.s.Books(r.Context(), f)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]any{"data": b, "pagination": p})
}
func (c *Controller) Book(w http.ResponseWriter, r *http.Request) {
	id, e := web.ID(r, "id")
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	b, e := c.s.Book(r.Context(), id)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, b)
}
func (c *Controller) SaveBook(w http.ResponseWriter, r *http.Request) {
	var id int64
	var e error
	if r.Method == "PUT" {
		id, e = web.ID(r, "id")
		if e != nil {
			web.Fail(w, r, e)
			return
		}
	}
	var p BookInput
	if e = validation.BindAndValidate(r, &p); e != nil {
		web.Fail(w, r, e)
		return
	}
	b, e := c.s.SaveBook(r.Context(), id, p)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	web.JSON(w, status, b)
}
func (c *Controller) Named(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, e := web.Pagination(r)
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		out, e := c.s.Named(r.Context(), kind, p.Limit, p.Offset)
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, map[string]any{"data": out, "pagination": p})
	}
}
func (c *Controller) SaveNamed(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var id int64
		var e error
		if r.Method == "PUT" {
			id, e = web.ID(r, "id")
			if e != nil {
				web.Fail(w, r, e)
				return
			}
		}
		var p NamedInput
		if e = validation.BindAndValidate(r, &p); e == nil {
			id, e = c.s.SaveNamed(r.Context(), kind, id, p)
		}
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, map[string]int64{"id": id})
	}
}
func (c *Controller) Delete(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, e := web.ID(r, "id")
		if e == nil {
			e = c.s.Delete(r.Context(), kind, id)
		}
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, map[string]bool{"deleted": true})
	}
}
