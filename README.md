# Biblioteca inteligente: datos, recomendación y persistencia

Proyecto académico de biblioteca inteligente con consolidación y EDA de Goodreads, recomendadores V2, API de inferencia y backend Go funcional sobre PostgreSQL.

## Estado actual

Implementado y validado:

- Consolidación reproducible de Goodreads JSONL a Parquet, con auditoría de duplicados, referencias, procedencia multigénero y calidad de datos.
- EDA de poesía y cómics/novela gráfica, incluyendo inventario, faltantes, distribuciones, solapamiento y dispersión usuario-libro.
- Particiones temporales V1 y V2 de ratings explícitos, sin modificar datos crudos ni tablas procesadas.
- Factorización matricial V2 ya entrenada: 688,730 usuarios, 566,739 libros con embedding y 32 factores latentes.
- Índice TF-IDF V2 ya construido para 931,048 libros usando título, descripción, autores, géneros temáticos e idioma.
- Recomendación colaborativa, por contenido, híbrida y para usuarios nuevos mediante `RecommendationEngine`.
- Fusión híbrida calibrada solo con validación de catálogo completo; el peso activo de contenido es `0.30`.
- Separación explícita entre el ranking híbrido del catálogo colaborativo y los libros `content_only` sin embedding colaborativo.
- Evaluación reproducible, pruebas automatizadas, benchmark de memoria/latencia y notebooks académicos V2.
- Backend Go con autenticación, roles, catálogo, inventario, circulación transaccional y personalización local; esquema versión 8 y pruebas con PostgreSQL real.
- Integración Go → FastAPI V2 por preferencias y similitud, con correspondencias Goodreads exactas y disponibilidad bibliotecaria local.

Pendiente antes de una integración de biblioteca:

- Evaluar una futura operación de puntuación de candidatos locales: no se simula filtrando el Top-K global. Goodreads no representa disponibilidad física.
- Completar almacenamiento/versionado externo de artefactos y endurecimiento de autenticación para despliegue público.
- Evaluar con reglas de negocio de la biblioteca, cold start real y un protocolo de producción independiente.
- Publicar checkpoints y matrices grandes fuera de Git, por ejemplo mediante Git LFS, DVC o almacenamiento de objetos.

## Entorno

Se requiere Anaconda o Miniconda. El entorno usa Python 3.11.

```bash
conda env create -f environment.yml
conda activate goodreads-eda
```

## Preparar datos

Los archivos JSONL de `data/raw/` son inmutables. Ejecute desde la raíz del proyecto:

```bash
python src/data/build_dataset.py --genres poetry comics_graphic
```

El script usa DuckDB para leer los JSONL fuera de memoria y genera Parquet en `data/processed/`. Los autores, géneros iniciales y obras globales se filtran a los identificadores presentes en el catálogo seleccionado.

Salidas principales:

- `books.parquet`, `authors.parquet`, `works.parquet`: entidades bibliográficas.
- `book_authors.parquet`, `book_genres.parquet`, `book_source_genres.parquet`: relaciones normalizadas.
- `interactions.parquet`: interacciones auditadas. El cero se mantiene en `rating`; `has_explicit_rating` y `explicit_rating` distinguen ausencia de calificación explícita.
- `interaction_source_genres.parquet`: procedencia de cada interacción.
- `duplicate_audit.parquet`: réplicas exactas agrupadas por `review_id`.
- `data/reports/quality_summary.csv` y `metadata_conflicts.csv`: auditoría agregada.

Solo se consolida una réplica exacta con el mismo `review_id`. Registros distintos para la misma pareja usuario-libro se conservan, porque su significado debe analizarse antes de cualquier filtrado. Los identificadores se preservan como texto.

## Ejecutar el EDA

Tras generar los Parquet:

```bash
jupyter lab
```

Abra y ejecute de principio a fin `notebooks/01_EDA_Goodreads.ipynb`. El notebook guarda figuras reproducibles en `data/reports/figures/`; sus resultados muestrales se identifican explícitamente. No publica identificadores de usuario.

## Pruebas

```bash
pytest -q
```

Las fixtures verifican JSONL, IDs de texto, libro compartido entre subconjuntos, roles de autor, valores vacíos, rating cero, duplicados exactos y referencias ausentes.

## Primer modelo colaborativo

