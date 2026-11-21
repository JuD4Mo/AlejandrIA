# Renovación de recomendaciones personales

## Comportamiento

El modelo de contenido sigue siendo TF-IDF V2. La renovación modifica la selección
de candidatos, no los pesos aprendidos ni las puntuaciones. Las exclusiones se
aplican **antes** del Top-K sobre el catálogo completo y solo se devuelven
coincidencias con puntuación positiva y finita. Los empates mantienen orden estable.

- `GET /api/v1/users/me/recommendations?limit=6`: consulta sin escrituras.
- `POST /api/v1/users/me/recommendations/refresh?limit=6`: nueva tanda persistente.
  Cuerpo: `{"current_book_ids":["identificador-goodreads-visible"]}`. La lista admite
  como máximo 50 IDs originales de texto y permite excluir la primera tanda GET.
- Ambas operaciones requieren lector o administrador activo. La identidad proviene
  del JWT; el cliente no puede elegir el usuario destino.

Se excluyen todas las valoraciones locales, de cualquier puntuación, y los libros
que el usuario haya tenido en préstamo, incluso devueltos. Un préstamo no se
interpreta como demostración de lectura: esta es una regla de novedad bibliotecaria.
También se excluyen los últimos 500 libros registrados como presentados en una
generación. El GET inicial no registra exposición hasta que el cliente envía sus
IDs al generar otra tanda.

La migración **010** añade `recommendation_exposures` e índice para consultas de
préstamos por usuario. No altera migraciones anteriores ni artefactos de ML.
El historial es independiente por cuenta y sobrevive al cierre del navegador y
al reinicio del backend. Es una ventana de 500 libros, no una prohibición eterna:
libros más antiguos pueden volver a ser candidatos.

Cada POST toma un advisory lock transaccional del usuario. Una generación
simultánea recibe 409; un fallo remoto o de enriquecimiento no consume historial.
Solo una respuesta exitosa `ok` registra y recorta exposiciones. Si no quedan
coincidencias elegibles, devuelve `no_content_matches` con explicación; no reinicia
el historial silenciosamente ni rellena con libros de score cero.

## Frontend

El botón realiza POST y envía los IDs visibles, sustituye la selección en caché
al completar y conserva resultados ante errores transitorios. La petición está
deshabilitada mientras se genera. La disponibilidad se consulta nuevamente; no
se utilizan etiquetas de Goodreads para determinar existencias físicas.

## Alcance pendiente

La alternativa por contenido utiliza géneros y hasta 20 títulos positivos entre
las primeras 100 valoraciones consultadas. El [fold-in local](fold_in_local.md)
añade ajuste automático con todos los ratings explícitos cuando cumple su política
experimental; favoritos y clics no se convierten en estrellas. Tampoco hay
restricción de idioma, diversificación por obra/autor ni evidencia de mejora de
Precision@K/Recall@K por esta renovación.

Para ensayar el híbrido con Goodreads se pueden crear identidades sintéticas de
prueba y un vínculo explícito a un `goodreads_user_id` presente en
`user_mapping.parquet`. Es una simulación de un perfil histórico, no una prueba
de que esa persona sea el propietario de la cuenta. No se debe usar un ID local
como índice de embedding.
La vinculación operativa está implementada desde la migración 011; véase
[perfiles históricos de prueba](perfiles_historicos_prueba.md). Distingue historia
Goodreads de actividad local y conserva la separación de roles y credenciales.

## Verificación

Pruebas sintéticas Python: exclusión antes de Top-K, continuidad de tandas,
agotamiento, ausencia de relleno con cero y preservación de IDs con ceros iniciales.
Pruebas PostgreSQL desechables: aislamiento, persistencia entre instancias,
rollback ante error, exclusión de más de 100 ratings y préstamos, límite de 500,
concurrencia y ausencia de escrituras en GET. El frontend verifica POST con IDs
visibles, doble clic, recuperación de errores y pérdida de permisos.

Comprobación operativa del 2026-11-21, a través del proxy frontend → Go → FastAPI:
un GET inicial y dos POST sucesivos devolvieron tres tandas de seis, **18 IDs
distintos**, todos con score positivo. Se utilizó temporalmente poesía como
preferencia y se retiró después. Esta comprobación valida renovación e integración;
no constituye una evaluación de relevancia ni permite atribuir una mejora de ranking.
También pasaron 40 tests frontend, typecheck, lint, 10 pruebas Python API/inferencia,
`go test ./...`, `go vet ./...` y la suite PostgreSQL con `-race`. La prueba que
requiere una copia importada del catálogo completo se omitió en la base sintética.
