package recommendation

import (
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/JuD4Mo/alejandria-backend/internal/validation"
	"github.com/JuD4Mo/alejandria-backend/internal/web"
	"net/http"
	"strconv"
)

type Controller struct{ service *Service }

func NewController(s *Service) *Controller { return &Controller{service: s} }
func resultLimit(r *http.Request) (int, error) {
	limit := 10
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return 0, errs.NewBadRequestError("invalid limit", false, nil, nil, nil)
		}
		limit = n
	}
	return limit, validateLimit(limit)
}
func (c *Controller) ForReader(w http.ResponseWriter, r *http.Request) {
	limit, err := resultLimit(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.ForReader(r.Context(), user.Identity(r.Context()), limit)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, out)
}
func (c *Controller) Similar(w http.ResponseWriter, r *http.Request) {
	id, err := web.ID(r, "id")
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	limit, err := resultLimit(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.Similar(r.Context(), id, limit)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, 200, out)
}

func (c *Controller) Refresh(w http.ResponseWriter, r *http.Request) {
	limit, err := resultLimit(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	var input RefreshRequest
	if err = validation.BindAndValidate(r, &input); err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.Refresh(r.Context(), user.Identity(r.Context()), limit, input.CurrentBookIDs)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, http.StatusOK, out)
}

func (c *Controller) History(w http.ResponseWriter, r *http.Request) {
	p, err := web.Pagination(r)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	out, err := c.service.History(r.Context(), user.Identity(r.Context()), p.Limit, p.Offset)
	if err != nil {
		web.Fail(w, r, err)
		return
	}
	web.JSON(w, http.StatusOK, out)
}
