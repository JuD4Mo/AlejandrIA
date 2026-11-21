package config

import (
	"strings"
	"testing"
)

func TestFoldInFeatureFlagCanBeEnabledAndDisabled(t *testing.T) {
	t.Setenv("APP_AUTH_SECRET", strings.Repeat("s", 32))
	t.Setenv("APP_DATABASE_USER", "synthetic")
	t.Setenv("APP_DATABASE_PASSWORD", "synthetic")
	t.Setenv("APP_DATABASE_NAME", "test_config")
	for _, value := range []string{"true", "false"} {
		t.Setenv("APP_RECOMMENDATION_FOLD_IN_ENABLED", value)
		cfg, err := LoadConfig()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Recommendation.FoldInEnabled != (value == "true") {
			t.Fatalf("feature flag %s ignored", value)
		}
	}
}
