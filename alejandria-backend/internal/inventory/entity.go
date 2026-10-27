package inventory

import (
	"strings"
)

type Input struct {
	InventoryCode string  `json:"inventory_code" validate:"required,max=200"`
	Status        string  `json:"status" validate:"required,oneof=circulating maintenance lost withdrawn"`
	Location      *string `json:"location"`
}

func (p *Input) Validate() error {
	p.InventoryCode = strings.TrimSpace(p.InventoryCode)
	if p.Status == "" {
		p.Status = "circulating"
	}
	return nil
}

type Copy struct {
	ID     int64 `json:"id"`
	BookID int64 `json:"book_id"`
	Input
	Available bool `json:"available_for_circulation"`
}
type Summary struct {
	Total     int    `json:"total"`
	Available int    `json:"available"`
	Copies    []Copy `json:"copies"`
}
