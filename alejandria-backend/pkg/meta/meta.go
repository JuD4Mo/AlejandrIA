package meta

import (
	"fmt"
	"math"
	"net/url"
	"strconv"
)

const DefaultLimit = 20
const MaxLimit = 100

// Window es el rango SQL. Meta añade totales cuando el recurso los conoce.
// El contrato HTTP existente limit/offset se conserva sin inventar totales.
type Window struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

func Parse(values url.Values) (Window, error) {
	p := Window{Limit: DefaultLimit}
	for _, name := range []string{"limit", "offset"} {
		if v := values.Get(name); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || (name == "limit" && (n < 1 || n > MaxLimit)) {
				return p, fmt.Errorf("invalid pagination")
			}
			if name == "limit" {
				p.Limit = n
			} else {
				p.Offset = n
			}
		}
	}
	return p, nil
}

type Meta struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	TotalItems int `json:"total_items"`
	TotalPages int `json:"total_pages"`
}

func New(page, limit, totalItems int) (*Meta, error) {
	if limit <= 0 {
		limit = DefaultLimit
	}
	if page <= 0 {
		page = 1
	}

	totalPages := int(math.Ceil(float64(totalItems) / float64(limit)))

	return &Meta{
		Page:       page,
		Limit:      limit,
		TotalItems: totalItems,
		TotalPages: totalPages,
	}, nil
}

func (m *Meta) Offset() int {
	return (m.Page - 1) * m.Limit
}
