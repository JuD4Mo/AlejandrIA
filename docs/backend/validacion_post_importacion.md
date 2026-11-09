# Validación integral posterior a Goodreads

Fecha de ejecución: 2026-11-09. PostgreSQL 17, esquema 9, Go/Chi/pgxpool,
FastAPI/RecommendationEngine V2 CPU. No hubo nuevas funcionalidades de producto,
migraciones ni cambios a modelos o datasets. Se añadieron herramientas de auditoría
y pruebas. Este informe distingue evidencia ejecutada de límites no demostrados.

## 1. Conclusión

**Los escenarios ejecutados funcionan de extremo a extremo.** El catálogo operativo
coincide exactamente con las proyecciones normalizadas de los Parquet, el backend
responde con los metadatos importados, la inferencia conserva sus scores y la
circulación opera sobre esos mismos registros cuando hay inventario físico.

La validación funcional se ejecutó en `test_post_import_audit`, con una importación
real completa de 931.046 libros, para disponer del volumen real y garantizar que los
resultados del modelo podían corresponder a registros importados, no a espejos
creados manualmente. Los ejemplares, cuentas, préstamos y reservas de prueba se
crearon exclusivamente allí. Otra base vacía `test_post_import_etl` se usó para la
prueba pequeña de fallos y recuperación del importador.

La base operativa solo recibió consultas de lectura de la auditoría. No se volvió a
importar sobre ella, no se insertaron fixtures ni se alteraron sus usuarios.

## 2. Auditoría de datos completa

Herramienta: `src/data/audit_catalog.py`.

- PostgreSQL en `REPEATABLE READ READ ONLY`, confirmado por `transaction_read_only=on`.
- Cursor de servidor por lotes de 10.000 filas a DuckDB temporal; no se descarga
  el catálogo completo a una lista Python.
- Comparación de todos los registros y relaciones, no solo sus conteos.
- Libros: particiones por hash de clave, con igualdad **exacta de valores** mediante
  IS DISTINCT FROM. El hash decide el bucket, no sustituye comparación de contenido.
- Resto: diferencias de multiconjuntos con EXCEPT ALL.
- Originales Parquet y artefactos V2 sin modificaciones; hashes de fuente registrados.

| Entidad | Esperado tras las reglas ETL | PostgreSQL | Diferencias |
|---|---:|---:|---:|
| Libros | 931.046 | 931.046 | 0 |
| Autores | 268.308 | 268.308 | 0 |
| Obras | 458.726 | 458.726 | 0 |
| Géneros | 10 | 10 | 0 |
| Relaciones libro/autor | 1.350.694 | 1.350.694 | 0 |
| Relaciones libro/género | 2.917.475 | 2.917.475 | 0 |

**Cero diferencias por campo** en work externo resuelto, título, descripción, ISBN,
ISBN13, idioma, año, páginas y URL de portada. Cero IDs Goodreads duplicados,
referencias huérfanas, títulos vacíos y FK sin validar. La comprobación de coherencia
duró 127,57 s, con RSS máximo 2.924.105.728 bytes (~2,72 GiB).

### Diferencia frente a los 931.048 originales

- Se omitieron `29522179` y `7807037`: ni title ni title_without_series estaban
  disponibles. No se inventó el nombre de una edición.
- Se omitieron dos enlaces de autor y dos de género de esos libros.
- Un autor no quedó asociado a libros elegibles.
- Las obras sin título recuperable no se fabricaron: 12.142 libros locales quedaron
  con work_id nulo. Hay 10.033 obras de los libros elegibles sin un título utilizable,
  además de dos casos del archivo global ligados a los libros omitidos.
- 4.011 valores de páginas no positivos y 38 años fuera de 1–9999 fueron normalizados
  a NULL; 1.053.974 participaciones sin role se expresan como unspecified.
- Las diez etiquetas temáticas son distintas de las seis fuentes de procedencia;
  no se dividieron arbitrariamente las etiquetas compuestas con comas.

### Metadatos incompletos en los libros locales

| Campo nulo | Libros |
|---|---:|
| description | 103.563 |
| isbn | 352.180 |
| isbn13 | 274.152 |
| language_code | 366.528 |
| publication_year | 209.740 |
| num_pages | 274.293 |
| image_url | 0 |
| work_id | 12.142 |

Que image_url no sea NULL no significa que todas las URLs sean portadas originales:
el origen incluye placeholders. Se verificó la igualdad de todas las URLs con el
Parquet y una URL representativa devolvió 200 con Content-Type image/jpeg. No se
descargaron 931.046 imágenes ni se ejecutó una prueba visual de frontend.

