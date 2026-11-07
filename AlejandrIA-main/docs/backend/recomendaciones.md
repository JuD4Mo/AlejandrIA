# Integración Go → FastAPI V2

## Responsabilidades

Frontend → Go autenticado → FastAPI interno → RecommendationEngine V2.
Go consulta preferencias locales, enriquece por identidad bibliográfica exacta y
calcula disponibilidad operativa. Python solo realiza inferencia. No hay tablas,
migraciones, embeddings locales ni reentrenamiento nuevos.

## Endpoints Go

Ambos requieren Bearer JWT; limit por defecto 10, rango 1–50 (400 fuera de rango).

- `GET /api/v1/users/me/recommendations?limit=10`: lector/admin activo.
- `GET /api/v1/books/{id}/similar?limit=10`: cualquier usuario autenticado activo,
  siguiendo los permisos de consulta de catálogo. `id` siempre es el ID local.

El primero envía únicamente nombres de géneros, autores (actualmente arreglo vacío)
y keywords textuales a `POST /api/v1/recommendations/preferences`. Se leen las
preferencias propias (máximo 100) y las primeras 100 calificaciones ordenadas por
book_id; de estas se aprovechan hasta 20 títulos distintos con rating >=4 y
goodreads_book_id explícito. Son señales textuales, no embeddings ni emparejamiento
por título. No se envían ID local, email, JWT ni identificadores históricos de usuario.

Sin géneros ni señales positivas utilizables: 200, status `preferences_required`,
count 0 y mensaje para configurar intereses. FastAPI no se invoca en ese caso.
Si el contenido devuelve únicamente similitudes cero/nulas, se informa
`no_content_matches`, sin presentar empates como personalización.

Similares resuelve primero el libro PostgreSQL y usa exclusivamente su
goodreads_book_id en `GET /api/v1/recommendations/similar/{goodreads_book_id}`.
Libro local inexistente: 404. Sin correspondencia: 409. ID Goodreads ausente de
los artefactos: 404. No se busca por título ni ISBN como sustituto.

## Contrato de respuesta

Ejemplo real reducido del smoke, con una correspondencia creada solo en base
desechable (el ID local 1 no representa un registro importado a la base de trabajo):

```json
{
  "status": "ok",
  "source": "fastapi_v2",
  "recommendation_type": "content",
  "model_version": "v2",
  "count": 1,
  "recommendations": [{
    "goodreads_book_id": "20733501",
    "local_book_id": 1,
    "in_local_catalog": true,
    "local_title": "Local mirror: Drachenkrypta",
    "total_copies": 1,
    "available_copies": 1,
    "available": true,
    "title": "Drachenkrypta",
    "authors": ["J. T. Bernett"],
    "genres": ["fantasy, paranormal"],
    "score": 0.5764120221138,
    "model": "content_cold_start",
    "score_scope": "content_catalog",
    "content_score": null,
    "collaborative_score": null
  }]
}
```

La respuesta real de esa petición contenía diez resultados; el ejemplo muestra
solo uno y ajusta count para ilustrar un objeto autoconsistente.

| Caso | local_book_id | in_local_catalog | total/available_copies | available |
|---|---|---|---|---|
| Externo a PostgreSQL | null | false | null | null |
| Local sin ejemplares | ID local | true | 0 / 0 | false |
| Local ocupado/reservado/no circulante | ID local | true | conteos reales | false |
| Local con ejemplar elegible | ID local | true | conteos reales | true |

La búsqueda de correspondencias es por `books.goodreads_book_id = resultado.book_id`.
IDs Goodreads se conservan como strings, incluidos ceros iniciales; no son IDs locales.
Los campos title/authors/genres describen la salida de Goodreads. local_title es
independiente y no sobrescribe la identidad. availability de FastAPI representa
un universo de ranking, no disponibilidad física, y no se reutiliza para inventario.

