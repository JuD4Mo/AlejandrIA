package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JuD4Mo/alejandria-backend/internal/circulation"
	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/logger"
	"github.com/JuD4Mo/alejandria-backend/internal/router"
	"github.com/JuD4Mo/alejandria-backend/internal/server"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	appLogger := logger.NewLogger()

	srv, err := server.New(cfg, &appLogger)
	if err != nil {
		appLogger.Fatal().Err(err).Msg("failed to initialize server")
	}

	r := router.NewRouter(srv)

	srv.SetupHTTPServer(r)
	workerCtx, stopWorker := context.WithCancel(context.Background())
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		circulation.NewService(circulation.NewRepository(srv.DB.Pool)).Run(workerCtx, &appLogger)
	}()

	serverErrors := make(chan error, 1)
	go func() { serverErrors <- srv.Start() }()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-quit:
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			appLogger.Error().Err(err).Msg("server error")
		}
	}

	appLogger.Info().Msg("shutting down server...")
	stopWorker()
	<-workerDone

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		appLogger.Fatal().Err(err).Msg("failed to shutdown server gracefully")
	}

	appLogger.Info().Msg("server stopped")
}
