# Importación del catálogo Goodreads a PostgreSQL

## 1. Alcance y resultado ejecutado

Importador explícito: `src/data/import_catalog.py`. Lee solo Parquet consolidados,
mediante DuckDB/PyArrow, y carga mediante psycopg 3 COPY y SQL explícito. No procesa
JSONL, no reconstruye el ETL original ni toca artefactos ML. No se ejecuta al arrancar
Docker, Go o FastAPI.

La carga completa se ejecutó sobre la base operativa `alejandria`, después de un
piloto y pruebas de fallo/reanudación en bases desechables. El esquema terminó en
versión **9**. Estado final de la carga:

| Tabla | Registros |
|---|---:|
| books | 931.046 |
| authors | 268.308 |
| works | 458.726 |
| genres | 10 |
| book_authors | 1.350.694 |
| book_genres | 2.917.475 |
| book_copies | 0 |
| users / loan_requests / loans / reservations | 0 |
| book_ratings / user_book_interactions | 0 |

Antes de importar, la base operativa estaba vacía excepto los tres roles y la
versión de esquema. La preservación de datos manuales se comprobó en el piloto y
las pruebas de integración; no se sembraron cuentas, ejemplares o préstamos en la
base operativa para validar la importación.

## 2. Archivos reales inspeccionados

Todos se encuentran en `data/processed_v2/`:

| Archivo | Filas de origen | Columnas utilizadas |
|---|---:|---|
| books.parquet | 931.048 | book_id, work_id, title, description, isbn, isbn13, language_code, publication_year, num_pages, image_url |
| authors.parquet | 268.309 | author_id, name |
| works.parquet | 468.761 | work_id, best_book_id, original_title |
| book_authors.parquet | 1.350.696 | book_id, author_id, role |
| book_genres.parquet | 2.917.477 | book_id, genre |
| book_source_genres.parquet | 1.000.078 | book_id, source_genre, solo muestreo y métricas |

IDs/textos son Arrow string; publication_year y num_pages son int32. El programa
verifica presencia y tipos de columnas, integridad de IDs y referencias antes de
cargar. Calcula SHA-256 de los seis archivos para identificar el origen del checkpoint.
Nunca lee interactions.parquet ni importa reviews o usuarios Goodreads.

Procedencias reales: comics_graphic 89.411; fantasy_paranormal 258.585;
history_biography 302.935; mystery_thriller_crime 219.235; poetry 36.514;
young_adult 93.398. Las sumas se solapan porque un libro puede aparecer en varias fuentes.

**Seis fuentes no significan seis etiquetas temáticas.** book_genres contiene diez
etiquetas: children; comics, graphic; fantasy, paranormal; fiction; history,
historical fiction, biography; mystery, thriller, crime; non-fiction; poetry;
romance; young-adult. Se conservan como etiquetas completas; no se divide una cadena
con comas para inventar una taxonomía más fina. La procedencia no se convierte en
otro conjunto de géneros redundante.

## 3. Correspondencia y transformaciones

| Origen | Destino | Tratamiento |
|---|---|---|
| books.book_id | books.goodreads_book_id | TEXT exacto; nunca se convierte a número |
| books.title | books.title | Texto existente, espacios externos recortados; sin título se omite el libro |
| books.description | books.description | Ausencia/blanco → NULL |
| books.isbn / isbn13 | books.isbn / isbn13 | Texto, sin perder ceros; no se afirma validez de checksum |
| books.language_code | books.language_code | Código de origen o NULL; sin traducir/inferir idioma |
| books.publication_year | books.publication_year | Entero 1–9999; cero/fuera de ese rango → NULL, sin inventar año |
| books.num_pages | books.num_pages | Positivo o NULL; no se descartan valores altos solo por ser atípicos |
| books.image_url | books.image_url | URL informada, incluso placeholders de origen; no se genera portada |
| books.work_id | books.work_id | Resuelve solo por works.goodreads_work_id exacto |
| authors.author_id / name | authors.goodreads_author_id / name | ID externo exacto y nombre informado; nunca se fusiona por nombre |
| works.work_id | works.goodreads_work_id | ID exacto; nunca se fusiona por título |
| works.original_title | works.title | Primera opción de título de la obra |
| works.best_book_id | works.title, como alternativa | Solo usa el título de ese libro si existe y su work_id coincide explícitamente |
| book_authors | book_authors | Resuelve IDs externos a PK locales, conserva role informado |
| role ausente/blanco | book_authors.role | `unspecified`: expresa desconocimiento, no afirma author/translator |
| book_genres.genre | genres.name / book_genres | Recorta y normaliza minúsculas; reutiliza coincidencia exacta case-insensitive de nombre |