Los conteos se consultan en lote mediante inventory, reutilizando el mismo criterio
que su listado: circulating, sin préstamo activo ni reserva ready persistida. Una
ready vencida sigue reteniendo conservadoramente el ejemplar hasta que se procese.
La disponibilidad es una instantánea, no una garantía de entrega. Solicitar préstamos
y reservas sigue requiriendo un ID local existente y validación transaccional.

## Ranking y límites

Se conserva orden, scores y universo de FastAPI. Estos endpoints solo admiten
`content_catalog`, con modelos `content_cold_start` o `content_similar`; nunca se
mezclan con scores híbridos/content-only. No se filtra un Top-K global para llamarlo
ranking local: pueden salir cero libros locales aun cuando PostgreSQL tenga libros.
FastAPI no ofrece puntuación de candidatos locales arbitrarios en su contrato actual.

Las preferencias no excluyen automáticamente libros ya calificados/leídos, porque
la operación de texto no recibe historial. No se interpreta rating local como factor
colaborativo. Los nombres locales de géneros se envían literalmente, sin traducir
ni inventar taxonomía; idioma y metadatos escasos pueden limitar las coincidencias.
La selección positiva está acotada y no es un perfil exhaustivo de todo el historial.

## Cliente y fallos

Una instancia HTTP reutilizable por router: contexto, timeout total, transport con
conexiones persistentes, sin redirecciones ni JWT hacia Python. Respuestas JSON
limitadas a 1 MiB, sin múltiples valores, con versión, modelo, count y scope validados.
Rechaza resultados duplicados y señales colaborativas inesperadas en contenido.
Los logs estructurados incluyen operación, estado remoto y duración, no preferencias.

- 503: red/servicio no disponible o motor no listo.
- 504: timeout remoto.
- 502: JSON, contrato o respuesta remota inesperados.
- 404: ID Goodreads inexistente al pedir similares.

Se reutilizan errs/sqlerr/web; no hay otro sistema de errores. No hay reintentos
automáticos, caché de resultados ni consultas de salud por cada petición. La caída
de FastAPI no bloquea login, préstamos o reservas ni cambia la salud de PostgreSQL.

## Pruebas y mediciones ejecutadas

- Unitarias con httptest: contrato, JSON inválido/grande, redirects, timeout,
  cancelación, indisponibilidad, versión/scope incorrectos, límites y perfil vacío.
- Integración con PostgreSQL test_* y FastAPI simulado: identidad propia, nombres
  de géneros, ratings positivos, matches exactos, externos, cero ejemplares,
  préstamos/holds, autorización y errores. La suite completa pasó con `-race`.
- Python: 20 pruebas existentes satisfactorias, sin cargar el modelo en cada test.
- Smoke real con tres servicios Compose, CPU, artefactos V2 en solo lectura.
  Instancia adicional Go con URL remota inaccesible: recomendaciones 503 y perfil 200.

Medición individual local, no prueba de carga:

| Medida | Resultado |
|---|---:|
| Arranque contenedor FastAPI hasta startup complete | 170.06 s |
| RSS del proceso tras smoke | 2,578,874,368 bytes (~2.40 GiB) |
| Máximo RSS observado del proceso | 3,938,893,824 bytes (~3.67 GiB) |
| Preferencias, primera petición HTTP Go | 0.8501 s |
| Preferencias, repetición enriquecida | 0.8461 s |
| Preferencias con rating positivo adicional | 0.8580 s |
| Similares HTTP Go | 0.8813 s |
| Lector sin preferencias | 0.0027 s |
| Servicio remoto inaccesible → Go 503 | 0.0032 s |

Los ejemplos adicionales fueron Dragonhunters (`35024542`, local sin ejemplares),
Angeions (`21189986`, externo) y Dragonhunters como similar con score 1.0. Esto
verifica transporte/contratos, no calidad ni superioridad estadística del ranking.

Reproducción del smoke: véase [Docker Compose](../docker-compose.md).