Después de ejecutar la preparación de datos, genere las particiones temporales de ratings explícitos:

```bash
python src/ml/prepare_training.py --min-user-interactions 5 --min-item-interactions 5
```

El comando lee exclusivamente `data/processed/interactions.parquet` y genera en `data/ml/` los conjuntos `train`, `valid` y `test`, además de los mapeos consecutivos de usuarios y libros. Solo considera ratings 1--5; los ceros siguen preservados en las tablas procesadas pero no entran al modelo. La división reserva, por usuario, la observación más reciente por `date_added` para prueba y la anterior para validación. Como `date_added` significa incorporación y no lectura, es un protocolo temporal inicial con esta limitación explícita.

Abra y ejecute `notebooks/02_Entrenamiento_Colaborativo.ipynb` desde JupyterLab. Entrena una factorización matricial PyTorch con embeddings y sesgos de usuario/libro, MSE, Adam, validación por época y Early Stopping. El notebook crea `artifacts/collaborative_mf/` con el checkpoint, configuración, mapeos, historial, gráfica de pérdida y métricas.

La evaluación de ranking usa ratings de prueba mayores o iguales a cuatro como relevantes y candidatos formados por el ítem relevante más 1,000 ítems de entrenamiento no observados. Por tanto, Precision@K, Recall@K y NDCG@K son comparables entre el modelo y el baseline de popularidad bajo ese protocolo, pero no representan un ranking exhaustivo de todo el catálogo.

## Contenido e híbrido

Ejecute `notebooks/03_Recomendacion_Contenido.ipynb` y después `notebooks/04_Recomendacion_Hibrida.ipynb`. El primero construye y persiste TF-IDF disperso de títulos, descripciones, autores, géneros temáticos, origen e idioma. Los perfiles usan solo ratings de entrenamiento de al menos cuatro estrellas. El segundo normaliza por usuario las puntuaciones de contenido y colaborativo, selecciona los pesos exclusivamente con validación y conserva la prueba para la comparación final.

Los candidatos `evaluation_v2_*.parquet` garantizan que popularidad, colaborativo, contenido e híbrido se evalúen sobre los mismos usuarios, ítems relevantes, exclusiones e ítems no observados. El protocolo es muestreado, no un ranking exhaustivo sobre todo el catálogo. La poda iterativa usuario-ítem ocurre antes de la partición temporal: facilita embeddings entrenables pero excluye cola larga y conoce actividad futura al decidir elegibilidad; no sustituye una evaluación de cold start.

## Inferencia y validación final

`notebooks/05_Validacion_Final.ipynb` diagnostica las diferencias entre validación y prueba, calcula intervalos bootstrap por usuario y estudia candidatos ampliados y una muestra de catálogo completo sin cambiar pesos ni usar prueba para seleccionar modelos.

`src/ml/inference.py` contiene `RecommendationEngine`, la interfaz reutilizable para integración posterior. Carga los artefactos ya generados y ofrece `recommend_collaborative`, `recommend_similar`, `recommend_hybrid` y `recommend_new_user`. Los `book_id` se recuperan mediante la columna explícita `book_idx`, nunca por el orden físico de un Parquet.

```python
from pathlib import Path
from ml.inference import RecommendationEngine

engine = RecommendationEngine(Path('.'))
engine.recommend_hybrid('usuario_existente', k=10)
engine.recommend_similar('book_id_existente', k=10)
engine.recommend_new_user({'genres': ['poetry'], 'authors': ['Emily Dickinson']}, k=10)
```

## Experimentos V2 a escala completa

Los artefactos V2 preservan las salidas históricas y utilizan `data/processed_v2/` y `data/ml_v2/` exclusivamente como entradas. Para construir el índice de contenido disperso:

```bash
python src/ml/build_content.py --processed-dir data/processed_v2 --output-dir artifacts/v2/content_tfidf
```

La prueba previa de 10,000 libros se ejecuta con `--max-books 10000`. La ejecución completa indexó 931,048 libros, 80,000 términos y 136,073,254 pesos TF-IDF no nulos; no crea una matriz densa libro--libro. Los 103,564 libros sin descripción conservan señal desde título, autor, géneros temáticos e idioma. Las etiquetas de estantería de estado no son características de contenido.

Calibre y evalúe los modelos con:

