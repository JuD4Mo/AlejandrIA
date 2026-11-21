# Cuentas locales con perfiles históricos de prueba

## Propósito y selección

Permiten recorrer login → Go → FastAPI → modelo híbrido V2 → catálogo e inventario
desde cuentas lectoras locales. No son perfiles aprendidos mediante fold-in y no
acreditan la identidad de una persona de Goodreads.

La selección inicial es reproducible: se inspeccionó únicamente el primer lote de
131.072 filas de `data/ml_v2/train.parquet`, con columnas user_idx/book_idx/rating.
Se encontraron 1.199 usuarios con al menos diez ratings positivos dentro de ese
lote. Se seleccionaron los índices de modelo 117 y 688535, con 73 y 23 ratings
positivos observados en ese lote, respectivamente. No son conteos de todo su historial.
Sus IDs originales se resuelven desde el mapping; no se convierten IDs Goodreads
a números ni se usan los IDs PostgreSQL como embeddings.

## Funcionamiento

La migración 011 añade `user_goodreads_test_profiles`: usuario local, ID Goodreads
original, versión del modelo, operador creador y fecha. Las credenciales y roles
siguen perteneciendo a la cuenta local. No se copian ratings históricos a SQL.
La vinculación se realiza mediante operación de base de datos del operador; el
registro público no acepta perfiles históricos y no hay una ruta de autoasignación.

`GET /auth/me` informa `recommendation_profile: goodreads_test`. Así, el frontend
omite el onboarding de intereses para estas cuentas. Inicio muestra un aviso de
simulación y la administración identifica esas cuentas con una etiqueta.

El mismo GET personal y POST refresh seleccionan automáticamente el híbrido cuando
existe un vínculo válido. El cliente Go llama al POST interno
`/api/v1/recommendations/hybrid`, que recibe el ID original, limit y exclusiones.
Las respuestas personales añaden `profile_origin: goodreads_test`; no exponen el
identificador histórico al navegador. Cada resultado conserva content_score y
collaborative_score reales, con scope collaborative_catalog.

El historial de entrenamiento ya se excluye en el motor. Se agregan exclusiones de
ratings/préstamos locales y exposiciones recientes, antes del Top-K pero después
de normalizar scores: la renovación no cambia la escala híbrida calibrada.

Las preferencias y nuevas valoraciones locales **no actualizan** el vector
histórico. Los ratings locales excluyen libros de futuras tandas. La actividad de
cada cuenta, sus permisos y las exposiciones permanecen aislados.

## Visualización de valoraciones para evaluar los perfiles

En `/me/ratings`, las cuentas vinculadas abren por defecto **Historial Goodreads**:
títulos, autores, estrellas y enlace al libro local cuando existe correspondencia
exacta. El historial es paginado, se ordena por rating descendente y book_idx
ascendente, y no ofrece edición ni borrado. La pestaña **Mis valoraciones en
AlejandrIA** conserva las valoraciones locales editables, sin mezclarlas con train.

`GET /api/v1/users/me/ratings/historical?limit=20&offset=0` resuelve el perfil desde
la cuenta autenticada. No acepta elegir otra identidad histórica desde el navegador.
Go consulta el POST interno `/api/v1/recommendations/history`, valida procedencia,
paginación y ratings 1–5, y resuelve IDs locales. El GET no escribe en ratings,
exposiciones ni archivos Parquet. Solo devuelve train, nunca valid/test.

Los conteos completos de entrenamiento verificados para estas cuentas son:

| Cuenta | Ratings train | Positivos (4–5) | Distribución |
|---|---:|---:|---|
| A | 83 | 73 | 2★: 4; 3★: 6; 4★: 30; 5★: 43 |
| B | 26 | 23 | 3★: 3; 4★: 14; 5★: 9 |

Es el historial utilizado por el modelo, no necesariamente todas las interacciones
originales de la persona en Goodreads. Las listas locales estaban vacías al
diagnosticar el problema: la vinculación no había copiado ratings a PostgreSQL.

Una versión de vínculo distinta de v2 o un ID histórico ausente produce conflicto;
no se sustituye silenciosamente por otro usuario ni por contenido. Las cuentas sin
vínculo siguen usando el flujo local normal.

## Fold-in y reentrenamiento

El [fold-in automático local](fold_in_local.md) está implementado desde la migración
012 con política experimental. Registra revisiones de ratings y adapta vector/sesgo
en segundo plano; usa contenido mientras una revisión está pendiente o es
insuficiente. Las cuentas de esta página mantienen su simulación histórica fija,
para distinguir ambos recorridos. Clics y préstamos no se convierten en estrellas.

El reentrenamiento global puede incorporar actividad local y actualizar usuarios,
libros y sesgos. Debe ejecutarse fuera del proceso de inferencia, con splits sin
fuga, baseline y comparación de métricas. Una nueva versión implica artefactos y
mappings compatibles, reconstrucción de perfiles fold-in y actualización o
revalidación de estos vínculos de prueba. La publicación debe permitir rollback.
La cadencia se decide por volumen y deriva; no se promueve un modelo solo porque
ha transcurrido un plazo.

## Verificación de instalación

El 2026-11-21 se crearon dos lectores de prueba con vínculos distintos a V2. En
cada cuenta se verificaron login, identidad marcada, GET híbrido y POST refresh:
dos tandas de seis con 12 libros distintos por cuenta, componentes colaborativo
y de contenido presentes y correspondencia local del Top-6 inicial. Los rankings
iniciales fueron distintos (compartían tres libros), algo permitido entre perfiles.
Se comprobó por HTTP que el bundle servido incluye el aviso de simulación.

Pasaron 41 pruebas frontend, typecheck, lint, 12 pruebas Python API/inferencia,
`go test ./...`, `go vet ./...` y la suite de integración PostgreSQL con `-race`.
La prueba que requiere catálogo importado en la base desechable se omitió; el
recorrido HTTP operativo sí utilizó los artefactos y el catálogo reales.

La verificación posterior de la vista histórica recuperó por HTTP todas las
entradas: A en páginas 20/20/20/20/3 y B en páginas 20/6. Ambas listas locales
seguían vacías; el historial se consultó sin copiarlo. Los seis resultados híbridos
consultados por cuenta no se solapaban con sus ratings de entrenamiento. Pasaron
45 pruebas frontend y 15 pruebas Python API/inferencia, además de pruebas Go,
vet y la suite PostgreSQL con race detector y controles de acceso/read-only.
