# Inventario de componentes implementados para futuro C3

Inventario de código real, sin diagrama C4. Contenedor: backend Go/Chi.

| Componente | Ubicación | Depende de / responsabilidad |
|---|---|---|
| API composition root | cmd/api/main.go | config, logger, server, router; inicia worker de circulación y lo cancela al apagar |
| Primer administrador CLI | cmd/admin/main.go | config, database, user.Service; credenciales stdin, sin endpoint público |
| Config | internal/config | conf/v3, godotenv; PostgreSQL, HTTP y secreto JWT |
| Database | internal/database/database.go | pgxpool; conexión y pool UTC |
| Tern CLI | Dockerfile + migrations/*.sql | PostgreSQL schema_version; independiente del proceso HTTP |
| Router | internal/router | composition root de controllers/services/repos, Chi y middleware de roles |
| Authentication middleware | internal/middleware/auth.go | user.Service.Authenticate, contexto user.Identity |
| Authorization middleware | internal/middleware/auth.go | roles desde perfil actual de PostgreSQL |
| Global middleware | internal/middleware/global.go | servidor/logger; logging, recuperación, CORS |
| User Controller | internal/user/controller.go | User Service, validation, web; auth y administración |
| User Service | internal/user/service.go | Store interface, bcrypt, jwt/v5; registro/login/identidad/bootstrap |
| User Repository | internal/user/repository.go | implementa Store; users, roles, user_roles; bootstrap transaccional |
| Catalog Controller | internal/catalog/controller.go | Catalog Service, DTOs y paginación |
| Catalog Service | internal/catalog/service.go | Catalog Repository; validación bibliográfica |
| Catalog Repository | internal/catalog/repository.go | books/works/authors/genres y relaciones; reemplazo atómico de relaciones |
| Inventory Controller | internal/inventory/controller.go | Inventory Service; ejemplares por libro |
| Inventory Service | internal/inventory/service.go | Inventory Repository; consultas puras, sin dependencia ni llamadas hacia circulación |
| Inventory Repository | internal/inventory/repository.go | book_copies; consulta loans/reservations para disponibilidad, bloqueo del libro al editar |
| Circulation Controller | internal/circulation/controller.go | Circulation Service; préstamos, solicitudes, renovaciones y reservas |
| Circulation Service | internal/circulation/service.go | Circulation Repository, user.User; reglas de elegibilidad, decisiones, FIFO y workflow atómico |
| Circulation Repository | internal/circulation/repository.go | pgx.Tx; locks y SQL sobre books, users, book_copies, loan_requests, loans, loan_renewals, reservations |
| Personalization Controller | internal/personalization/controller.go | Personalization Service, validation, user.Identity, web; recursos del lector autenticado |
| Personalization Service | internal/personalization/service.go | Store interface; autorización propia, selección de géneros, ratings e interacciones locales |
| Personalization Repository | internal/personalization/repository.go | Implementa Store con pgxpool; user_genre_preferences, book_ratings, user_book_interactions; joins a books/genres y FK a users |
| Recommendation Controller | internal/recommendation/controller.go | Recommendation Service, user.Identity y web; límites 1–50 y endpoints del lector/similares |
| Recommendation Service | internal/recommendation/service.go | Interfaces Inference, Catalog, Personalization e Inventory; señales textuales y enriquecimiento exacto por Goodreads ID |
| FastAPI Client | internal/recommendation/client.go | Implementa Inference con net/http reutilizable, context y timeout; valida contrato V2/content_catalog |
| Catalog Goodreads lookup | internal/catalog/recommendation.go | Catalog Service/Repository; correspondencias por ANY de strings, sin título/ISBN |
| Inventory availability batch | internal/inventory/availability.go | Inventory Service/Repository; conteos en lote con la política de disponibilidad existente |
| Reservation worker | Circulation Service.Run | ticker cancelable, Service.Sweep; usa las mismas transacciones que HTTP |
| Validación | internal/validation | BindAndValidate, go-playground/validator; JSON estricto |
| Adaptadores HTTP | internal/web | escritura de errores de errs/sqlerr, JSON, IDs y paginación; no construye errores de dominio |
| Errores SQL/dominio | internal/sqlerr y internal/errs | traducción segura de PostgreSQL y HTTPError |
| Server | internal/server | http.Server, pool y cierre ordenado |
| Pagination | pkg/meta | Window/Parse de rangos SQL y Meta de totales; web solo adapta errores a HTTP |

Go depende de FastAPI solo desde Recommendation Client vía HTTP interno; los otros
módulos no requieren ese servicio para operar. No hay modelos cargados en Go, colas
ni servicio externo de autenticación. Inventory consulta el estado de circulación en
PostgreSQL con transacción READ ONLY/REPEATABLE READ; no almacena available ni
reconcilia durante GET. Circulation agrupa préstamos y reservas porque
comparten consistencia y transacciones; no hay dos servicios que se llamen mutuamente.

`internal/item` fue eliminado al confirmar que no tenía dependencias activas.
`pkg/meta` se reutiliza para toda la paginación; no es un módulo de negocio.

Pruebas: internal/user/service_test.go, internal/circulation/service_test.go y
internal/integration/backend_test.go, internal/integration/personalization_test.go y
internal/personalization/service_test.go; fixtures SQL en internal/database/tests.

Integración de recomendación: internal/recommendation/client_test.go,
internal/recommendation/service_test.go e internal/integration/recommendation_test.go.
El servicio no tiene repositorio propio ni persistencia nueva; reutiliza servicios
de catálogo, personalización e inventario sin dependencias circulares.

Las asignaciones de Circulation distinguen manual/system/unknown desde migración
008. El worker ya no depende de buscar usuarios del personal. Personalization no
depende del motor ML ni produce eventos duplicados de circulación o calificación.
