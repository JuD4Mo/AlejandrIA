// Package web contiene adaptadores HTTP compartidos, sin reglas de negocio.
package web

import (
	"encoding/json"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/sqlerr"
	"github.com/JuD4Mo/alejandria-backend/pkg/meta"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"net/http"
	"strconv"
)

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var h *errs.HTTPError
	if !errors.As(err, &h) {
		err = sqlerr.HandleError(err)
		_ = errors.As(err, &h)
	}
	if h == nil {
		h = errs.NewInternalServerError()
	}
	if h.Status >= 500 {
		zerolog.Ctx(r.Context()).Error().Msg("request failed internally")
	}
	JSON(w, h.Status, h)
}
func ID(r *http.Request, name string) (int64, error) {
	n, e := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if e != nil || n <= 0 {
		return 0, errs.NewBadRequestError("invalid identifier", false, nil, nil, nil)
	}
	return n, nil
}

func Pagination(r *http.Request) (meta.Window, error) {
	p, err := meta.Parse(r.URL.Query())
	if err != nil {
		return p, errs.NewBadRequestError("invalid pagination", false, nil, nil, nil)
	}
	return p, nil
}