```bash
python src/ml/evaluate_hybrid.py --ml-dir data/ml_v2 --collab-dir artifacts/v2/collaborative_mf --content-dir artifacts/v2/content_tfidf --output-dir artifacts/v2/hybrid --max-users 5000 --negatives 1000 --full-catalog-users 100
```

El script histórico seleccionó el peso sobre candidatos muestreados y después evaluó test; esos resultados se preservan en `artifacts/v2/hybrid/metrics.csv` y no se usan para decisiones posteriores. La calibración de inferencia actual se realiza solamente en validación sobre el catálogo colaborativo completo:

```bash
python src/ml/validate_full_catalog.py --users 100
```

La ejecución registrada seleccionó `content_weight=0.30` por NDCG@10. `validation_catalog_universes.csv` distingue el universo colaborativo de 566,739 libros (60.87% de cobertura) y el universo TF-IDF completo de 931,048 libros. El híbrido solo ordena el primer universo; `recommend_content_only` devuelve en un ranking separado los libros sin embedding, sin imputarles una puntuación colaborativa.

La inferencia V2 se carga explícitamente y no reentrena:

```python
engine = RecommendationEngine(Path('.'), version='v2')
engine.recommend_hybrid('usuario_existente', k=10)
engine.recommend_content_only('usuario_existente', k=10)
```

Los resultados híbridos llevan `score_scope='collaborative_catalog'`; los libros sin embedding llevan `score_scope='content_only_catalog'`, se ordenan solo por similitud de contenido y tienen `collaborative_score` nulo. Las dos listas no se mezclan porque sus scores responden a objetivos distintos.

## API REST V2

La API FastAPI mantiene una sola instancia de `RecommendationEngine` durante el lifespan del proceso. Carga los artefactos existentes V2 una vez al arrancar, sin entrenar modelos ni reconstruir TF-IDF. En CPU requiere aproximadamente 152 segundos y 3 GB de RAM; ejecute un único worker para no duplicar ese consumo.

```bash
conda activate goodreads-eda
PYTHONPATH=src python -m api.run
```

La documentación OpenAPI está disponible en `http://127.0.0.1:8000/docs`. Configuración por entorno:

- `RECOMMENDER_PROJECT_ROOT`: raíz del repositorio; por defecto se resuelve desde `src/api/config.py`.
- `RECOMMENDER_MODEL_VERSION`: versión del modelo, `v2` por defecto.
- `RECOMMENDER_DEVICE`: `cpu` por defecto; puede ser `cuda` si los artefactos y el entorno lo permiten.
- `RECOMMENDER_HOST` y `RECOMMENDER_PORT`: dirección local, por defecto `127.0.0.1:8000`.
- `RECOMMENDER_CORS_ORIGINS`: orígenes separados por comas; CORS queda desactivado si está vacío.

Endpoints bajo `/api/v1`:

- `GET /health/live`: el proceso HTTP responde, incluso si el motor no está listo.
- `GET /health/ready`: indica si los artefactos se cargaron correctamente.
- `POST /recommendations/preferences`: contenido para un usuario nuevo.
- `GET /recommendations/similar/{book_id}`: similitud TF-IDF.
- `GET /recommendations/hybrid/{goodreads_user_id}`: ranking híbrido del universo colaborativo.
- `GET /recommendations/content-only/{goodreads_user_id}`: ranking independiente para libros sin embedding.
- `GET /recommendations/collaborative/{goodreads_user_id}`: ranking colaborativo histórico.

`limit` es opcional y debe estar entre 1 y 50. Ejemplos:

```bash
curl http://127.0.0.1:8000/api/v1/health/ready
curl "http://127.0.0.1:8000/api/v1/recommendations/similar/6?limit=5"
curl "http://127.0.0.1:8000/api/v1/recommendations/hybrid/GOODREADS_USER_ID?limit=10"
curl -X POST http://127.0.0.1:8000/api/v1/recommendations/preferences \
  -H 'content-type: application/json' \
  -d '{"preferences":{"genres":["fantasy"],"authors":[],"keywords":["magic"]},"limit":10}'
```

Las respuestas contienen `book_id`, metadatos, `model`, `score` y, cuando corresponde, `score_scope`, `content_score` y `collaborative_score`. Los scores solo son comparables dentro del mismo método y `score_scope`; los identificadores son usuarios históricos de Goodreads, no futuros usuarios de PostgreSQL de la biblioteca.

