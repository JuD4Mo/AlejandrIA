# Modelo relacional — primera etapa de persistencia

## Alcance y convenciones

PostgreSQL 17, SQL explícito y Tern v2. Hay **17 tablas de dominio** y la tabla técnica
`schema_version`. PK internas `BIGINT GENERATED ALWAYS AS IDENTITY`, excepto roles
(`SMALLINT`). IDs Goodreads son `TEXT` opcional y único, nunca float ni PK interna.
No hay usuarios históricos Goodreads en `users`: los usuarios locales tienen su propio ID.
Todos los timestamps son `TIMESTAMPTZ`; conexiones Go y contenedor usan UTC.
Los IDs y campos de relación son `NOT NULL` salvo que se indique opcional.

## Tablas y atributos

| Tabla | Atributos (además de PK) | Relaciones y responsabilidad |
|---|---|---|
| `users` | email, display_name, password_hash TEXT; is_active BOOLEAN; created_at TIMESTAMPTZ | Identidad local; hash bcrypt, nunca contraseña en texto plano |
| `roles` | name TEXT UNIQUE | Solo lector, bibliotecario, administrador; única semilla |
| `user_roles` | user_id BIGINT, role_id SMALLINT; PK compuesta | N:M users–roles |
| `works` | title TEXT; goodreads_work_id TEXT opcional UNIQUE | Obra abstracta; agrupa ediciones sin deduplicar por título |
| `books` | work_id BIGINT opcional; goodreads_book_id TEXT opcional UNIQUE; title TEXT; description, isbn, isbn13, language_code, image_url TEXT opcionales; publication_year, num_pages INTEGER opcionales; created_at TIMESTAMPTZ | Edición/registro bibliográfico; N:1 works, 1:N book_copies |
| `authors` | name TEXT; goodreads_author_id TEXT opcional UNIQUE | Personas/entidades bibliográficas; no se asume nombre único |
| `book_authors` | book_id, author_id BIGINT; role TEXT; PK de las tres columnas | N:M con rol de participación (author, translator, illustrator, etc.) |
| `genres` | name TEXT | Nombre único sin distinguir mayúsculas/espacios externos |
| `book_genres` | book_id, genre_id BIGINT; PK compuesta | N:M libros–géneros temáticos |
| `book_copies` | book_id BIGINT; inventory_code TEXT UNIQUE; status TEXT; location TEXT opcional; acquired_at TIMESTAMPTZ | Ejemplar físico, no se almacena disponibilidad duplicada |
| `loan_requests` | user_id, book_id BIGINT; status TEXT; created_at TIMESTAMPTZ; decided_at TIMESTAMPTZ, decided_by BIGINT, decision_note TEXT opcionales | Solicitud; lector N:1 users, libro N:1 books, decisor N:1 users |
| `loans` | request_id BIGINT UNIQUE; user_id, book_id, copy_id, delivered_by BIGINT; delivered_at, initial_due_at, due_at TIMESTAMPTZ; returned_at TIMESTAMPTZ, returned_by BIGINT opcionales | Entrega efectiva 0:1 por solicitud. FK compuesta verifica lector/libro de solicitud y libro del ejemplar |
| `loan_renewals` | loan_id BIGINT; requested_at, previous_due_at TIMESTAMPTZ; status TEXT; new_due_at, decided_at TIMESTAMPTZ, decided_by BIGINT, decision_note TEXT opcionales | 1:N por préstamo para conservar solicitudes rechazadas/canceladas; máximo una aprobada |
| `reservations` | user_id, book_id BIGINT; status TEXT; created_at TIMESTAMPTZ; copy_id, assigned_by, loan_id BIGINT opcionales; assignment_origin TEXT opcional; assigned_at, pickup_expires_at, closed_at TIMESTAMPTZ opcionales | Reserva de libro; asignación posterior opcional auditada como manual/system/unknown. loan_id UNIQUE enlaza entrega; FK compuesta verifica lector, libro y ejemplar |
| `user_genre_preferences` | user_id, genre_id BIGINT; created_at TIMESTAMPTZ; PK compuesta | Preferencia explícita N:M |
| `book_ratings` | user_id, book_id BIGINT; rating SMALLINT; created_at, updated_at TIMESTAMPTZ; PK compuesta | Una valoración vigente por lector/libro, rating 1–5; cero no es calificación |
| `user_book_interactions` | user_id, book_id BIGINT; interaction_type TEXT; occurred_at TIMESTAMPTZ | Eventos view, recommendation_click, favorite_added, favorite_removed |

