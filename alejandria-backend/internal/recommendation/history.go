package recommendation

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
)

func validateHistoryWindow(limit, offset int) error {
	if limit < 1 || limit > 100 || offset < 0 {
		return errs.NewBadRequestError("invalid history pagination", false, nil, nil, nil)
	}
	return nil
}

func (c *Client) History(ctx context.Context, id string, limit, offset int) (HistoricalRatings, error) {
	var out HistoricalRatings
	if err := validateHistoryWindow(limit, offset); err != nil {
		return out, err
	}
	body, err := json.Marshal(HistoryRequest{GoodreadsUserID: id, Limit: limit, Offset: offset})
	if err != nil {
		return out, err
	}
	if err = c.requestJSON(ctx, http.MethodPost, "/api/v1/recommendations/history", body, "history", &out); err != nil {
		return out, err
	}
	if out.Source != "goodreads_train" || out.ModelVersion != "v2" || out.Total < 0 || out.PositiveCount < 0 || out.PositiveCount > out.Total || out.Limit != limit || out.Offset != offset || out.Data == nil || len(out.Data) != min(limit, max(0, out.Total-offset)) {
		return out, invalidResponse()
	}
	seen := map[string]bool{}
	for i, item := range out.Data {
		if strings.TrimSpace(item.GoodreadsBookID) == "" || seen[item.GoodreadsBookID] || item.Rating < 1 || item.Rating > 5 {
			return out, invalidResponse()
		}
		seen[item.GoodreadsBookID] = true
		// La correspondencia local la decide Go, nunca el servicio de ML.
		out.Data[i].LocalBookID = nil
		if item.Authors == nil {
			out.Data[i].Authors = []string{}
		}
		if item.Genres == nil {
			out.Data[i].Genres = []string{}
		}
	}
	return out, nil
}

func (s *Service) History(ctx context.Context, actor user.User, limit, offset int) (HistoricalRatings, error) {
	if err := validateReader(actor, 1); err != nil {
		return HistoricalRatings{}, err
	}
	if err := validateHistoryWindow(limit, offset); err != nil {
		return HistoricalRatings{}, err
	}
	profile, err := s.historicalProfile(ctx, actor)
	if err != nil {
		return HistoricalRatings{}, err
	}
	if profile == nil {
		return HistoricalRatings{}, errs.NewConflictError("Esta cuenta no tiene un perfil histórico de prueba.", false)
	}
	out, err := s.inference.History(ctx, profile.GoodreadsUserID, limit, offset)
	if err != nil {
		return HistoricalRatings{}, err
	}
	ids := make([]string, 0, len(out.Data))
	for _, item := range out.Data {
		ids = append(ids, item.GoodreadsBookID)
	}
	matches, err := s.catalog.LookupGoodreads(ctx, ids)
	if err != nil {
		return HistoricalRatings{}, err
	}
	local := map[string]int64{}
	for _, match := range matches {
		local[match.GoodreadsBookID] = match.ID
	}
	for i, item := range out.Data {
		if id, ok := local[item.GoodreadsBookID]; ok {
			out.Data[i].LocalBookID = &id
		}
	}
	return out, nil
}
