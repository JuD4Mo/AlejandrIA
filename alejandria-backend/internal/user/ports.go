package user

import "context"

// Store es el límite persistente del servicio de identidad, sustituible en pruebas.
type Store interface {
	Create(context.Context, Register, string, bool) (User, error)
	ByEmail(context.Context, string) (User, error)
	ByID(context.Context, int64) (User, error)
	List(context.Context, int, int) ([]User, error)
	SetRoles(context.Context, int64, []string) error
	SetActive(context.Context, int64, bool) error
}
