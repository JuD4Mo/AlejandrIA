# Backend Go — contrato funcional `/api/v1`

## Identidad y permisos

Roles persistidos: `lector`, `bibliotecario`, `administrador` (equivalentes a
reader/librarian/admin). Registro solo asigna lector; no admite `roles` ni `user_id`.
Contraseñas bcrypt coste 12, de 12 caracteres a 72 bytes. Login devuelve JWT HS256
con emisor `alejandria`, subject local y vencimiento de una hora. Configurar
`APP_AUTH_SECRET` con al menos 32 bytes aleatorios. No se almacenan tokens en SQL.

Cada petición autenticada vuelve a leer estado y roles desde PostgreSQL: desactivar
un usuario invalida su acceso inmediatamente. Enviar `Authorization: Bearer TOKEN`.
No hay refresh tokens, recuperación de contraseña ni logout con revocación individual
en esta iteración. Para publicación fuera de entorno local faltan TLS y límites de
intentos de login. Los errores JSON usan `errs.HTTPError`, sin SQL ni hashes.

## Primer administrador

`cmd/admin` es un comando operativo, no una ruta pública ni un migrador. Recibe un
objeto `{email, display_name, password}` por stdin. Dentro de una transacción con
advisory lock verifica que no haya ningún administrador antes de crear el primero.
No registrar credenciales en Git ni pasarlas como argumentos de línea de comandos.

Con un archivo local protegido que contenga el JSON de alta:

```bash
docker compose exec -T backend /app/admin < /ruta/local/protegida/admin.json
```

La contraseña no tiene valor predeterminado. El comando se niega a crear un segundo
administrador; los posteriores se asignan mediante API autenticada.

## Endpoints

Todas las rutas siguientes llevan prefijo `/api/v1`. Las consultas de catálogo
requieren autenticación. Personal = bibliotecario o administrador. Administrador
puede usar también rutas de lector. El bibliotecario necesita además rol lector si
quiere solicitar préstamos propios.

| Método/ruta | Permiso | Contrato |
|---|---|---|
| POST `/auth/register` | Público | email, display_name, password → usuario (201) |
| POST `/auth/login` | Público | email, password → access_token, token_type, expires_in |
| GET `/auth/me` | Autenticado | Perfil local; nunca password_hash |
| GET `/users` | Admin | Lista paginada de usuarios |
| PUT `/users/{id}/roles` | Admin | `{roles:["lector","bibliotecario"]}` sustituye asignaciones |
| PATCH `/users/{id}/active` | Admin | `{is_active:false}` desactiva sin borrar historial |
| GET `/books` | Autenticado | limit/offset, title, author_id, genre_id |
| GET `/books/{id}` | Autenticado | Datos bibliográficos, authors (author_id, role), genre_ids |
| POST `/books` | Personal | Crea libro y relaciones atómicamente (201) |
| PUT `/books/{id}` | Personal | Sustitución completa de atributos/relaciones |
| DELETE `/books/{id}` | Personal | Solo si no hay referencias; SQL RESTRICT conserva historial |
| GET `/{works,authors,genres}` | Autenticado | Listados paginados, campos id, value, goodreads_id |
| GET `/{works,authors,genres}/{id}` | Autenticado | Consulta individual |
| POST/PUT/DELETE `/{works,authors,genres}[/{id}]` | Personal | Obras: title; autores/géneros: name; goodreads_id opcional para obras/autores |
| GET `/books/{id}/copies` | Autenticado | total, available, copies paginadas; lectura pura con disponibilidad conservadora |
| POST `/books/{id}/copies` | Personal | inventory_code, status opcional (circulating), location |
| PUT `/books/{id}/copies/{copyID}` | Personal | Actualiza código/condición/ubicación; no retira de circulación un ejemplar ocupado |
| GET `/loan-requests` | Autenticado | Propias; personal ve todas |
| POST `/loan-requests` | Lector | `{book_id:1}` → id (201), pending, sin asignar ejemplar |
| POST `/loan-requests/{id}/cancel` | Propietario | Solo pending |
| POST `/loan-requests/{id}/reject` | Personal | `{reason:"..."}`; solo pending |
| POST `/loan-requests/{id}/deliver` | Personal | `{copy_id:1}`; aprueba y entrega atómicamente → préstamo |
| GET `/loans` | Autenticado | Propios; personal ve todos, incluidos devueltos |
| POST `/loans/{id}/return` | Personal | Registra recepción y asigna ejemplar al siguiente reservado |
| POST `/loans/{id}/renewals` | Propietario | Crea renovación pending, no altera aún due_at |
| GET `/renewals` | Autenticado | Propias; personal ve todas |
| POST `/renewals/{id}/decision` | Personal | `{approve:true}` o `{approve:false,reason:"..."}` |
| POST `/renewals/{id}/cancel` | Propietario | Solo pending |
| GET `/reservations` | Autenticado | Propias; personal ve todas, orden created_at/id |
| POST `/reservations` | Lector | `{book_id:1}` → waiting o ready (201) |
| POST `/reservations/{id}/cancel` | Propietario | waiting/ready vigente; libera y reasigna |
| POST `/reservations/{id}/pickup` | Personal | Sin otra solicitud manual; crea/aprueba solicitud, préstamo y fulfilled atómicamente |

