# Fold-in automático para cuentas locales — experimental

## Flujo operativo

La migración 012 añade `local_fold_in_profiles`, sus triggers y la cola durable.
Guardar, modificar o eliminar una valoración incrementa una revisión y marca el
perfil pendiente en la **misma transacción** del rating. Una corrección de
`books.goodreads_book_id` también encola a los usuarios afectados. Un rollback
revierte tanto la valoración como el trabajo pendiente.

Un worker Go consulta cada tres segundos el modelo activo y procesa revisiones
pendientes de lectores/administradores activos. Reclama con `FOR UPDATE SKIP
LOCKED`, toma un snapshot de todos los ratings y libera la transacción antes de
consultar FastAPI. Usa un lease de 60 segundos y token UUID. Publica únicamente
si revisión y token aún coinciden: nuevas valoraciones invalidan resultados en
vuelo. Un error remoto deja el trabajo recuperable, con reintento a los 30 segundos.
Un proceso caído se recupera al vencer el lease.

Las cuentas vinculadas a perfiles históricos de prueba mantienen su historial
fijo y no entran en este worker. No se mezclan usuarios locales con los embeddings
históricos ni se copian valoraciones de Goodreads a PostgreSQL.

## Cálculo y política

Para ratings locales explícitos sobre libros con embedding, se resuelve en float64:

`sum_i (rating_i - global_mean - item_bias_i - item_vector_i · user_vector - user_bias)^2
 + lambda * (||user_vector||² + user_bias²)`.

Solo se ajustan los 32 factores y el sesgo del usuario. Los parámetros de libros,
usuarios históricos, TF-IDF y checkpoints permanecen fijos. Se usa `numpy.linalg.solve`
con regularización positiva, sin épocas ni cambios en el modelo global. Ratings
1–3 también influyen en el ajuste; 0 no es una valoración válida. Clics, favoritos
y préstamos no se convierten en estrellas.

La política inicial es experimental: **mínimo 5 book_id distintos con embedding**
y al menos un libro positivo (4–5) con contenido indexado. Cinco valoraciones no
son garantía de suficiencia estadística ni equivalen a cinco obras independientes.
Todos los ratings actuales se consideran; no se limita el ajuste a los primeros 100.
Ratings sin correspondencia o sin embedding no se inventan: se reportan conteos
totales y compatibles. El límite de transporte del fit es 100.000 ratings.

Cuando está listo, el contenido se construye promediando y normalizando vectores
TF-IDF de libros positivos locales. Se combina con las puntuaciones colaborativas
del vector adaptado. Los dos scores se normalizan sobre el catálogo colaborativo
completo; luego se excluyen ratings, préstamos y exposiciones recientes, antes del
Top-K. No se mezclan aquí libros sin embedding ni se inventan sus scores.

**Política seleccionada solo en validación:** lambda 0,01 y 90 % contenido / 10 %
colaborativo. Es distinta de la mezcla histórica 30/70. Mientras el perfil esté
pendiente, insuficiente, fallido o desactualizado, se utiliza el flujo de contenido
existente. El estado se muestra en Inicio; el cliente consulta cada dos segundos
mientras espera y deja de hacerlo al finalizar. Un cambio de gustos puede cambiar
la afinidad, no garantiza que todo el Top-K sea diferente.

## Versionado, API y datos privados

Cada perfil lleva un hash SHA-256 del checkpoint, mapping/config colaborativos,
artefactos de contenido, política y código de adaptación; también un hash de los
ratings utilizados. El JSONB contiene los parámetros numéricos, no otro usuario.
Una revisión nueva impide usar el vector viejo. Un hash de modelo incompatible
produce 409 en FastAPI; Go utiliza contenido y el worker reencola perfiles al
detectar el modelo nuevo. Se conserva la posibilidad de reconstruirlos con los
ratings actuales después de un rollback de modelo.
El contrato actual soporta V2: cambiar la versión mayor del servicio requiere
actualizar también el contrato del backend, no solo reemplazar archivos.

Endpoints privados, sin IDs de usuario en sus cuerpos:

- `GET /api/v1/recommendations/local/model`: descriptor y política.
- `POST /api/v1/recommendations/local/fit`: firma esperada y ratings book_id/rating.
- `POST /api/v1/recommendations/local/hybrid`: perfil numérico, límite y exclusiones.

