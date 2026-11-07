# Docker Compose — PostgreSQL, Go y FastAPI V2

## Inicio

Desde raíz, copiar `.env.example` a `.env` y definir credenciales y secreto JWT locales.
Los artefactos existentes deben estar presentes antes de iniciar recomendaciones.

```bash
docker compose up -d --build
docker compose exec backend /app/tern migrate
docker compose ps
curl --fail http://127.0.0.1:8080/health/ready
```

Servicios:
- postgres: PostgreSQL 17 y volumen persistente; loopback 5432 configurable.
- backend: Go/Chi; loopback 8080 configurable; solo depende de PostgreSQL saludable.
- recommendations: FastAPI CPU interno en puerto 8000, sin publicación al host.

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

Unitarias Go y Python sin modelos reales:

```bash
# Desde alejandria-backend
go test ./...
go vet ./...
# Desde raíz, con el entorno Conda activo
python -m pytest -q
```

Integración en una base test_* desechable migrada a 8:

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