Los POST de diccionarios/ejemplares y las acciones devuelven 200; registro, libros,
solicitudes y reservas devuelven 201. Las listas generales devuelven
`{data:[], pagination:{limit:20, offset:0}}`; inventario devuelve resumen y `copies`.
`limit` entre 1 y 100, offset no negativo. Los listados de circulación todavía no
incluyen filtro por estado; devuelven el historial paginado autorizado.

Errores: 400 contrato inválido, 401 credenciales/token inválidos o cuenta desactivada,
403 permisos/propiedad, 404 identificador inexistente, 409 conflicto de unicidad o
regla de circulación, 500 error interno. FK y checks SQL se traducen mediante sqlerr.
Los cuerpos rechazan campos desconocidos y múltiples objetos JSON.

Ejemplo de alta bibliográfica (no importa Goodreads):

```json
{
  "title": "Libro de biblioteca",
  "goodreads_book_id": "000123",
  "work_id": null,
  "authors": [{"author_id": 1, "role": "author"}],
  "genre_ids": [1]
}
```

## Circulación y transiciones

- Solicitud: pending → approved (solo entrega), rejected o cancelled. No ocupa
  ejemplar y no cuenta como préstamo activo. Índice 007 impide pending duplicados.
- Préstamo: activo mientras returned_at sea null, aun vencido. Entrega de 30 días
  UTC; máximo dos activos y ningún vencido al solicitar o recibir otro préstamo.
- Reserva: waiting → ready → fulfilled/expired/cancelled. waiting también admite
  cancelación. FIFO por created_at/id; solo se asigna a lectores activos (inactivos
  mantienen su lugar histórico, pero no bloquean la asignación a activos).
- Recogida: requiere ready antes de pickup_expires_at y ejemplar coincidente.
  Reutiliza una solicitud pending del mismo lector/libro si ya existe; de lo contrario
  la crea. La aprueba y enlaza préstamo/reserva en la misma transacción.
- Renovación: pending → approved/rejected/cancelled. Solo una aprobada, solicitud
  anterior al vencimiento y préstamo aún no vencido al aprobar. Extiende 30 días
  desde due_at anterior, no desde la fecha de aprobación. Reservas waiting/ready
  de otros lectores o préstamos vencidos del lector impiden solicitud/aprobación.

Expiración/asignación automática: goroutine Go cada minuto, hasta 100 libros
accionables por pasada, con contexto cancelable. Se reconcilia también en escrituras
de circulación, nunca en GET. No se exige un servicio adicional ni personal activo
para asignar automáticamente.

Versión 8 añade `assignment_origin` a las respuestas de reservas:
- `manual` y assigned_by real en reconciliaciones iniciadas por el personal
  durante entrega, devolución, recogida o decisión de renovación.
- `system` y assigned_by null al reservar/cancelar como lector o desde el worker.
- `unknown` en asignaciones históricas cuyo origen no está demostrado; se conserva
  assigned_by antiguo sin presentarlo como actor confirmado.
- null mientras la reserva nunca haya sido asignada.

Recoger, cancelar o expirar conserva los datos de su asignación histórica. Los GET
no cambian estados. `available` excluye todo hold ready persistido, aun vencido,
hasta su procesamiento por worker/escritura; puede subestimar disponibilidad durante
ese intervalo, pero no habilita préstamos que violen una cola. Bajo carga o bloqueo,
el retraso puede exceder un minuto; la entrega siempre se valida transaccionalmente.

## Personalización del lector autenticado

Prefijo `/api/v1/users/me`; lector o administrador, activo. Un bibliotecario sin rol
lector recibe 403. No hay rutas para modificar preferencias de otros usuarios, ni
se admite user_id en el JSON. Las consultas devuelven `{data:[],pagination:{limit,offset}}`.

