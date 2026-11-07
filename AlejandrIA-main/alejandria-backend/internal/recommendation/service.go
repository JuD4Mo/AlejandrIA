package recommendation

import (
	"context"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"strings"
)

type Service struct {
	inference Inference
	catalog   Catalog
	personal  Personalization
	inventory Inventory
}

func NewService(client Inference, catalog Catalog, personal Personalization, inventory Inventory) *Service {
	return &Service{inference: client, catalog: catalog, personal: personal, inventory: inventory}
}
func validateLimit(limit int) error {
	if limit < 1 || limit > 50 {
		return errs.NewBadRequestError("limit must be between 1 and 50", false, nil, nil, nil)
	}
	return nil
}
func (s *Service) ForReader(ctx context.Context, actor user.User, limit int) (Response, error) {
	if !actor.Active || actor.ID <= 0 || !actor.HasRole("lector", "administrador") {
		return Response{}, errs.NewForbiddenError("Active reader role required", false)
	}
	if err := validateLimit(limit); err != nil {
		return Response{}, err
	}
	genres, err := s.personal.Preferences(ctx, actor, 100, 0)
	if err != nil {
		return Response{}, err
	}
	ratings, err := s.personal.Ratings(ctx, actor, 100, 0)
	if err != nil {
		return Response{}, err
	}
	p := Preferences{Genres: []string{}, Authors: []string{}, Keywords: []string{}}
	seen := map[string]bool{}
	for _, g := range genres {
		if name := strings.TrimSpace(g.Name); name != "" && !seen[name] {
			seen[name] = true
			p.Genres = append(p.Genres, name)
		}
	}
	seen = map[string]bool{}
	// Solo señal textual de libros positivos con correspondencia Goodreads explícita.
	// No asigna embeddings ni usa el ID local como usuario histórico.
	for _, r := range ratings {
		title := strings.TrimSpace(r.Title)
		if r.Rating >= 4 && r.GoodreadsBookID != nil && strings.TrimSpace(*r.GoodreadsBookID) != "" && title != "" && !seen[title] {
			seen[title] = true
			p.Keywords = append(p.Keywords, title)
			if len(p.Keywords) == 20 {
				break
			}
		}
	}
	if len(p.Genres) == 0 && len(p.Keywords) == 0 {
		return emptyResponse("preferences_required", "Configure sus géneros preferidos o valore positivamente libros con correspondencia Goodreads."), nil
	}
	upstream, err := s.inference.Preferences(ctx, p, limit)
	if err != nil {
		return Response{}, err
	}
	positive := false
	for _, r := range upstream.Recommendations {
		if r.Score != nil && *r.Score > 0 {
			positive = true
			break
		}
	}
	if !positive {
		return emptyResponse("no_content_matches", "No hay coincidencias de contenido suficientes para sus intereses actuales."), nil
	}
	return s.enrich(ctx, upstream)
}
func emptyResponse(status, message string) Response {
	return Response{Status: status, Message: message, Source: "fastapi_v2", RecommendationType: "content", ModelVersion: "v2", Recommendations: []Item{}}
}
func (s *Service) Similar(ctx context.Context, book int64, limit int) (Response, error) {
	if err := validateLimit(limit); err != nil {
		return Response{}, err
	}
	if book <= 0 {
		return Response{}, errs.NewBadRequestError("invalid local book identifier", false, nil, nil, nil)
	}
	local, err := s.catalog.Book(ctx, book)
	if err != nil {
		return Response{}, err
	}
	if local.GoodreadsBookID == nil || strings.TrimSpace(*local.GoodreadsBookID) == "" {
		return Response{}, errs.NewConflictError("Local book has no Goodreads mapping", false)
	}
	upstream, err := s.inference.Similar(ctx, *local.GoodreadsBookID, limit)
	if err != nil {
		return Response{}, err
	}
	return s.enrich(ctx, upstream)
}
func (s *Service) enrich(ctx context.Context, out UpstreamResponse) (Response, error) {
	ids := make([]string, 0, len(out.Recommendations))
	for _, r := range out.Recommendations {
		ids = append(ids, r.BookID)
	}
	matches, err := s.catalog.LookupGoodreads(ctx, ids)
	if err != nil {
		return Response{}, err
	}
	localIDs := make([]int64, 0, len(matches))
	byGoodreads := make(map[string]int, len(matches))
	for i, b := range matches {
		byGoodreads[b.GoodreadsBookID] = i
		localIDs = append(localIDs, b.ID)
	}
	counts, err := s.inventory.Availability(ctx, localIDs)
	if err != nil {
		return Response{}, err
	}
	result := Response{Status: "ok", Source: "fastapi_v2", RecommendationType: out.RecommendationType, ModelVersion: out.ModelVersion, Recommendations: []Item{}}
	for _, r := range out.Recommendations {
		item := Item{GoodreadsBookID: r.BookID, Title: r.Title, Authors: r.Authors, Genres: r.Genres, Score: r.Score, Model: r.Model, ScoreScope: r.ScoreScope, ContentScore: r.ContentScore, CollaborativeScore: r.CollaborativeScore}
		if i, ok := byGoodreads[r.BookID]; ok {
			b := matches[i]
			c := counts[b.ID]
			available := c.Available > 0
			item.LocalBookID = &b.ID
			item.LocalTitle = &b.Title
			item.InLocalCatalog = true
			item.TotalCopies = &c.Total
			item.AvailableCopies = &c.Available
			item.Available = &available
		}
		result.Recommendations = append(result.Recommendations, item)
	}
	result.Count = len(result.Recommendations)
	return result, nil
}
