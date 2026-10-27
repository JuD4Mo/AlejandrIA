// Crea solo el primer administrador mediante JSON por stdin; sin credenciales por defecto.
package main

import (
	"context"
	"encoding/json"
	"github.com/JuD4Mo/alejandria-backend/internal/config"
	"github.com/JuD4Mo/alejandria-backend/internal/database"
	"github.com/JuD4Mo/alejandria-backend/internal/user"
	"github.com/go-playground/validator/v10"
	"log"
	"os"
	"time"
)

func main() {
	cfg, e := config.LoadConfig()
	if e != nil {
		log.Fatal(e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, e := database.NewDB(ctx, cfg)
	if e != nil {
		log.Fatal("database connection failed")
	}
	defer db.Close()
	var p user.Register
	d := json.NewDecoder(os.Stdin)
	d.DisallowUnknownFields()
	if e = d.Decode(&p); e != nil {
		log.Fatal("expected registration JSON on stdin")
	}
	if e = p.Validate(); e != nil {
		log.Fatal("invalid administrator input")
	}
	if e = validator.New().Struct(p); e != nil {
		log.Fatal("invalid administrator input")
	}
	_, e = user.NewService(user.NewRepository(db.Pool), cfg.Auth.Secret).Bootstrap(ctx, p)
	if e != nil {
		log.Fatal("bootstrap failed (administrator may already exist)")
	}
	log.Print("first administrator created")
}
