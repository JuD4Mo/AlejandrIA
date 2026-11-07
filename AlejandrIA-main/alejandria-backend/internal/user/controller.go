package user

import (
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
)

type Controller struct{ s *Service }

func NewController(s *Service) *Controller { return &Controller{s} }
func (c *Controller) Register(w http.ResponseWriter, r *http.Request) {
	var p Register
	if e := validation.BindAndValidate(r, &p); e != nil {
		web.Fail(w, r, e)
		return
	}
	u, e := c.s.Register(r.Context(), p)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 201, u)
}
func (c *Controller) Login(w http.ResponseWriter, r *http.Request) {
	var p Login
	if e := validation.BindAndValidate(r, &p); e != nil {
		web.Fail(w, r, e)
		return
	}
	token, e := c.s.Login(r.Context(), p)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]any{"access_token": token, "token_type": "Bearer", "expires_in": 3600})
}
func (c *Controller) Me(w http.ResponseWriter, r *http.Request) {
	web.JSON(w, 200, Identity(r.Context()))
}
func (c *Controller) List(w http.ResponseWriter, r *http.Request) {
	p, e := web.Pagination(r)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	u, e := c.s.List(r.Context(), p.Limit, p.Offset)
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]any{"data": u, "pagination": p})
}
func (c *Controller) Roles(w http.ResponseWriter, r *http.Request) {
	id, e := web.ID(r, "id")
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	var p RoleRequest
	if e = validation.BindAndValidate(r, &p); e == nil {
		e = c.s.SetRoles(r.Context(), id, p.Roles)
	}
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]bool{"updated": true})
}
func (c *Controller) Active(w http.ResponseWriter, r *http.Request) {
	id, e := web.ID(r, "id")
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	var p ActiveRequest
	if e = validation.BindAndValidate(r, &p); e == nil {
		e = c.s.SetActive(r.Context(), id, *p.Active)
	}
	if e != nil {
		web.Fail(w, r, e)
		return
	}
	web.JSON(w, 200, map[string]bool{"updated": true})
}