| Método/ruta | Cuerpo / respuesta |
|---|---|
| GET `/preferences/genres` | Lista paginada: genre_id, name, created_at |
| PUT `/preferences/genres` | `{genre_ids:[1,2]}` → `{updated:true}` (200); máximo 100 sin duplicados |
| DELETE `/preferences/genres` | Vacía la selección propia → `{deleted:true}` (200) |
| DELETE `/preferences/genres/{genre_id}` | Elimina una preferencia propia; 404 si no existe |
| GET `/ratings` | Lista propia: book_id, title, goodreads_book_id, rating, created_at, updated_at |
| PUT `/ratings/{book_id}` | `{rating:4}` crea o actualiza (200), entero 1–5 |
| DELETE `/ratings/{book_id}` | Elimina solo la valoración propia (200), 404 si no existe |
| POST `/interactions` | `{book_id:1,interaction_type:"view"}` → evento (201) |
| GET `/interactions` | Eventos propios paginados; más recientes primero, desempate por id |

`genre_ids:[]` también vacía preferencias. Campo omitido/null, duplicados, IDs
inválidos, géneros o libros inexistentes y tipos de eventos inválidos se rechazan
con 400. PUT rating conserva created_at y actualiza updated_at. No hay historial
adicional de ratings. Una interacción repetida es otro evento; no hay idempotencia
de eventos ni deduplicación de doble clic en esta etapa.

Ejemplos (IDs locales existentes; TOKEN pertenece al lector):

```bash
curl -X PUT http://localhost:8080/api/v1/users/me/preferences/genres \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"genre_ids":[1,2]}'
curl -X PUT http://localhost:8080/api/v1/users/me/ratings/1 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"rating":5}'
curl -X POST http://localhost:8080/api/v1/users/me/interactions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"book_id":1,"interaction_type":"recommendation_click"}'
curl 'http://localhost:8080/api/v1/users/me/ratings?limit=20&offset=0' \
  -H "Authorization: Bearer $TOKEN"
```

goodreads_book_id es un string externo opcional en los metadatos del libro. No se
usa el ID local del lector como ID Goodreads ni se asignan embeddings a usuarios nuevos.

## Recomendaciones V2 mediante Go

- `GET /api/v1/users/me/recommendations?limit=10`: lector/admin activo; preferencias
  locales y títulos positivos se convierten a señales textuales, nunca a usuario Goodreads.
- `GET /api/v1/books/{id}/similar?limit=10`: autenticado; resuelve ID local a
  goodreads_book_id exacto y consulta similitud de contenido.

Límite 1–50. Respuestas incluyen origen, versión, score_scope, ID Goodreads string,
ID local opcional y conteos de disponibilidad. Los externos conservan disponibilidad
null. No se filtra ni reordena Top-K para simular un ranking local.
Detalle de DTOs, errores, mediciones y ejemplos reales:
[recomendaciones.md](recomendaciones.md). Ejecución de los tres servicios:
[Docker Compose](../docker-compose.md).

## Concurrencia

Todas las escrituras de circulación bloquean **libro → lector (si aplica) →
solicitud/préstamo/reserva → ejemplar**, en transacción pgx. Inventario bloquea libro
antes de modificar ejemplares; usuarios solo bloquean su propia fila. No se adquiere
otro libro después de bloquear un lector. La cola vacía está protegida por el libro.
Se toma clock_timestamp después de bloquear para no usar una hora anterior a una
espera prolongada. Los índices únicos son barreras finales, no la validación principal.

No hay reintentos automáticos de operaciones que puedan duplicar respuestas tras
fallos de red; tampoco claves de idempotencia de HTTP. No se promete procesamiento
exactly-once. SQL ejecutado fuera de estos servicios puede saltarse reglas entre tablas.

## Pruebas reproducibles

```bash
# Desde alejandria-backend/
go test ./...
go vet ./...
go test -race ./...
# Sobre una base desechable test_* ya migrada a 8:
TEST_DATABASE_URL='postgres://USUARIO:CLAVE@localhost:5432/test_backend?sslmode=disable' \
  go test -tags=integration -race -count=1 -v ./internal/integration
```

Sin TEST_DATABASE_URL las pruebas de integración se omiten explícitamente. Nunca
apuntarlas a la base de trabajo. Cada fixture crea registros propios sin truncar tablas.
La prueba de rollback inyecta un trigger únicamente en esa base desechable y lo retira.