La API pública mantiene sus rutas personales. Responde `profile_origin:
local_fold_in` cuando usa el híbrido local y `fold_in` con estado, conteos,
revisiones y fecha. No devuelve el vector, sesgo, IDs positivos ni hash de ratings
al navegador. Los GET públicos no escriben perfiles ni encolan entrenamiento.

## Evaluación piloto y límite de calidad

Comando reproducible (CPU, para controlar hilos):

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 \
python src/ml/evaluate_fold_in.py --users 100 --seed 2026 \
  --output-dir data/reports_fold_in
```

Se usan las últimas 5/10/20 valoraciones de train por usuario, según `date_added_utc`
(fecha añadida, no fecha de lectura), y un objetivo positivo de validación o test.
Se excluye el soporte y se evalúa sobre todo el catálogo colaborativo. Se comparan
popularidad entrenada, perfil de contenido, fold-in colaborativo e híbridos.
Se calibran lambda `[0.01,0.1,1,10,100]` y pesos `[0,0.1,0.3,0.5,0.7,0.9,1]` solo
en validación; la selección de un híbrido verdadero usa pesos interiores, por media
de NDCG@10, Recall@10 y MRR entre tamaños de soporte. Extremos se conservan en el
reporte. Los parámetros quedan fijos antes de consultar test.

Resultados de test con la política seleccionada:

| Soporte | Casos elegibles | Recall@10 híbrido | Recall@10 colaborativo adaptado | Recall@10 popularidad |
|---:|---:|---:|---:|---:|
| 5 | 87 | 0 | 0,04598 | 0,01149 |
| 10 | 77 | 0 | 0,03896 | 0,03896 |
| 20 | 64 | 0 | 0 | 0,03125 |

**La mezcla híbrida no demostró mejora en test**; no se retocó con esos resultados.
El estado `ready` significa que se calculó un perfil compatible, no que su calidad
esté validada. La interfaz identifica el híbrido como experimental.

Límites: muestra piloto de 100 usuarios solicitados por split (se omiten soportes
insuficientes o sin positivos); usuarios históricos contribuyeron al aprendizaje
de ítems, por lo que no es un ensayo estricto de usuarios completamente nuevos;
un único objetivo positivo deja relevancia incompleta. Informes ligeros locales:
`data/reports_fold_in/metrics.csv` y `evaluation.json`. La evaluación duró unos 286 s.
La política activa versionada está en `src/ml/fold_in_policy.json`; el hash del
archivo de política registrado al ejecutar la evaluación corresponde al archivo
existente entonces, antes de incorporar manualmente los parámetros seleccionados.

## Despliegue

```bash
docker compose --env-file .env.example build backend recommendations frontend
docker compose --env-file .env.example run --rm --no-deps --entrypoint /app/tern backend migrate
docker compose --env-file .env.example up -d --no-build --wait --wait-timeout 600
```

`FOLD_IN_ENABLED=true` activa el worker y el enrutamiento local (valor inicial).
Con `false`, las cuentas locales normales usan contenido; las simulaciones
históricas conservan su modo. No se ejecutan migraciones al arrancar la API.

## Verificación operativa de esta entrega

Se probó por HTTP a través de Nginx con cinco ratings temporales del administrador
(su lista estaba inicialmente vacía). El worker produjo un vector de 32 factores,
estado ready y seis recomendaciones `hybrid` / `local_fold_in`, con componentes
reales y sin incluir los libros valorados. Cambiar un rating de 1 a 5 incrementó
la revisión y modificó vector/hash de entrada, manteniendo idéntica la firma del
modelo global. Eliminar un rating dejó cuatro compatibles y restauró contenido.

Finalmente se retiraron únicamente esos ratings temporales: el administrador quedó
otra vez sin ratings y sin vector numérico, en estado insufficient. Las cuentas
A/B conservaron modo histórico e historiales 83/26. No se crearon nuevas cuentas.
Se verificó el mensaje actualizado en el bundle servido, además de 47 pruebas
frontend, 20 pruebas Python API/inferencia/fold-in, Go test/vet y la suite PostgreSQL
con race detector. La prueba que exige catálogo completo en una base desechable
se omitió; el smoke operativo utilizó el catálogo y los artefactos reales.