## 3. ETL: pausa, recuperación, repetición y preservación

En base desechable:

1. Importación real pausada tras tres lotes: géneros y 10.000 obras confirmadas,
   sin libros ni ejemplares todavía.
2. Reanudación desde el checkpoint hasta completar las seis tablas bibliográficas.
   El tramo inicial tardó 9,70 s y el tramo reanudado 161,24 s.
3. Flujos HTTP sobre los libros importados, con registros operativos de prueba.
4. Alta de un libro manual sin Goodreads ID y corrección manual de título/descripcion
   de un registro importado, conservando sus relaciones.
5. Reejecución completa **con --restart**, no solo salto de fases por checkpoint:
   1.189 lotes visitados, cero filas afectadas por los merges, delta cero en las tablas.
   Duración 82,40 s, RSS máximo ~2,34 GiB.
6. Comparación de digests antes/después: cinco usuarios, cuatro ejemplares, siete
   solicitudes, cuatro préstamos, una renovación, cuatro reservas y sus preferencias,
   calificación e interacción preservados. El libro manual y la corrección curada
   permanecieron intactos.

La prueba Python adicional inyectó un fallo de persistencia durante el lote de
libros, confirmó rollback sin inserciones parciales y reanudó después de retirar
el fallo. También comprueba tipos de esquema, ceros iniciales, nombres curados,
roles desconocidos y relación a obra no recuperable.

No hay ejemplares ficticios en la base operativa: book_copies permanece en cero.

## 4. Catálogo mediante la API Go

Validado por HTTP del contenedor Go sobre el catálogo completo de prueba:

- Búsqueda por Harry Potter con resultados importados.
- Filtro combinado por autor y género, verificando las relaciones de cada resultado.
- Páginas por cursor sin IDs repetidos y equivalencia con offset sobre datos estables.
- Rechazo de cursor combinado con offset distinto de cero.
- Detalle individual: title, description, isbn, isbn13, language_code, publication_year,
  num_pages, image_url y goodreads_book_id coinciden con PostgreSQL.
- Goodreads ID es string y no se sustituye por la PK local.
- Sin ejemplares: visible en catálogo, calificable y recomendable, pero solicitud
  y reserva rechazadas con 409 sin persistir filas.
- Con ejemplar disponible: conteos y banderas derivadas correctos.
- Todos prestados: has_copies=true, available_copies=0 y loaned_copies=1; permite reserva.

Las pruebas de integración cubren también filtros de inventario, altas concurrentes
con reserva, cursor, copias reservadas y no circulantes. No se añadió un campo
persistente available ni se cambió la lógica del backend durante esta auditoría.

## 5. Circulación y concurrencia

Flujo real HTTP y PostgreSQL desechable sobre libros recomendados/importados:

| Comprobación | Resultado |
|---|---|
| Sin copias: solicitud y reserva | 409, sin registros nuevos |
| Copia disponible: solicitud | pending, no ocupa aún el ejemplar |
| Segunda pending mismo lector/libro | 409 |
| Entrega por lector | 403 |
| Entrega por bibliotecario real | approved y préstamo activo, 30 días UTC |
| Libro completamente prestado | dos lectores pudieron reservar, ambos waiting |
| Devolución por lector | 403 |
| Devolución por bibliotecario | primer lector ready por FIFO, 72h, actor manual correcto |
| Intento de entregar a otro lector una copia ready | 409, solicitud no aprobada |
| Recogida | solicitud creada/aprobada automáticamente, préstamo y fulfilled enlazados |
| Segunda recogida de la misma reserva | 409 |
| Asignación automática | system, assigned_by=NULL |
| Expiración por el worker real | expired y siguiente lector ready, observados en 41,02 s |
| GET frente a reserva caducada | no cambió filas ni liberó copias |
| Tercer préstamo con dos activos | 409, permanecieron dos activos |
| Renovación aprobada y segunda solicitud | primera correcta, segunda 409 |
| Préstamo vencido simulado | impidió nueva solicitud y renovación |
| Fallo tras aprobar solicitud, antes de insertar préstamo | 500 controlado y rollback a pending, sin préstamo parcial |

La expiración se simuló desplazando fechas únicamente en la base de prueba. Para
probar GET sin confundirlo con el worker, se retuvo el bloqueo del libro en otra
transacción: las lecturas respondieron sin modificar el fingerprint; tras liberarlo,
el worker procesó el vencimiento. Los índices no mostraron dobles préstamos activos.