Se eliminan caracteres NUL de textos porque PostgreSQL TEXT no los admite. Los IDs
externos no canónicos/vacíos o duplicados detienen la prevalidación; no se inventa
una clave ni se resuelve una colisión de identidad arbitrariamente.

## 4. Omisiones y límites de metadatos observados

- Dos libros sin title ni title_without_series: IDs **29522179** y **7807037**.
  No se reemplazó el título de una edición por el de una obra sin evidencia.
- Se omitieron las dos relaciones de autor y dos de género asociadas a esos libros.
- Un autor no quedó asociado a los libros elegibles: 268.308 importados de
  268.309 disponibles; no faltaban nombres en los autores elegibles.
- 10.035 obras del archivo global no tenían título original ni edición principal
  utilizable. Dos correspondían únicamente a los libros omitidos; 10.033 son obras
  sin título recuperable dentro del conjunto bibliográfico elegible.
- 12.142 libros importados quedaron sin work_id. Se conservaron esos libros; no se
  creó una obra titulada artificialmente. Una obra exacta ya existente localmente
  sí puede resolver el vínculo aunque su metadato fuente no permita crearla.
- 103.563 libros elegibles carecían de descripción.
- 4.011 valores de páginas no positivos y 38 años fuera de 1–9999 se convirtieron a NULL.
- 1.053.974 participaciones sin role utilizable se identificaron como unspecified.
- Cero referencias huérfanas de autor/obra en las fuentes elegibles; cero IDs Goodreads
  duplicados y cero relaciones huérfanas en la verificación final de PostgreSQL.

No se importan publisher, format, url de Goodreads, rating agregado, reseñas,
fechas parciales ni contadores que el esquema bibliográfico no representa y esta
iteración no necesita. Permanecen en los Parquet originales, sin modificarlos.

## 5. Carga, preservación e idempotencia

Orden: géneros → obras → autores → libros → libro/autor → libro/género.

1. DuckDB valida/proyecta las fuentes y ordena claves de forma determinista, con
   memoria limitada y spill en un directorio temporal propio.
2. Por cada lote (5.000 por defecto), crea una tabla TEMPORARY ON COMMIT DROP y
   transmite filas mediante COPY FROM STDIN.
3. Una única transacción PostgreSQL incorpora el lote y sus correspondencias.
4. Después del commit, guarda un checkpoint JSON atómico con fsync.

No se borra, recrea ni vacía ninguna tabla del catálogo. Las tablas temporales no
constituyen otro catálogo y desaparecen al confirmar/revertir la transacción.

Política de conflictos:
- Obras/autores: ID Goodreads único, ON CONFLICT DO NOTHING. Se conservan títulos
  y nombres ya curados localmente, aunque difieran del origen.
- Libros: ID Goodreads único; conserva título, ID interno y todo metadato no nulo.
  Solo completa campos NULL con datos fuente disponibles, incluido work_id.
- Géneros: índice único lower(btrim(name)); reutiliza su ID y respeta la grafía local.
- Relaciones: DISTINCT más ON CONFLICT DO NOTHING; añade las que falten y no elimina
  relaciones manuales.
- Registros manuales sin identificador externo permanecen independientes, aunque
  compartan título/nombre/ISBN. No se unen por semejanza.

Esto **no es una sincronización destructiva**: no sobrescribe correcciones locales,
no elimina libros ausentes de una nueva fuente y no retira relaciones existentes.
Si se necesita otra política de actualización, debe diseñarse explícitamente.

## 6. Checkpoints y recuperación

El checkpoint incluye base/OID/host/puerto, hashes de archivos, tamaño de lote,
selección y versión de transformación. Se rechaza si corresponde a otra ejecución.
No contiene contraseña. Un advisory lock impide dos importadores simultáneos en
la misma base; se libera al cerrar la conexión.

Si falla COPY o el merge, el lote se revierte y el último checkpoint confirmado
permite reanudar. Si PostgreSQL confirmó pero el proceso cayó antes de guardar
el checkpoint, se revisita ese lote con UPSERT seguro. Puede haber huecos en las
secuencias de IDs internos, lo cual no representa duplicación de registros.