## PostgreSQL y backend Go: primera etapa

La plantilla `alejandria-backend/` se reutiliza como monolito modular: PostgreSQL 17,
17 tablas de dominio y ocho migraciones Tern. La API Chi incluye autenticación,
roles, catálogo, ejemplares y circulación transaccional (solicitudes, entregas,
devoluciones, renovaciones y reservas FIFO), además de preferencias, ratings e
interacciones del lector. Las reservas tienen auditoría manual/system/unknown y
los GET no modifican circulación. No ejecuta migraciones al arrancar.

Contratos, bootstrap y pruebas: [`docs/backend/api.md`](docs/backend/api.md).
Inventario para futuro C3: [`docs/backend/componentes_c3.md`](docs/backend/componentes_c3.md).

El Compose también incluye FastAPI V2 CPU interno, un solo worker y artefactos
montados en solo lectura. Go no espera su arranque para atender los otros módulos.
Instrucciones: [`docs/docker-compose.md`](docs/docker-compose.md).
Contrato y resultados reales: [`docs/backend/recomendaciones.md`](docs/backend/recomendaciones.md).

Desde raíz, copiar `.env.example` a `.env` y reemplazar la contraseña local:

```bash
docker compose up -d --build
docker compose exec backend /app/tern migrate
curl --fail http://127.0.0.1:8080/health/ready
docker compose down  # conserva el volumen persistente
```

Reversión explícita: `docker compose exec backend /app/tern migrate --destination VERSION`.
`--destination 0` elimina el dominio; usar solo con una base desechable o respaldo adecuado.
La única semilla son lector, bibliotecario y administrador, sin usuarios ni contraseñas.

La documentación del esquema, estados, índices y reglas transaccionales pendientes
está en [`docs/database/modelo_relacional.md`](docs/database/modelo_relacional.md).
Configuración, ejecución Go directa y pruebas de reversión/persistencia:
[`alejandria-backend/README.md`](alejandria-backend/README.md).

## Organización de salidas

- `data/processed/`: nueve tablas Parquet consolidadas desde Goodreads; es la capa auditada y no se sobrescribe desde ML.
- `data/ml/`: derivados reproducibles para entrenamiento, como particiones, mapeos `user_idx`/`book_idx` y candidatos de evaluación. No sustituye ni altera `data/processed/`.
- `artifacts/collaborative_mf/`: checkpoint PyTorch, configuración, historial, mapeos y métricas del modelo colaborativo.
- `artifacts/content_tfidf/`: vectorizador, matriz TF-IDF dispersa, mapping de filas de contenido, candidatos puntuados y métricas.
- `artifacts/hybrid/`: pesos de combinación seleccionados en validación, puntuaciones y métricas híbridas.
- `artifacts/v2/content_tfidf/`: índice TF-IDF V2, mapping de filas y auditoría de tamaño/recursos.
- `artifacts/v2/hybrid/`: calibración V2, configuración congelada y métricas de validación/test.
- `src/data/`: ingesta y consolidación JSONL a Parquet.
- `src/ml/prepare_training.py`: genera las particiones explícitas temporales.
- `src/ml/collaborative.py`: arquitectura de factorización matricial y métricas de rating.
- `src/ml/content.py`: preparación textual y perfiles TF-IDF.
- `src/ml/build_content.py`: construcción reproducible del índice TF-IDF V2.
- `src/ml/evaluate_hybrid.py`: calibración y evaluación V2 sin fuga de test.
- `src/ml/recommendation.py`: candidatos, métricas de ranking, normalización y fusión.
- `src/ml/inference.py`: carga de artefactos e inferencia para usuarios, libros y cold start.
- `notebooks/01` a `05`: EDA, entrenamiento colaborativo, contenido, híbrido y validación final, respectivamente.

## Añadir un género

Agregue los archivos `goodreads_books_<genero>.json` y `goodreads_interactions_<genero>.json` en cualquier subcarpeta de `data/raw/`. Después ejecute, por ejemplo:

```bash
python src/data/build_dataset.py --genres poetry comics_graphic fantasy_paranormal
```

El notebook consulta `book_source_genres.parquet`, por lo que incorpora el nuevo subconjunto sin modificaciones estructurales.