La suite Go con race cubrió además dos entregas al mismo ejemplar, entregas que
superarían el límite del lector, dos asignadores y renovación concurrente con una
reserva. SQL adicional en la base desechable encontró cero copias con dos reservas
ready y cero solapamientos entre préstamo activo y hold ready. No es una prueba
exhaustiva de todas las intercalaciones o una prueba de carga.

## 6. Inferencia real: scores, IDs y persistencia

Con los servicios PostgreSQL, Go y FastAPI funcionando:

- Se registraron lectores de prueba y se seleccionó un género existente del catálogo.
- Go y una llamada Python directa recibieron exactamente la misma entrada de texto.
- Orden, Goodreads IDs, modelo, scope y valores numéricos de score coincidieron
  exactamente antes/después del enriquecimiento, tanto sin ratings como con un rating positivo.
- Diez resultados, **diez correspondencias locales**; lista de no correspondencias vacía.
- Inicialmente los diez estaban sin ejemplares: local_book_id presente, in_local_catalog=true,
  available=false y available_copies=0. No se equiparó pertenencia con disponibilidad.
- Se persistieron una calificación (actualizada de 4 a 5) y un recommendation_click
  sobre un libro importado sin inventario. Se consultó el historial y se comprobó aislamiento.
- La misma edición pasó después por inventario y circulación: no se creó un espejo
  bibliográfico para forzar la correspondencia.

Ejemplos reales de esta ejecución (los IDs locales siguientes son de la base
**desechable**, no se deben copiar a la operativa):

| Goodreads ID | Título | ID local de prueba | Score | Scope |
|---|---|---:|---:|---|
| 21189986 | Angeions | 369048 | 1.0 | content_catalog |
| 35024542 | Dragonhunters | 694155 | 1.0 | content_catalog |
| 20733501 | Drachenkrypta | 357201 | 1.0 | content_catalog |

Estos scores no son probabilidades ni una demostración de calidad: una preferencia
temática amplia puede producir empates. El backend no los reajusta ni filtra Top-K
para simular ranking local. Los libros leídos no se excluyen automáticamente en la
operación textual. Los casos externos se conservan sin asociación inventada y se
probaron con FastAPI simulado, aunque no aparecieron en este Top-K real.

## 7. Seguridad

Pasaron registro solo lector, ocultamiento de hash, JWT válido/manipulado,
cuenta desactivada, acceso sin token, rol de lector/bibliotecario/administrador,
prohibición de autoasignación de rol y privacidad de ratings, eventos, préstamos y reservas.
Se añadieron casos JWT vencido, sin expiración, emisor incorrecto y algoritmo distinto.

La indisponibilidad se reprodujo con otra instancia Go desechable apuntando a un
destino HTTP inaccesible: recomendaciones devolvió 503, perfil y préstamos 200.
No se detuvo el FastAPI compartido. Unitarias httptest cubren también timeout,
respuestas no exitosas, JSON inválido, versión/scope incorrectos y límites.

### Preservación de la base operativa

Al inicio había un usuario, una preferencia y una interacción. Los fingerprints
posteriores confirmaron preservación de todos los registros iniciales. Durante la
auditoría se observó una segunda interacción concurrente de la instancia operativa,
también conservada. Las herramientas operativas solo ejecutaron lecturas; no se
atribuyó ese evento al importador ni se eliminó como si fuera una fixture.

Al cerrar: un usuario existente, cero copias, cero solicitudes, cero préstamos,
cero reservas y cero calificaciones de prueba. La comparación de prefijos ordenados
se registra en main_after.json; no se almacenan emails, tokens ni hashes de contraseña
en el informe público.

## 8. Rendimiento medido

Mediciones locales individuales, con caché y volumen real. No son capacidad máxima,
percentiles de producción ni carga sostenida.

### SQL exacto del catálogo Go

`TestImportedCatalogPlans` ejecutó EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) sobre
**bookPageQuery real**, incluidas relaciones y los conteos de inventario, en la
base desechable completa. Se guardaron los planes completos.

| Caso | Servidor | Roundtrip observado |
|---|---:|---:|
| Primera página de 20 | 0,781 ms | 4,668 ms |
| Título Harry Potter | 8,054 ms | 10,467 ms |
| Offset 900.000 | 316,670 ms | 318,275 ms |
| Cursor > 900.000 | 0,313 ms | 2,243 ms |
| Autor | 5,516 ms | 7,836 ms |
| Género | 0,382 ms | 2,115 ms |
| Con copias | 0,564 ms | 2,209 ms |
| Sin copias | 0,402 ms | 2,236 ms |
| Disponibles | 0,683 ms | 2,849 ms |