Los cambios de rating actualizan `updated_at` explícitamente desde Go; no hay triggers.
No se copian préstamos, reservas ni ratings a interacciones: las recomendaciones futuras
podrán consultar esas tablas, evitando almacenar dos veces el mismo hecho.

## Estados y consistencia

- Solicitudes: `pending`, `approved`, `rejected`, `cancelled`.
- Préstamos: **estado derivado**: activo si `returned_at IS NULL`, devuelto en otro caso;
  vencido si activo y `due_at < now()`. Un vencimiento nunca cierra el préstamo.
- Renovaciones: `pending`, `approved`, `rejected`, `cancelled`.
- Reservas: `waiting`, `ready`, `fulfilled`, `cancelled`, `expired`.
- Ejemplares: `circulating`, `maintenance`, `lost`, `withdrawn`.
  `circulating` significa apto para circulación, **no necesariamente disponible**.
  La disponibilidad se deriva de no tener préstamo activo ni reserva `ready`.

Las decisiones aprobadas/rechazadas requieren decisor y fecha; las solicitudes sin
decisión no los permiten. `cancelled` permite retiro antes de una decisión; no revoca
la aprobación histórica. Una reserva `ready` requiere asignación, origen del actor y
vencimiento de recogida exactamente 72 horas después. Reservas terminales requieren
fecha de cierre; `fulfilled` requiere préstamo coincidente; `expired` exige alcanzar
el plazo de recogida. No hay expiración automática solo por pasar el tiempo:
el servicio Go cambia el estado de forma transaccional, con una pasada periódica y comprobaciones durante operaciones.

## Integridad SQL e índices

- FK con `ON DELETE RESTRICT` preservan historial y evitan borrar usuarios, ediciones
  o ejemplares referenciados. Para bajas se usa desactivación/retirada, no cascadas.
- `UNIQUE` parcial en `loans(copy_id) WHERE returned_at IS NULL` impide dos préstamos
  activos incluso si uno está vencido.
- `UNIQUE` parcial `(user_id, book_id)` para reservas waiting/ready; otro sobre copy_id
  para reservas ready impide dos asignaciones vigentes al mismo ejemplar.
- Índices parciales para préstamos activos por usuario/vencimiento, solicitudes y
  renovaciones pendientes, recogidas por caducar y cola `(book_id, created_at, id)`.
- Máximo una renovación aprobada y una pendiente por préstamo, con índices parciales.
- Fechas de devolución, decisión y asignación tienen checks de coherencia cronológica.
- Plazo inicial de préstamo: 720 horas = 30 días calendario **en UTC** desde entrega.
  `due_at` admite solo plazo inicial o una extensión de otras 720 horas. No se usa
  fecha de solicitud como inicio. Si se adoptan calendarios en otra zona con DST,
  debe revisarse esta política antes de implementación de servicios.
- No se exige ISBN único: ediciones y fuentes pueden presentar metadatos incompletos.
  `num_pages > 0` cuando existe; todos los nombres obligatorios rechazan texto vacío.

## Reglas transaccionales implementadas en Go

Los checks no son una máquina de estados y no verifican roles ni hechos de otras
tablas. Las siguientes operaciones se coordinan en `internal/circulation`, con
transacciones pgx y bloqueos. Contratos y pruebas: [API backend](../backend/api.md).

1. **Entrega**: bloquear primero el libro y luego la fila de lector `SELECT ... FOR UPDATE` para serializar entregas
   del mismo usuario; contar activos (incluidos vencidos), máximo dos. Bloquear libro,
   solicitud y ejemplar, comprobar rol, aprobación, aptitud, reservas y pertenencia.
   Crear préstamo al entregar, no al aprobar. El índice protege el ejemplar como última barrera.