Reanudar con los mismos archivos, lote, muestra y entorno. `--restart` revisita
todas las fases de forma idempotente; no borra tablas. Es también lo adecuado
para volver a comprobar datos después de cambios externos al proceso. El checkpoint
no es una auditoría permanente de todo lo que un administrador haga posteriormente.

SIGKILL puede dejar spill temporal bajo data/duckdb_tmp_import/catalog_*; eliminar
solo directorios de ejecuciones ya detenidas. Las tablas TEMP se cierran con la
sesión PostgreSQL. No se importan ni se manipulan particiones de ML.

## 7. Preparación y comandos explícitos

Actualizar el entorno Conda según environment.yml; psycopg >=3.2 es dependencia del ETL.
No hace falta instalarlo en el contenedor Go ni cambiar la imagen FastAPI.

```bash
conda env update -n goodreads-eda -f environment.yml
conda activate goodreads-eda
docker compose up -d --build backend
docker compose exec backend /app/tern migrate
```

Configurar conexión desde el host usando las credenciales locales propias:

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=alejandria
read -rs -p 'Contraseña PostgreSQL: ' PGPASSWORD
export PGPASSWORD
```

Alternativa: CATALOG_DATABASE_URL. Evitar --dsn con contraseña en argumentos o
guardar credenciales en scripts versionados. El ETL no carga automáticamente .env.

### Piloto desechable

```bash
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" test_catalog_import'
docker compose exec -e PGDATABASE=test_catalog_import backend /app/tern migrate
export PGDATABASE=test_catalog_import
python src/data/import_catalog.py --max-books 12000 --batch-size 5000 \
  --state-file data/reports_import/pilot_state.json \
  --report data/reports_import/pilot_complete.json
# Comprueba repetición real de todas las fases, no solo omisión por checkpoint:
python src/data/import_catalog.py --max-books 12000 --batch-size 5000 --restart \
  --state-file data/reports_import/pilot_state.json \
  --report data/reports_import/pilot_repeat.json
```

La muestra es determinista, balanceada por las seis fuentes y contiene los casos
sin título para comprobar omisiones. Por solapamiento, los conteos de procedencia
pueden sumar más que la cantidad seleccionada.

Para probar pausa controlada añadir --stop-after-batches 2. Para pruebas Python
de fallo y preservación utilizar otra base **test_*** vacía, migrada a 9:

```bash
CATALOG_TEST_DATABASE_URL='postgres://USUARIO:CLAVE@localhost:5432/test_catalog_etl' \
  python -m pytest tests/test_import_catalog.py -q
```

### Completa / reanudación

```bash
export PGDATABASE=alejandria
python src/data/import_catalog.py --batch-size 5000 \
  --state-file data/reports_import/full_state.json \
  --report data/reports_import/full_complete.json
# Reanudar sin sobrescribir las métricas de la ejecución inicial:
python src/data/import_catalog.py --batch-size 5000 \
  --state-file data/reports_import/full_state.json \
  --report data/reports_import/full_resume.json
```

La importación completa anterior **ya fue ejecutada**. Repetirla sin --restart
omite fases confirmadas; con --restart se vuelven a visitar registros y relaciones.
Si se cambia la selección/base/archivos, elegir otro checkpoint.

Verificación exclusivamente de lectura, incluida una llamada a FastAPI real:

```bash
python src/data/verify_catalog_import.py --compose-env .env \
  --report data/reports_import/full_verification.json