Se observaron books_title_trgm_idx, books_pkey, book_authors_author_book_idx y
book_genres_genre_book_idx en los planes correspondientes. Se midieron además
consultas representativas simplificadas en la base operativa, siempre de lectura:
primera página 0,023 ms; título 7,627 ms; detalle 0,019 ms; offset profundo 290,903 ms;
cursor 0,037 ms. No confundir esos SELECT simplificados con el SQL completo ni con HTTP.

### HTTP real y recursos

| Operación | Observado |
|---|---:|
| Primera página HTTP | 4,010 ms |
| Siguiente página por cursor | 2,493 ms |
| Búsqueda HTTP por título | 13,986 ms |
| Detalle HTTP importado | 2,291 ms |
| Recomendación Go → FastAPI → Go | 1.074,748 ms |
| Recomendación con rating positivo | 969,305 ms |
| Similares Go → FastAPI → Go | 1.027,744 ms |
| Inferencia inaccesible → Go 503 | 7,336 ms |
| Perfil con inferencia inaccesible | 0,898 ms |

Tamaño operativo de base: **1.819.227.827 bytes (~1,69 GiB)**, sin WAL externo al
tamaño de la base. Principales relaciones, incluidos índices/TOAST:

| Tabla | Datos | Índices | Total |
|---|---:|---:|---:|
| books | 923.598.848 | 236.617.728 | 1.160.216.576 bytes |
| book_genres | 129.253.376 | 203.071.488 | 332.324.864 bytes |
| book_authors | 81.207.296 | 143.794.176 | 225.001.472 bytes |
| works | 38.174.720 | 23.052.288 | 61.227.008 bytes |
| authors | 16.801.792 | 12.394.496 | 29.196.288 bytes |

Snapshot Docker: PostgreSQL ~401,6 MiB, Go ~7,4 MiB y FastAPI ~2,49 GiB en cgroup.
RSS del proceso Python: 2.596.225.024 bytes (~2,42 GiB), máximo observado de ese
proceso 3.773.997.056 bytes (~3,51 GiB). No sumar sin más RSS y cgroup: son medidas distintas.
La importación operativa histórica tardó 164,74 s (informe previo); esta auditoría
no la repitió sobre la operativa.

## 9. Pruebas fallidas y correcciones

**No hubo fallos funcionales de producto en los escenarios finales ejecutados.**
Los 400/401/403/409/500/503 inducidos son rechazos esperados; el 500 del trigger
de fallo demostró rollback, no una caída espontánea.

Sí fallaron intentos iniciales de la **herramienta nueva de auditoría**:
1. read_only/isolation_level como argumentos de conexión psycopg, corregidos a
   propiedades de conexión antes de iniciar la transacción.
2. Columnas sin alias en la proyección fuente, corregidas con nombres explícitos.
3. EXCEPT global de descripciones agotó 2 GB. Se sustituyó por igualdad exacta en
   32 buckets de clave, se añadió prueba de regresión con filas modificadas/faltantes/
   extra y se volvió a ejecutar el contraste completo satisfactoriamente.
4. Se identificó que la reimportación del harness podía heredar una
   CATALOG_DATABASE_URL ajena a la conexión test_* comprobada. Se fijó explícitamente
   su destino a esa conexión, con dos regresiones y una ejecución controlada donde
   la variable ambiental apuntaba a la operativa: el importador siguió usando solo
   la base desechable y no cambió filas. No fue un fallo del backend productivo.

No se modificaron controllers, servicios, repositorios de producción ni migraciones
para obtener resultados verdes. Los cambios de código son scripts y pruebas de auditoría.

## 10. Suites y reproducción

Ejecutado: go test ./..., go vet ./..., integración PostgreSQL completa con race y
TEST_IMPORTED_CATALOG=true, y **24 pruebas de la suite Python más dos regresiones
adicionales satisfactorias**, sin omisiones en la ejecución con la DSN de integración.
El plan SQL se midió además aisladamente,
fuera de las escrituras concurrentes de las otras fixtures.

Para repetir (desde raíz, PostgreSQL e inferencia levantados, variables PG* locales
configuradas sin contraseñas en el repositorio):