2. **Reserva/asignación**: bloquear libro antes de insertar o asignar reservas. Esto
   serializa también el caso de cola vacía; bloquear solo filas existentes no basta.
   Elegir FIFO por `(created_at, id)`. Bloquear ejemplar y comprobar que no tenga préstamo
   activo ni otra reserva ready; el SQL no impide por sí solo un préstamo y un hold simultáneos.
3. **Renovación**: bloquear libro, lector y préstamo; comprobar préstamo activo,
   `requested_at < due_at`, que previous_due_at coincida con due_at real, máximo una
   aprobación, ninguna reserva de otro lector y ningún préstamo vencido del lector.
   Registrar decisión y modificar due_at en la misma transacción.
4. **Devolución**: bloquear libro, lector y préstamo/ejemplar; registrar bibliotecario
   y fecha, conservar historial y asignar al primero de la cola en la misma transacción.
5. **Expiración**: bloquear libro, reserva y ejemplar; cerrar ready cuando pasan 72h,
   conservar asignación histórica y reasignar al siguiente lector. No es necesario
   persistir un estado disponible ni un estado overdue.

Todos los caminos siguen un orden común de bloqueo (libro, lector, solicitud/
préstamo/reserva, ejemplar). No se adquiere un segundo libro después de un lector.
Se comprueban autorización y usuarios activos. No hay reintentos HTTP automáticos:
el cliente recibe el error si una operación se aborta. No se implementan multas ni
límites de préstamos mediante triggers.

## Migraciones y operación

### Versión 8 — auditoría de reservas y personalización HTTP

`008_reservation_audit.sql` sustituye únicamente `reservations_check` y añade:

- `assignment_origin IS NULL` en reservas nunca asignadas (todos los campos de
  asignación también nulos).
- `manual`: assigned_by obligatorio; el servicio conserva al miembro real del personal.
- `system`: assigned_by nulo; el worker y operaciones automáticas no buscan sustitutos.
- `unknown`: origen histórico indeterminado. La migración marca así toda asignación
  previa, manteniendo ID, fechas, estados y assigned_by originales sin reinterpretarlos.

Los demás CHECK/FK/índices no cambian: 72h, estados terminales, préstamo coincidente,
unicidad del ejemplar reservado y reserva activa por lector/libro. FIFO sigue en Go.
No se modifican 001–007 ni se añaden tablas. La base de trabajo pasó de 7 a 8.

La reversión restaura el CHECK original y elimina assignment_origin. **Se rechaza
atómicamente si hay asignaciones sin usuario**, incompatibles con versión 7; no
fabrica un bibliotecario, borra reservas ni degrada su historia. Con datos compatibles,
el down/up conserva los campos originales, pero reaplicar vuelve a etiquetar el
origen como unknown: no recupera la columna eliminada por un downgrade.

`scripts/validate_reservation_audit.sh` prueba 7→8→7→8 con una reserva histórica,
compara el contenido de todos los campos previos y verifica que un downgrade no
representable falle dejando versión 8 y sus registros intactos. Las fixtures solo
viven en bases test_* desechables; la base de trabajo nunca se revierte.

### Lecturas sin efectos secundarios

Los GET no ejecutan reconciliación. El inventario usa transacción READ ONLY /
REPEATABLE READ para resumen y filas. Una reserva persistida ready, incluso con
plazo cumplido, retiene conservadoramente el ejemplar hasta que el worker o una
escritura procese la expiración; no se anuncia disponibilidad que pueda saltarse FIFO.
El worker pasa cada minuto, con hasta 100 libros accionables por pasada: no es un
SLA de 60 segundos bajo carga, bloqueos o fallos. La entrega siempre revalida dentro
de la transacción. Las lecturas no liberan ni reasignan ejemplares.

### Personalización local

El módulo `internal/personalization` utiliza las tablas de 006, sin nueva migración
de preferencias. Sustituye géneros en una transacción, conserva created_at de los
retenidos y rechaza duplicados/referencias inexistentes. book_ratings usa UPSERT
por usuario/libro con rating 1–5: created_at se conserva y updated_at avanza al editar.
Los únicos eventos de interacciones son los cuatro tipos de 006; circulación y
ratings no generan copias como eventos. Toda consulta/escritura se limita a la
identidad autenticada local, sin relación con usuarios de entrenamiento Goodreads.

