# Docker Compose — frontend, Go, PostgreSQL y FastAPI V2

## Inicio

Desde raíz, copiar `.env.example` a `.env` si aún no existe y configurar credenciales
y secreto JWT locales. Con un volumen existente, conservar sus credenciales vigentes:
editar POSTGRES_PASSWORD no cambia por sí solo la contraseña del rol en PostgreSQL.
Los artefactos V2 existentes deben estar presentes antes de iniciar recomendaciones.
No se necesita Node, Go ni Conda instalados en el host para levantar los servicios.

### Instalación existente (esquema ya migrado)

```bash
docker compose up -d --build --wait --wait-timeout 600
docker compose ps
# Abrir http://127.0.0.1:3000
```

La base de este proyecto ya está en versión 12 y conserva el catálogo importado.
`--wait` espera que los cuatro servicios estén saludables; la primera compilación
descarga dependencias y el motor puede necesitar unos tres minutos adicionales.
La interfaz puede estar accesible antes de que termine de cargar FastAPI.

### Primera instalación con volumen vacío

Las migraciones siguen siendo explícitas. Antes de utilizar la API y la interfaz:

```bash
docker compose build backend
docker compose up -d --wait postgres
docker compose run --rm --no-deps --entrypoint /app/tern backend migrate
docker compose up -d --build --wait --wait-timeout 600
```

Tern usa el entorno PG* de backend y solo aplica migraciones cuando se ejecuta ese
comando. El Compose no importa Goodreads ni crea usuarios/ejemplares automáticamente.
Un volumen nuevo tiene tablas vacías después de migrar; la importación se realiza
con el [ETL explícito](database/importacion_goodreads.md). Para crear el primer
administrador se conserva el procedimiento `/app/admin` por stdin, documentado en
[la API](backend/api.md).

Servicios:
- frontend: React compilado servido por Nginx; loopback 3000 configurable con FRONTEND_PORT.
- postgres: PostgreSQL 17 y volumen persistente; loopback 5432 configurable.
- backend: Go/Chi; loopback 8080 configurable; solo depende de PostgreSQL saludable.
- recommendations: FastAPI CPU interno en puerto 8000, sin publicación al host.

El navegador usa el mismo origen para interfaz y `/api/v1`. Nginx reenvía `/api/`
a `backend:8080` conservando ruta, query, JSON, Authorization y estados de error.
Go se comunica con `postgres:5432` y `recommendations:8000` por la red Docker.
No hay llamadas del navegador a los nombres internos ni es necesario cambiar CORS
para este despliegue de mismo origen.

Las rutas SPA (`/login`, `/catalog`, `/books/123`, etc.) sirven index.html al recargar.
Los assets inexistentes devuelven 404 y los errores API no se sustituyen por HTML.
Nginx re-resuelve el servicio Go para recuperarse de recreaciones del contenedor.

Healthchecks y dependencias:

| Servicio | Sonda | Dependencia de arranque |
|---|---|---|
| postgres | pg_isready | Ninguna |
| backend | GET /health/ready mediante curl | postgres saludable |
| frontend | GET /healthz mediante wget | backend saludable |
| recommendations | GET /api/v1/health/ready y JSON ready=true | Ninguna |

Salud Go comprueba conexión DB, no la versión de migraciones ni FastAPI. Salud
frontend comprueba el servidor estático, no garantiza que todos los endpoints de
negocio estén disponibles. Por ello se conserva el paso explícito de migraciones.

Go no espera a que termine de cargar el motor. Durante su inicialización (medida:
170 s) las rutas de recomendaciones pueden responder 503; el resto continúa activo.
El proceso FastAPI usa lifespan para cargar una sola instancia; un worker, concurrencia
HTTP limitada a cuatro y memoria máxima predeterminada 8 GiB. Estos límites no son
una promesa de capacidad; deben medirse antes de un despliegue con carga real.

Healthcheck usa `/api/v1/health/ready` y verifica JSON ready=true, no solo HTTP 200;
periodo inicial 300 s. Uvicorn empieza a escuchar tras completar lifespan, por lo que
las sondas pueden no conectar aún durante el arranque. `/api/v1/health/live` y ready
se conservan como endpoints independientes del servicio Python.

```bash
docker compose exec recommendations python -c \
  "import json,urllib.request; print(json.load(urllib.request.urlopen('http://localhost:8000/api/v1/health/ready')))"
docker compose logs recommendations backend
```

