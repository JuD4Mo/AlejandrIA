package recommendation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/JuD4Mo/alejandria-backend/internal/errs"
	"github.com/rs/zerolog"
	"io"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 1 << 20

type Client struct {
	base string
	http *http.Client
}

func NewClient(base string, timeout time.Duration) *Client {
	if base == "" {
		base = "http://recommendations:8000"
	}
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: min(3*time.Second, timeout), KeepAlive: 30 * time.Second}).DialContext
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 8
	transport.MaxConnsPerHost = 8
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: timeout, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *Client) Preferences(ctx context.Context, p Preferences, limit int) (UpstreamResponse, error) {
	body, err := json.Marshal(PreferencesRequest{Preferences: p, Limit: limit})
	if err != nil {
		return UpstreamResponse{}, err
	}
	return c.request(ctx, http.MethodPost, "/api/v1/recommendations/preferences", body, "content", limit)
}
func (c *Client) Similar(ctx context.Context, id string, limit int) (UpstreamResponse, error) {
	return c.request(ctx, http.MethodGet, "/api/v1/recommendations/similar/"+url.PathEscape(id)+"?limit="+strconv.Itoa(limit), nil, "similar", limit)
}
func (c *Client) request(ctx context.Context, method, path string, body []byte, kind string, limit int) (out UpstreamResponse, err error) {
	if err = validateLimit(limit); err != nil {
		return out, err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return out, errs.NewServiceUnavailableError("Recommendation service is not configured correctly")
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	started := time.Now()
	status := 0
	defer func() {
		zerolog.Ctx(ctx).Info().Str("operation", "recommendation_"+kind).Int("upstream_status", status).Dur("duration", time.Since(started)).Msg("recommendation inference request")
	}()
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		var n net.Error
		if errors.As(err, &n) && n.Timeout() {
			return out, errs.NewGatewayTimeoutError("Recommendation service timed out")
		}
		return out, errs.NewServiceUnavailableError("Recommendation service is unavailable")
	}
	defer resp.Body.Close()
	status = resp.StatusCode
	if status != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxResponseBytes))
		if status == http.StatusServiceUnavailable {
			return out, errs.NewServiceUnavailableError("Recommendation engine is not ready")
		}
		if status == http.StatusNotFound && kind == "similar" {
			return out, errs.NewNotFoundError("Goodreads book is absent from recommendation artifacts", false, nil)
		}
		return out, errs.NewBadGatewayError("Recommendation service returned an unsuccessful response")
	}
	media, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return out, invalidResponse()
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		var n net.Error
		if errors.As(err, &n) && n.Timeout() {
			return out, errs.NewGatewayTimeoutError("Recommendation service timed out")
		}
		return out, invalidResponse()
	}
	if len(raw) > maxResponseBytes {
		return out, invalidResponse()
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err = dec.Decode(&out); err != nil {
		return out, invalidResponse()
	}
	if dec.Decode(new(any)) != io.EOF {
		return out, invalidResponse()
	}
	if err = validateResponse(out, kind, limit); err != nil {
		return out, err
	}
	for i := range out.Recommendations {
		if out.Recommendations[i].Authors == nil {
			out.Recommendations[i].Authors = []string{}
		}
		if out.Recommendations[i].Genres == nil {
			out.Recommendations[i].Genres = []string{}
		}
	}
	return out, nil
}
func invalidResponse() error {
	return errs.NewBadGatewayError("Invalid recommendation service response")
}
func validateResponse(out UpstreamResponse, kind string, limit int) error {
	if out.ModelVersion != "v2" || out.RecommendationType != kind || out.Recommendations == nil || out.Count != len(out.Recommendations) || out.Count > limit {
		return invalidResponse()
	}
	seen := map[string]bool{}
	model := "content_cold_start"
	if kind == "similar" {
		model = "content_similar"
	}
	for _, r := range out.Recommendations {
		if strings.TrimSpace(r.BookID) == "" || seen[r.BookID] || r.Model != model || r.ScoreScope != "content_catalog" || r.CollaborativeScore != nil {
			return invalidResponse()
		}
		seen[r.BookID] = true
		for _, score := range []*float64{r.Score, r.ContentScore} {
			if score != nil && (math.IsNaN(*score) || math.IsInf(*score, 0)) {
				return invalidResponse()
			}
		}
	}
	return nil
}