### Versión 7 — mejoras de circulación

`007_circulation_improvements.sql` añade `loan_requests_pending_user_book_uq`, único
parcial sobre `(user_id, book_id) WHERE status='pending'`. Conserva solicitudes
terminales e impide pendientes duplicadas. No borra ni consolida datos; si ya hay
duplicados, falla atómicamente y requiere resolución explícita. Su reversión solo
elimina ese índice. Las migraciones 001–006 no se modifican.

Se revisaron los índices de préstamos activos, reservas ready y renovaciones:
ya garantizan la unicidad correcta y no necesitan duplicación ni nuevos checks.
Máximo dos activos, FIFO y coordinación préstamo/reserva siguen requiriendo
transacciones Go, no checks que consulten otras tablas.

Prueba específica: `internal/database/tests/circulation_v7.sql`, con ROLLBACK,
rechaza una segunda solicitud pending y permite una nueva tras cancelar la anterior.

`001_setup` usuarios/roles, `002_catalog`, `003_inventory`, `004_loans`,
`005_reservations`, `006_personalization`. Tern registra versión en `schema_version`,
usa transacciones por migración y serializa migradores con advisory lock.
La API abre pgxpool y atiende los módulos funcionales; nunca ejecuta migraciones al arrancar.

Desde raíz, copiar `.env.example` a `.env` y definir contraseña local:

```bash
docker compose up -d --build
docker compose exec backend /app/tern migrate
docker compose exec backend /app/tern migrate  # no-op si versión 8
curl --fail http://127.0.0.1:8080/health/ready
docker compose stop
docker compose start
docker compose down  # conserva el volumen; no usar -v para datos de trabajo
```

Reversión explícita: `tern migrate --destination 5` revierte personalización;
`tern migrate --destination 0` revierte
todo el dominio y elimina sus datos. Usar reversión solo en bases desechables o con
un plan de respaldo. No se ofrece reversión automática durante el arranque.

Pruebas SQL (recomendado sobre base desechable migrada):

```bash
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d prueba_migraciones -v ON_ERROR_STOP=1' \
  < alejandria-backend/internal/database/tests/constraints.sql
```

El script usa fixture sintética y ROLLBACK, verifica unicidad, referencias, estados,
ratings, fechas, devolución tardía y reutilización de ejemplar. Las secuencias pueden
avanzar pese al rollback, como es habitual en PostgreSQL. No modifica datasets ML.

## Validación ejecutada en la etapa inicial (versión 6)

Validado localmente con Docker Compose y PostgreSQL 17:

- Aplicación desde base vacía hasta versión 6; segunda aplicación sin cambios.
- 17 tablas de dominio, 28 FK y 5 índices únicos parciales verificados en catálogos PostgreSQL.
- Tres roles iniciales; ningún usuario creado como semilla.
- Fixture SQL aceptó casos válidos y rechazó duplicados de email/Goodreads/rating,
  referencias huérfanas, estados inválidos, préstamo activo duplicado, ejemplar de
  otro libro, segunda renovación aprobada, renovación tardía, reserva activa
  duplicada, asignaciones duplicadas y expiraciones prematuras.
- Registro sintético persistió al reiniciar PostgreSQL y backend.
- Reversión a versión 0 y reaplicación a 6 sobre base desechable, seguida de eliminación
  de esa base. El esquema de trabajo no se revirtió.
- `go test ./...` compiló todos los paquetes (aún no hay tests unitarios Go) y
  `go vet ./...` pasó. Las pruebas de integridad de esta etapa son SQL reales,
  ejecutables con el script de validación.
- `/health` y `/health/ready` respondieron 200 después del reinicio.

Para esta verificación se usó `--env-file .env.example` con contraseña de ejemplo
solo local y puertos loopback. Para trabajo continuado, definir `.env` local según
el README; una base ya inicializada requiere cambiar explícitamente la contraseña
del rol si se sustituye la del ejemplo, no basta con editar el archivo.
