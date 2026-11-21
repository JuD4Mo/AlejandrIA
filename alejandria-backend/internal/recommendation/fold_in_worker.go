package recommendation

import (
	"context"
	"time"

	"github.com/rs/zerolog"
)

type FoldInWorker struct {
	store     *Repository
	inference FoldInInference
}

func NewFoldInWorker(store *Repository, inference FoldInInference) *FoldInWorker {
	return &FoldInWorker{store: store, inference: inference}
}

// ProcessOne publica solo la revisión reclamada. Nuevas valoraciones invalidan trabajos en vuelo.
func (w *FoldInWorker) ProcessOne(ctx context.Context, info LocalModelInfo) (bool, error) {
	return w.ProcessUser(ctx, info, 0)
}

// ProcessUser procesa una cuenta concreta o la siguiente pendiente (userID=0).
func (w *FoldInWorker) ProcessUser(ctx context.Context, info LocalModelInfo, userID int64) (bool, error) {
	job, err := w.store.ClaimFoldIn(ctx, userID)
	if err != nil || job == nil {
		return false, err
	}
	result, err := w.inference.FitLocal(ctx, info, job.Ratings)
	if err != nil {
		_ = w.store.RetryFoldIn(ctx, job)
		return true, err
	}
	_, err = w.store.PublishFoldIn(ctx, job, result)
	return true, err
}
func (w *FoldInWorker) Run(ctx context.Context, log *zerolog.Logger) {
	timer := time.NewTicker(3 * time.Second)
	defer timer.Stop()
	for {
		info, err := w.inference.LocalModel(ctx)
		if err == nil {
			err = w.store.RequeueModel(ctx, info.ModelSignature)
		}
		if err == nil {
			for i := 0; i < 20 && ctx.Err() == nil; i++ {
				var found bool
				found, err = w.ProcessOne(ctx, info)
				if err != nil || !found {
					break
				}
			}
		}
		if err != nil && ctx.Err() == nil {
			log.Warn().Msg("fold_in_worker: adaptación pendiente; se reintentará")
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
