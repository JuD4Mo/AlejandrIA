package inventory

import (
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
)

type Controller struct{ s *Service }

func NewController(s *Service) *Controller { return &Controller{s} }
func (c *Controller) List(w http.ResponseWriter, r *http.Request) {
	book, e := web.ID(r, "id")
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	p, e := web.Pagination(r)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	out, e := c.s.List(r.Context(), book, p.Limit, p.Offset)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, out)
}
func (c *Controller) Save(w http.ResponseWriter, r *http.Request) {
	book, e := web.ID(r, "id")
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	var id int64
	if r.Method == "PUT" {
		id, e = web.ID(r, "copyID")
		if e != nil {
			web.Fail(w, r, e)
			return
		}
	}
	var p Input
	if e = validation.BindAndValidate(r, &p); e == nil {
		id, e = c.s.Save(r.Context(), book, id, p)
	}
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]int64{"id": id})
}