Smoke HTTP de contenedor, usando base desechable y un puerto alternativo:

```bash
docker compose exec postgres createdb -U alejandria test_backend_http
docker compose exec -e PGDATABASE=test_backend_http backend /app/tern migrate
docker compose run -d --name alejandria-backend-smoke \
  -p 127.0.0.1:18080:8080 -e APP_DATABASE_NAME=test_backend_http \
  -e PGDATABASE=test_backend_http backend
python3 alejandria-backend/scripts/http_smoke.py
docker rm -f alejandria-backend-smoke
docker compose exec postgres dropdb -U alejandria test_backend_http
```

Sustituir `alejandria` por el usuario PostgreSQL local si se configuró otro. El script
solo permite test_* y genera credenciales aleatorias en memoria. No imprime tokens.

## Verificación y límites

Las pruebas incluyen: bcrypt y token manipulado/cuenta desactivada; permisos HTTP;
relaciones bibliográficas y rollback; ejemplares/availability; pending duplicados;
dos entregas al mismo ejemplar; dos entregas que excederían límite del lector;
devolución/FIFO; recogida sin solicitud manual; expiración concurrente con recogida;
dos asignadores; renovación concurrente con una reserva; renovación única y vencidos.

No se ha medido carga sostenida ni rendimiento en múltiples réplicas. Personalización
ya alimenta las rutas de recomendaciones de FastAPI, sin importar su catálogo a PostgreSQL.
La API no infiere disponibilidad desde Goodreads; utiliza inventario y circulación locales.

Los errores reutilizan `errs` y `sqlerr`: se eliminó el constructor duplicado
web.Error; web.Fail solo traduce y escribe HTTP. Paginación está centralizada en
pkg/meta: Window/Parse representa el rango limit/offset y Meta conserva el cálculo
de páginas/totales cuando existen. web.Pagination es solo un adaptador HTTP, sin
otro tipo ni algoritmo. Se preservó el JSON y la semántica de los listados actuales.

### Resultados ejecutados en esta iteración

Validación de versión 8 y personalización:

- `go test ./...`, `go vet ./...` y `go test -tags=integration -race -count=1 ./...`
  satisfactorios con base test_* migrada a 8: siete pruebas unitarias principales y
  catorce pruebas principales de integración, además de sus subcasos.
- Se probó asignación system sin ningún miembro activo del personal, manual con
  bibliotecario real, expiración/reasignación FIFO y conservación de la auditoría al recoger.
- Un GET de ejemplares y otro de reservas conservaron el mismo fingerprint de los
  registros de reservas, préstamos y ejemplares. Solo Sweep liberó después la reserva caducada.
- Preferencias: válidas, repetidas, inexistentes, retención de created_at y rollback
  de un error de inserción posterior al borrado. Ratings: rango, unicidad, timestamps,
  actualización/eliminación y aislamiento. Interacciones: referencias, tipos y paginación.
- Smoke HTTP real de Docker: preferencias, ratings, eventos y circulación, incluyendo
  rechazos 400/403/409 y comprobación de que circulación no duplicó eventos.
- La prueba SQL de migración verificó preservación histórica por fingerprint,
  down/up compatible y rechazo del downgrade inseguro sin alterar versión ni registros.

Resultados previos de versión 7 (referencia histórica):

- Migración 007 aplicada a la base existente antes de implementar los módulos:
  versión 6 → 7, sin borrar datos; prueba SQL específica satisfactoria.
- Tres pruebas unitarias principales de usuario/elegibilidad con subcasos; `go test
  ./...` y `go vet ./...` satisfactorios.
- Diez pruebas de integración principales con PostgreSQL 17, más subcasos de
  concurrencia; ejecutadas con `-tags=integration -race -count=1` sin omisiones.
- Smoke de Docker por puerto 18080: bootstrap único, registro/login, autor/género,
  libro/ejemplar, solicitud, duplicado 409, entrega, devolución por lector 403,
  reserva waiting, devolución, recogida, renovación aprobada, segunda renovación
  409 y disponibilidad final = 1. Todas las respuestas tuvieron el estado esperado.
- Reversión solo de 007 y reaplicación en base desechable con datos: se conservaron
  57 usuarios, 19 préstamos y 14 reservas durante el ciclo 7 → 6 → 7.

Los resultados muestrean los escenarios escritos en las pruebas; no son una prueba
exhaustiva de todas las intercalaciones posibles ni una medición de capacidad.
