package database

import (
	"context"
	"fmt"
	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"net"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Database struct {
	Pool *pgxpool.Pool
}

func connectionURL(cfg *config.Config) string {
	u := url.URL{Scheme: "postgres", Host: net.JoinHostPort(cfg.Database.Host, strconv.Itoa(cfg.Database.Port)), User: url.UserPassword(cfg.Database.User, cfg.Database.Password), Path: "/" + cfg.Database.Name}
	q := u.Query()
	q.Set("sslmode", cfg.Database.SSLMode)
	q.Set("timezone", "UTC")
	u.RawQuery = q.Encode()
	return u.String()
}

func NewDB(ctx context.Context, cfg *config.Config) (*Database, error) {
	dsn := connectionURL(cfg)

	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database config: %w", err)
	}

	poolConfig.MaxConns = int32(cfg.Database.MaxOpenConns)
	if poolConfig.MaxConns == 0 {
		poolConfig.MaxConns = 10
	}
	poolConfig.MinConns = int32(cfg.Database.MinConns)
	poolConfig.MaxConnLifetime = time.Duration(cfg.Database.ConnMaxLifetime) * time.Minute
	poolConfig.MaxConnIdleTime = time.Duration(cfg.Database.ConnMaxIdleTime) * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &Database{
		Pool: pool,
	}, nil
}

func (db *Database) Close() error {
	if db.Pool != nil {
		db.Pool.Close()
	}
	return nil
}
