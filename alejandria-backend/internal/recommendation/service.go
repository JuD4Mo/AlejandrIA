package recommendation

import (
	"context"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"strings"
)

type Service struct {
	inference     Inference
	catalog       Catalog
	personal      Personalization
	inventory     Inventory
	selection     SelectionStore
	foldInEnabled bool
}

func NewService(client Inference, catalog Catalog, personal Personalization, inventory Inventory, selection ...SelectionStore) *Service {
	s := &Service{inference: client, catalog: catalog, personal: personal, inventory: inventory, foldInEnabled: true}
	if len(selection) > 0 {
		s.selection = selection[0]
	}
	return s
}
func (s *Service) WithFoldIn(enabled bool) *Service { s.foldInEnabled = enabled; return s }
func validateLimit(limit int) error {
	if limit < 1 || limit > 50 {
		return errs.NewBadRequestError("limit must be between 1 and 50", false, nil, nil, nil)
	}
	return nil
}
func (s *Service) ForReader(ctx context.Context, actor user.User, limit int) (Response, error) {
	if err := validateReader(actor, limit); err != nil {
		return Response{}, err
	}
	var excluded []string
	if s.selection != nil {
		var err error
		excluded, err = s.selection.Exclusions(ctx, actor.ID)
		if err != nil {
			return Response{}, err
		}
	}
	profile, err := s.historicalProfile(ctx, actor)
	if err != nil {
		return Response{}, err
	}
	local, err := s.localState(ctx, actor, profile)
	if err != nil {
		return Response{}, err
	}
	return s.forReader(ctx, actor, limit, excluded, profile, local)
}
func validateReader(actor user.User, limit int) error {
	if !actor.Active || actor.ID <= 0 || !actor.HasRole("lector", "administrador") {
		return errs.NewForbiddenError("Active reader role required", false)
	}
	return validateLimit(limit)
}
func (s *Service) Refresh(ctx context.Context, actor user.User, limit int, current []string) (Response, error) {
	if err := validateReader(actor, limit); err != nil {
		return Response{}, err
	}
	if s.selection == nil {
		return Response{}, errs.NewServiceUnavailableError("Recommendation history is unavailable")
	}
	profile, err := s.historicalProfile(ctx, actor)
	if err != nil {
		return Response{}, err
	}
	local, err := s.localState(ctx, actor, profile)
	if err != nil {
		return Response{}, err
	}
	return s.selection.Refresh(ctx, actor.ID, current, func(excluded []string) (Response, error) {
		out, err := s.forReader(ctx, actor, limit, excluded, profile, local)
		if err == nil && out.Status == "no_content_matches" {
			out.Message = "No quedan coincidencias nuevas con puntuación positiva. Puede ampliar sus preferencias; los libros valorados y prestados siguen excluidos."
			if profile != nil {
				out.Message = "No quedan candidatos nuevos para este perfil histórico de prueba con las exclusiones actuales. El historial simulado permanece fijo."
			}
		}
		return out, err
	})
}
func (s *Service) historicalProfile(ctx context.Context, actor user.User) (*HistoricalProfile, error) {
	if s.selection == nil {
		return nil, nil
	}
	profile, err := s.selection.HistoricalProfile(ctx, actor.ID)
	if err != nil {
		return nil, err
	}
	if profile != nil && profile.ModelVersion != "v2" {
		return nil, errs.NewConflictError("El perfil de prueba pertenece a otra versión del modelo.", false)
	}
	return profile, nil
}
func (s *Service) localState(ctx context.Context, actor user.User, historical *HistoricalProfile) (*LocalState, error) {
	if !s.foldInEnabled || s.selection == nil || historical != nil {
		return nil, nil
	}
	state, err := s.selection.LocalState(ctx, actor.ID)
	if err != nil {
		return nil, err
	}
	if state == nil {
		state = &LocalState{FoldInStatus: FoldInStatus{Status: "insufficient", Reason: "minimum_ratings", MinimumRatings: 5}}
	}
	return state, nil
}
func (s *Service) forReader(ctx context.Context, actor user.User, limit int, excluded []string, profile *HistoricalProfile, local *LocalState) (Response, error) {
	if profile != nil {
		upstream, err := s.inference.Hybrid(ctx, profile.GoodreadsUserID, limit, excluded)
		if err != nil {
			return Response{}, err
		}
		out, err := s.finish(ctx, upstream, excluded)
		out.ProfileOrigin = "goodreads_test"
		return out, err
	}
	if local != nil && local.Status == "ready" && local.Profile != nil && local.Revision == local.ProcessedRevision {
		upstream, err := s.inference.LocalHybrid(ctx, *local.Profile, limit, excluded)
		if err == nil {
			out, err := s.finish(ctx, upstream, excluded)
			out.ProfileOrigin = "local_fold_in"
			out.FoldIn = &local.FoldInStatus
			return out, err
		}
		var httpErr *errs.HTTPError
		if !errors.As(err, &httpErr) || httpErr.Status != 409 {
			return Response{}, err
		}
		local.Status = "stale"
		local.Reason = "model_changed"
	}
	out, err := s.contentForReader(ctx, actor, limit, excluded)
	if local != nil {
		out.FoldIn = &local.FoldInStatus
	}
	return out, err
}
func (s *Service) contentForReader(ctx context.Context, actor user.User, limit int, excluded []string) (Response, error) {
	genres, err := s.personal.Preferences(ctx, actor, 100, 0)
	if err != nil {
		return Response{}, err
	}
	ratings, err := s.personal.Ratings(ctx, actor, 100, 0)
	if err != nil {
		return Response{}, err
	}
	p := Preferences{Genres: []string{}, Authors: []string{}, Keywords: []string{}, ExcludeBookIDs: excluded}
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
	return s.finish(ctx, upstream, excluded)
}
func (s *Service) finish(ctx context.Context, upstream UpstreamResponse, excluded []string) (Response, error) {
	// Defensa adicional ante un upstream que ignore exclusiones o rellene con score cero.
	blocked := map[string]bool{}
	for _, id := range excluded {
		blocked[id] = true
	}
	items := make([]UpstreamItem, 0, len(upstream.Recommendations))
	for _, item := range upstream.Recommendations {
		if !blocked[item.BookID] && item.Score != nil && *item.Score > 0 {
			items = append(items, item)
		}
	}
	upstream.Recommendations = items
	positive := false
	for _, r := range upstream.Recommendations {
		if r.Score != nil && *r.Score > 0 {
			positive = true
			break
		}
	}
	if !positive {
		out := emptyResponse("no_content_matches", "No hay coincidencias elegibles suficientes para este perfil.")
		out.RecommendationType = upstream.RecommendationType
		return out, nil
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