```

Los informes y checkpoints se guardan en data/reports_import/ (salidas locales
ignoradas por Git). La validación local usó .env.example para Docker y variables
PG* de desarrollo, no credenciales de producción incorporadas al código.

## 8. Catálogo y circulación después de importar

Migración **009_catalog_search.sql**:
- pg_trgm e índice GIN(title gin_trgm_ops) para ILIKE parcial, que el B-tree de
  lower(title) no cubría.
- Índices compuestos book_authors(author_id,book_id) y book_genres(genre_id,book_id).
- Down elimina estos tres índices; conserva la extensión por si otros objetos la usan.
  No se modifican 001–008 ni se crean tablas permanentes nuevas.

GET /api/v1/books conserva limit/offset y añade:
- `has_copies=true|false`: existencia de ejemplares físicos registrados.
- `available=true|false`: existencia de ejemplares elegibles para circulación.
- `after_id=<id>`: cursor de ID interno, incompatible con offset distinto de cero.
- `next_after_id`: cursor opcional de continuación; la siguiente página puede estar vacía.

Los libros de lista/detalle incorporan total_copies, available_copies, has_copies,
has_available_copies, loaned_copies, reserved_copies y non_circulating_copies, todos
derivados. Se distingue ocupación temporal de mantenimiento/baja. No se almacena available. Se pagina antes
de construir relaciones y conteos; los filtros activos usan SQL parametrizado sin
OR genéricos. Los GET siguen sin producir efectos secundarios.

Request y Reserve comprueban existencia de book_copies dentro del bloqueo libro →
lector. Se devuelve 409 sin registrar solicitud/reserva si no hay ningún ejemplar.
Que todos estén prestados no equivale a ausencia: se permite reservar y esperar FIFO.
Entrega/recogida sigue comprobando condición, ocupación y reserva del ejemplar concreto.
La cuenta de existencia incluye registros lost/withdrawn: no se añadió otra política
de bajas o de promesa de entrega para libros que sí tuvieron inventario.

Se preservan límite de dos préstamos, 30 días, una renovación y 72h de recogida.
El worker parte de reservas accionables en lugar de recorrer todo el catálogo.
Calificaciones, interacciones y recomendaciones siguen disponibles para libros sin copias.

## 9. Evidencia y recursos

- Piloto: 12.000 seleccionados, 11.998 válidos; pausa y reanudación, además de
  repetición --restart sin nuevas filas ni modificaciones. Aproximadamente 9,14 s
  por pasada final; RSS máximo observado 1,26 GiB. Los dos tramos de la primera
  ejecución se midieron por separado (6,63 s hasta la pausa y 9,14 s al reanudar).
- Fixture de preservación: título/descripcion/obra curados, libro manual sin ID,
  autor/relación manual, género existente y ejemplar previo conservados.
- Fallo inducido en INSERT de libros comprobó rollback del lote; reanudación posterior correcta.
- Go: pruebas de filtros/cursor, bloqueo sin ejemplares y alta de inventario concurrente
  con reserva, además de la suite anterior con -race; go vet satisfactorio.
- Smoke HTTP del contenedor Go sobre el piloto: catálogo, filtros físicos y cursor
  respondieron 200; cursor combinado con offset respondió 400; solicitud/reserva
  sin copias respondió 409 sin crear registros. Similares reales vía Go/FastAPI: 200,
  cinco resultados, ~973 ms. Las consultas HTTP de catálogo medidas en ese piloto
  estuvieron entre ~2 y ~10 ms; no son las mediciones SQL del catálogo completo.
- Reversión de 009 a 8 y reaplicación a 9 en base desechable conservó cuatro libros
  y un ejemplar de la fixture; la base operativa no se revirtió.
- Python: suite normal 22 passed y 1 integración omitida por ausencia de DSN;
  ejecución explícita del archivo con PostgreSQL: 3 passed (incluida esa integración).
- Carga completa: **164,74 s**, lotes de 5.000, DuckDB limitado a 2GB (no al RSS
  total del proceso), RSS máximo **2.611.605.504 bytes ≈2,43 GiB**.
- Reanudación ya completada: 7,53 s, cero lotes nuevos y cero cambios.
- Base al verificar: **1.819.137.715 bytes ≈1,69 GiB**; el tamaño puede variar con WAL,
  mantenimiento e inserciones posteriores.
- Diez recomendaciones FastAPI reales de fantasía: **10/10 correspondencias locales**,
  incluidos Drachenkrypta, Angeions y Dragonhunters; ningún ejemplar artificial.
  Se mantiene el manejo de resultados externos para IDs ausentes, como los omitidos.

Mediciones SQL individuales con 931.046 libros (no prueba de carga ni latencia HTTP):

| Consulta | Ejecución servidor | Mediana de tres roundtrips |
|---|---:|---:|
| Primera página de 20 | 0,026 ms | 0,211 ms |
| Título Harry Potter | 4,735 ms | 5,054 ms |
| Offset 900.000 | 321,070 ms | 276,752 ms |
| Cursor id > 900.000 | 0,046 ms | 0,160 ms |
| Filtro de autor medido | 4,311 ms | 2,462 ms |
| Filtro de género medido | 0,058 ms | 0,309 ms |
| Solo libros físicos (ninguno aún) | 0,021 ms | 0,226 ms |

La búsqueda usó books_title_trgm_idx; frases muy cortas pueden no beneficiarse del
trigram. Mantener offset por compatibilidad no lo vuelve eficiente a gran profundidad:
usar cursor para recorridos extensos. Estas cifras dependen de caché, equipo y término.
