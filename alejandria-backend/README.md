# Alejandría — backend Go de biblioteca

Monolito modular con Chi, pgx/v5/pgxpool, conf/v3, godotenv, zerolog y SQL
explícito. Go 1.26+; la imagen compila con Go 1.26. Se reutiliza Tern v2 de la
plantilla mediante su CLI oficial, sin un ejecutable Go de migraciones propio.
`go.mod` y `go.sum` fijan dependencias de la API; el Dockerfile fija Tern v2.4.1.

## Ejecución local con Docker (desde raíz del repositorio)

1. Copiar `.env.example` a `.env` y sustituir contraseña de ejemplo y APP_AUTH_SECRET por valores locales propios.
2. Ejecutar:

```bash
docker compose up -d --build
docker compose exec backend /app/tern migrate
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/health/ready
docker compose logs backend
docker compose stop
docker compose start
docker compose down
```

`down` conserva `postgres_data`. `down -v` eliminaría datos: no usar para operación
normal. La contraseña del ejemplo es un marcador de desarrollo, no un secreto de
producción. Cambiar POSTGRES_PASSWORD después de inicializar el volumen no cambia
por sí solo la contraseña del rol ya existente.

PostgreSQL 17 y el backend se publican solo en loopback, puertos configurables
`POSTGRES_PORT` (5432) y `BACKEND_PORT` (8080). Entre contenedores el backend usa
`postgres:5432`, independientemente del puerto del host.

## Migraciones explícitas

```bash
docker compose exec backend /app/tern migrate
docker compose exec backend /app/tern migrate --destination 5
# Solo sobre base desechable: revierte todas las tablas del dominio
docker compose exec -e PGDATABASE=prueba_migraciones backend /app/tern migrate --destination 0
```

Tern registra versión, usa transacciones por migración y advisory locks. El arranque
de API no migra. Salud comprueba proceso/conexión, no versión del esquema: aplicar
migraciones hasta versión 8 antes de usar endpoints de negocio. Reversiones eliminan las tablas
de la versión y sus datos; nunca se ejecutan automáticamente.

## Ejecución Go fuera de Docker

Desde `alejandria-backend/`, con PostgreSQL levantado y variables `APP_DATABASE_USER`,
`APP_DATABASE_PASSWORD`, `APP_DATABASE_NAME`, `APP_AUTH_SECRET` definidas para la API, y `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` para Tern:

```bash
go install github.com/jackc/tern/v2@v2.4.1
tern migrate --migrations internal/database/migrations
go run ./cmd/api
go test ./...
go vet ./...
```

`godotenv` lee `.env` del directorio actual sin sobrescribir variables del proceso.
`conf` acepta variables con prefijo APP. Variables adicionales:

| Variable | Predeterminado |
|---|---|
| APP_PRIMARY_ENV | local |
| APP_AUTH_SECRET | obligatorio, al menos 32 bytes aleatorios |
| APP_SERVER_PORT | 8080 |
| APP_SERVER_READ_TIMEOUT / WRITE_TIMEOUT / IDLE_TIMEOUT | 10 / 15 / 60 segundos |
| APP_DATABASE_HOST / PORT | localhost / 5432 |
| APP_DATABASE_SSL_MODE | disable (solo entorno local) |
| APP_DATABASE_MAX_OPEN_CONNS / MIN_CONNS | 10 / 0 |
| APP_DATABASE_CONN_MAX_LIFETIME / CONN_MAX_IDLE_TIME | 30 / 5 minutos |

El `.env` de raíz contiene variables de Compose POSTGRES_*, no APP_* para ejecución
Go directa: exportar las variables anteriores o usar un `.env` local en el backend.
La CLI Tern lee variables `PG*` del proceso, no carga `.env` mediante godotenv.
En Compose ya están configuradas; `TERN_MIGRATIONS=/app/migrations` apunta a los SQL.

## Modelo y validación

Modelo completo: [modelo_relacional.md](../docs/database/modelo_relacional.md).
17 tablas: users, roles, user_roles, works, books, authors, book_authors, genres,
book_genres, book_copies, loan_requests, loans, loan_renewals, reservations,
user_genre_preferences, book_ratings, user_book_interactions.

Prueba reproducible desde raíz, con servicios levantados:

```bash
bash alejandria-backend/scripts/validate_database.sh
```

Crea una base desechable con nombre propio, aplica migraciones dos veces, ejecuta
fixtures SQL, verifica persistencia tras reiniciar servicios, revierte a cero,
reaplica y elimina solo esa base. Reinicia los servicios locales durante la prueba.
Para usar otro archivo de Compose env: `COMPOSE_ENV_FILE=.env.example bash ...`.

La API expone autenticación, usuarios/roles, catálogo, inventario, circulación
(solicitudes, préstamos, devoluciones, renovaciones y reservas FIFO) y personalización
propia (preferencias de géneros, calificaciones e interacciones).

- [Contratos HTTP, bootstrap del primer administrador, permisos y pruebas](../docs/backend/api.md).
- [Inventario real de componentes para futuro C3](../docs/backend/componentes_c3.md).

`internal/item/` fue eliminado por no tener dependencias activas. La integración
con FastAPI solo invoca preferencias y similares; no importa Goodreads. Migraciones 001–007 intactas; 008 añade
auditoría manual/system/unknown sin suplantar al personal. El worker local gestiona
expiración/asignación; los GET no escriben. La reversión de 008 se bloquea si hay
asignaciones sin usuario, incompatibles con el esquema antiguo: no se inventan actores.

Prueba específica de preservación histórica y reversión segura de 008:

```bash
bash alejandria-backend/scripts/validate_reservation_audit.sh
```

Personalización se expone bajo `/api/v1/users/me`: `/preferences/genres`, `/ratings`
y `/interactions`, siempre limitada al lector autenticado. PUT de preferencias
recibe `{ "genre_ids": [1,2] }`; PUT de rating recibe `{ "rating": 5 }`.
Consulta los contratos completos y ejemplos curl en `docs/backend/api.md`.

La iteración reutiliza `errs`/`sqlerr` y elimina `web.Error`. La paginación está
centralizada en `pkg/meta`, conservando contratos limit/offset existentes.

## Recomendaciones V2

Go ofrece `GET /api/v1/users/me/recommendations?limit=10` y
`GET /api/v1/books/{id}/similar?limit=10`. Ambos autenticados; la primera ruta
requiere lector/admin. Reutiliza preferencias y calificaciones locales, sin usar
el ID local como usuario histórico de Goodreads. Devuelve resultados externos y
locales diferenciados por `local_book_id`, `in_local_catalog` y disponibilidad.

Compose incluye PostgreSQL, Go y FastAPI CPU interno. Go arranca sin esperar al
motor; inferencia puede devolver 503 durante su carga o indisponibilidad.
`APP_RECOMMENDATION_URL` y `APP_RECOMMENDATION_TIMEOUT` configuran el cliente
(Compose: recommendations:8000 y 8s). No hay reentrenamiento, ranking local simulado
ni cambios de modelo. Para activar el puerto de depuración de Python, usar
`compose.dev.yaml` además del Compose principal.

- [Contrato, ejemplos reales y limitaciones](../docs/backend/recomendaciones.md).
- [Docker, artefactos necesarios y smoke reproducible](../docs/docker-compose.md).
