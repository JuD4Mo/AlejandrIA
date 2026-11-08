package config

import (
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/ardanlabs/conf/v3"
	"github.com/joho/godotenv"
)

type Config struct {
	Primary        Primary
	Server         ServerConfig
	Database       DatabaseConfig
	Auth           AuthConfig
	Recommendation RecommendationConfig
}

type RecommendationConfig struct {
	URL     string        `conf:"default:http://recommendations:8000"`
	Timeout time.Duration `conf:"default:8s"`
}

type AuthConfig struct {
	Secret string `conf:"required,mask"`
}

type Primary struct {
	Env string `conf:"default:local"`
}

type ServerConfig struct {
	Port               string `conf:"default:8080"`
	ReadTimeout        int    `conf:"default:10"`
	WriteTimeout       int    `conf:"default:15"`
	IdleTimeout        int    `conf:"default:60"`
	CORSAllowedOrigins []string
}

type DatabaseConfig struct {
	Host            string `conf:"default:localhost"`
	Port            int    `conf:"default:5432"`
	User            string `conf:"required"`
	Password        string `conf:"required,mask"`
	Name            string `conf:"required"`
	SSLMode         string `conf:"default:disable"`
	MaxOpenConns    int    `conf:"default:10"`
	MinConns        int    `conf:"default:0"`
	ConnMaxLifetime int    `conf:"default:30"`
	ConnMaxIdleTime int    `conf:"default:5"`
}

func LoadConfig() (*Config, error) {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("load environment file: %w", err)
	}
	var cfg Config
	if _, err := conf.Parse("APP", &cfg); err != nil {
		return nil, fmt.Errorf("parse configuration: %w", err)
	}
	if cfg.Database.Port < 1 || cfg.Database.Port > 65535 || cfg.Database.MaxOpenConns < 1 || cfg.Database.MinConns < 0 || cfg.Database.MinConns > cfg.Database.MaxOpenConns || cfg.Database.ConnMaxLifetime < 1 || cfg.Database.ConnMaxIdleTime < 1 {
		return nil, fmt.Errorf("invalid database port or pool limits")
	}
	if len(cfg.Auth.Secret) < 32 {
		return nil, fmt.Errorf("APP_AUTH_SECRET must contain at least 32 bytes")
	}
	u, err := url.Parse(cfg.Recommendation.URL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("invalid APP_RECOMMENDATION_URL")
	}
	if cfg.Recommendation.Timeout <= 0 || cfg.Recommendation.Timeout >= time.Duration(cfg.Server.WriteTimeout)*time.Second {
		return nil, fmt.Errorf("recommendation timeout must be positive and shorter than HTTP write timeout")
	}
	return &cfg, nil
}