```bash
# Operativa: solo lectura; no establecer PGDATABASE=test_* por error en esta fase.
PGDATABASE=alejandria python src/data/audit_catalog.py --snapshot-only \
  --report data/reports_audit/main_before.json
PGDATABASE=alejandria python src/data/audit_catalog.py \
  --report data/reports_audit/full_coherence.json

# Base nueva test_*; nunca aplicar fixtures a alejandria.
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" test_post_import_audit'
docker compose exec -e PGDATABASE=test_post_import_audit backend /app/tern migrate
PGDATABASE=test_post_import_audit python src/data/import_catalog.py --restart --stop-after-batches 3 \
  --state-file data/reports_audit/test_import_state.json --report data/reports_audit/test_import_pause.json
PGDATABASE=test_post_import_audit python src/data/import_catalog.py \
  --state-file data/reports_audit/test_import_state.json --report data/reports_audit/test_import_complete.json
docker compose run -d --no-deps --name alejandria-audit-backend \
  -p 127.0.0.1:18080:8080 -e APP_DATABASE_NAME=test_post_import_audit \
  -e PGDATABASE=test_post_import_audit backend
PGDATABASE=test_post_import_audit python alejandria-backend/scripts/post_import_audit.py \
  --report data/reports_audit/http_workflows.json \
  --state-file data/reports_audit/test_import_state.json \
  --reimport-report data/reports_audit/test_full_reimport.json
```

El script HTTP requiere cero usuarios iniciales en la base de prueba, hace bootstrap
por stdin con credenciales aleatorias y se niega a conectar con una base sin prefijo
test_* o distinta de la del contenedor. No imprime tokens ni emails. --compose-env
selecciona archivo de entorno (la ejecución local utilizó .env.example).

```bash
# Desde alejandria-backend, con URL real de la base desechable:
go test ./...
go vet ./...
TEST_IMPORTED_CATALOG=true TEST_DATABASE_URL='postgres://USUARIO:CLAVE@localhost:5432/test_post_import_audit' \
  go test -tags=integration -race -count=1 ./...
# Para evidencias de planes, ejecutar solo internal/catalog con AUDIT_PLAN_REPORT absoluto.
```

La integración Python del ETL requiere **otra base test_* vacía** migrada a 9:

```bash
CATALOG_TEST_DATABASE_URL='postgres://USUARIO:CLAVE@localhost:5432/test_post_import_etl' \
  python -m pytest -q
```

Usar una base nueva y un checkpoint nuevo o --restart al repetir todo el procedimiento;
los checkpoints guardados incluyen el OID de la base anterior. Nunca exportar la URL
operativa como CATALOG_TEST_DATABASE_URL.

Evidencia local en data/reports_audit/: full_coherence.json, main_before/after.json,
http_workflows.json, test_import_pause/complete.json, test_full_reimport.json,
performance_sql.json y plans_exact.json. Los informes grandes quedan ignorados por
Git; este resumen versionable no contiene información personal de usuarios reales.
Al terminar, eliminar solo los contenedores y bases de prueba creados por la auditoría.

## 11. Riesgos y pendientes antes de conectar el frontend

- **Inventario real aún vacío**: 931.046 libros bibliográficos no habilitan préstamos.
  El personal debe registrar los ejemplares existentes, sin simular stock.
- El frontend debe distinguir ID local/Goodreads y has_copies/available. Debe manejar
  409 de circulación, configuración de intereses y fallos 502/503/504 sin romper otras pantallas.
- No se probó carga sostenida, disponibilidad prolongada, backups/restauración ni
  todos los interleavings posibles. Los resultados de race no reemplazan una evaluación de capacidad.
- Usar cursor: offset profundo sigue costando ~300 ms. Búsquedas muy cortas pueden
  no beneficiarse del trigram.
- FastAPI sigue necesitando minutos para cargar y gigabytes de RAM, un worker y
  límites de concurrencia. El Top-K global enriquecido no es un ranking local ni
  excluye automáticamente lo leído; empates y metadatos escasos limitan calidad.
- Portadas dependen de un CDN externo; una muestra HTTP válida no garantiza todas
  las URLs ni renderizado real en navegador. No se hizo trabajo visual de frontend.
- Antes de publicar fuera del entorno local: secretos propios, HTTPS y límites de
  intentos de autenticación. No hay refresh/logout con revocación individual ni recuperación
  de contraseña implementados. No se validó un procedimiento completo de recuperación del último admin.
- No hay claves HTTP de idempotencia ni garantías exactly-once ante pérdidas de
  respuesta después de commit. Las restricciones SQL y los estados siguen siendo necesarias.
- Los checkpoints ETL son recuperación de una ejecución, no sincronización continua.
  Correcciones curadas no se sobrescriben; cambiar esa política exige una decisión explícita.
- El comparador de origen es estricto: una diferencia futura puede ser una corrección
  manual legítima. La herramienta informa diferencias y nunca las sobreescribe.

**Dictamen:** backend validado para continuar la integración del frontend en entorno
local con estas limitaciones explícitas; no equivale a certificación de producción
ni a evaluación de calidad estadística del recomendador.
