package circulation

import (
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
)

type Controller struct{ s *Service }

func NewController(s *Service) *Controller { return &Controller{s} }
func (c *Controller) Create(reserve bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var p BookRequest
		if e := validation.BindAndValidate(r, &p); e != nil {
			web.Fail(w, r, e)
			return
		}
		u := user.Identity(r.Context())
		if reserve {
			q, e := c.s.Reserve(r.Context(), u, p.BookID)
			if e != nil {
				web.Fail(w, r, e)
				return
			}
			web.JSON(w, 201, q)
		} else {
			id, e := c.s.Request(r.Context(), u, p.BookID)
			if e != nil {
				web.Fail(w, r, e)
				return
			}
			web.JSON(w, 201, map[string]int64{"id": id})
		}
	}
}
func (c *Controller) List(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p, e := web.Pagination(r)
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		rows, e := c.s.List(r.Context(), user.Identity(r.Context()), kind, p.Limit, p.Offset)
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, map[string]any{"data": rows, "pagination": p})
	}
}
func (c *Controller) Action(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, e := web.ID(r, "id")
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		u := user.Identity(r.Context())
		var out any = map[string]bool{"updated": true}
		switch action {
		case "deliver":
			var p Delivery
			e = validation.BindAndValidate(r, &p)
			if e == nil {
				out, e = c.s.Deliver(r.Context(), u, id, p.CopyID)
			}
		case "reject":
			var p Rejection
			e = validation.BindAndValidate(r, &p)
			if e == nil {
				e = c.s.Reject(r.Context(), u, id, p.Reason)
			}
		case "return":
			out, e = c.s.Return(r.Context(), u, id)
		case "pickup":
			out, e = c.s.Pickup(r.Context(), u, id)
		case "cancel":
			e = c.s.Cancel(r.Context(), u, id)
		case "cancel-request":
			e = c.s.CancelRequest(r.Context(), u, id)
		case "cancel-renewal":
			e = c.s.CancelRenewal(r.Context(), u, id)
		case "renew":
			var n int64
			n, e = c.s.Renew(r.Context(), u, id)
			out = map[string]int64{"id": n}
		case "decide":
			var p Decision
			e = validation.BindAndValidate(r, &p)
			if e == nil {
				e = c.s.DecideRenewal(r.Context(), u, id, *p.Approve, p.Reason)
			}
		}
		if e != nil {
			web.Fail(w, r, e)
			return
		}
		web.JSON(w, 200, out)
	}
}