Depuración de FastAPI desde host, solo cuando se necesite:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d
curl http://127.0.0.1:8000/api/v1/health/ready
# /docs queda accesible en ese puerto durante depuración
```

## Configuración Go

`APP_RECOMMENDATION_URL`: http://recommendations:8000 en Compose; configurable en
ejecución Go directa mediante conf/v3. `APP_RECOMMENDATION_TIMEOUT`: 8s por defecto;
debe ser positivo y menor al WriteTimeout del servidor (15s por defecto).
`RECOMMENDER_MEMORY_LIMIT`: 8g por defecto. `RECOMMENDER_PORT`: solo override dev.
No usar localhost para contactar otro contenedor: representa el mismo contenedor.

`FRONTEND_PORT`: 3000 por defecto. El contenedor escucha en 8080, independientemente
del puerto del host. `POSTGRES_PORT` y `BACKEND_PORT` también son puertos del host;
no cambian los destinos internos del proxy ni del pool. `compose.dev.yaml` únicamente
publica FastAPI para depuración; no activa HMR del frontend.

## Imagen frontend

`alejandria-frontend/Dockerfile` compila con Node 24 y npm ci desde package-lock.json.
La imagen final Nginx 1.28 solo contiene dist y la configuración del proxy; no incluye
Node, node_modules, .env, borradores files/ ni files.zip. El contexto independiente
y `.dockerignore` evitan enviar dependencias locales o datasets a esa compilación.

Es un build de producción. Para incorporar cambios del frontend:

```bash
docker compose up -d --build frontend
```

Para desarrollo con HMR se mantiene `npm run dev` fuera de este Compose, tal como
indica el README del frontend. El origen de Vite :5173 y el de Compose :3000 tienen
sessionStorage independientes; al cambiar de origen puede ser necesario iniciar sesión.

## Imagen y archivos montados

`docker/recommendations.Dockerfile` instala Python 3.11 y PyTorch CPU 2.14.1.
`docker/requirements-recommendations.txt` fija versiones compatibles de sklearn,
joblib, SciPy, pandas, NumPy y PyArrow para reutilizar la serialización existente.
La imagen solo contiene código de API/inferencia y dependencias; ningún dataset.

Trece mounts bind de solo lectura, que fallan si el archivo fuente no existe:

- Collaborative V2: config.json, best_model.pt, user_mapping.parquet, book_mapping.parquet.
- Contenido V2: tfidf_vectorizer.joblib, book_tfidf.npz, content_book_mapping.parquet.
- Híbrido V2: config.json, sin alterarlo.
- processed_v2: books.parquet, authors.parquet, book_authors.parquet, book_genres.parquet.
- ml_v2: train.parquet, requerido de forma diferida por rutas históricas de Python;
  el flujo local Go no lo consulta ni envía IDs locales a esas rutas.

Se excluyen JSONL raw, interacciones procesadas completas, valid/test, works,
reports, checkpoints V1 y artefactos de entrenamiento no necesarios. No se reconstruye
TF-IDF ni se entrena. Los libros PostgreSQL no se rellenan desde estos mounts.

## Pruebas

Validación de orquestación ejecutada:
- `docker compose config --quiet`, principal y override de depuración válidos.
- Build de las tres imágenes y `up --build --wait`: cuatro servicios saludables.
- `nginx -t` satisfactorio; HTML de inicio y deep links, JS/CSS y caché de assets correctos.
- Proxy comprobado con registro, login, Bearer JWT, query strings y errores 400/401/404.
- Proyecto aislado desde volumen vacío: migración explícita a 9 y arranque sin otro
  modelo ML. Inferencia ausente devolvió error controlado 504 (puede ser 503 si falla
  conexión antes del timeout); perfil y catálogo siguieron funcionando.
- Recreación de Go sin reiniciar frontend: proxy y JWT recuperaron acceso correcto.
- 35 pruebas frontend y lint satisfactorios. Chrome no está instalado en el entorno
  de automatización; no se declara una prueba visual de navegador.

Smoke reproducible con fixtures solo en proyecto y volumen desechables:

```bash
POSTGRES_DB=test_orchestration POSTGRES_PORT=55432 BACKEND_PORT=18080 FRONTEND_PORT=13000 \
  docker compose -p alejandria-orchestration-check up -d --build --wait postgres backend frontend
docker compose -p alejandria-orchestration-check exec backend /app/tern migrate
python3 alejandria-frontend/docker/smoke.py --project alejandria-orchestration-check --recreate-backend
# Solo elimina los recursos de prueba que se acaban de crear:
docker compose -p alejandria-orchestration-check down --volumes
```

El script obtiene puertos/configuración de los contenedores inspeccionados, rechaza
el proyecto operativo y bases sin test_*, y no imprime credenciales. En las pruebas
locales se añadió `--env-file .env.example` a los comandos y `--env-file .env.example`
al script; el uso habitual es .env propio. No usar down --volumes contra la instancia
operativa para simular un arranque limpio.

Unitarias Go y Python sin modelos reales:

```bash
# Desde alejandria-backend
go test ./...
go vet ./...
# Desde raíz, con el entorno Conda activo
python -m pytest -q
```

Integración en una base test_* desechable migrada a 9:

```bash
docker compose exec postgres createdb -U alejandria test_recommendation
docker compose exec -e PGDATABASE=test_recommendation backend /app/tern migrate
# Desde alejandria-backend: URL con credenciales locales y base desechable
TEST_DATABASE_URL='postgres://USUARIO:CLAVE@127.0.0.1:5432/test_recommendation?sslmode=disable' \
  go test -tags=integration -race -count=1 ./...
docker compose exec postgres dropdb -U alejandria test_recommendation
```

Smoke Go → FastAPI real, esperar recommendations healthy antes:

```bash
docker compose exec postgres createdb -U alejandria test_recommendation_http
docker compose exec -e PGDATABASE=test_recommendation_http backend /app/tern migrate
docker compose run -d --no-deps --name alejandria-recommendation-smoke \
  -p 127.0.0.1:18080:8080 -e APP_DATABASE_NAME=test_recommendation_http \
  -e PGDATABASE=test_recommendation_http backend
python3 alejandria-backend/scripts/recommendation_smoke.py
docker rm -f alejandria-recommendation-smoke
docker compose exec postgres dropdb -U alejandria test_recommendation_http
```

Sustituir el usuario PostgreSQL si es diferente. El script comprueba prefijo test_*,
genera credenciales efímeras y publica métricas y ejemplos sin tokens. Crea otra
instancia Go temporal en 18081 para comprobar fallo de inferencia; la elimina al salir.
`COMPOSE_ENV_FILE` permite elegir un archivo de entorno distinto (se usó .env.example
exclusivamente para las comprobaciones locales). La base operativa no recibe fixtures.

```bash
docker compose stop
docker compose start
docker compose down  # conserva volumen PostgreSQL; no usar -v para datos de trabajo
```
