# Inventario inicial de Alejandría

## Carga solicitada

El 2026-11-20 se configuró inventario normal y persistente de **1 a 3 ejemplares
por libro**, según la cantidad solicitada por el operador. No son filas especiales
de demostración y participan en el funcionamiento ordinario de la biblioteca.

Las cantidades se distribuyen de forma determinista a partir del ID interno: no
proceden de Goodreads ni de la IA. Su finalidad es configurar el inventario inicial
de esta instalación; no representan una verificación física externa de activos.

| Resultado | Cantidad |
|---|---:|
| Libros revisados | 931.046 |
| Ejemplares registrados | **1.861.535** |
| Libros con 1 ejemplar | 311.019 |
| Libros con 2 ejemplares | 309.565 |
| Libros con 3 ejemplares | 310.462 |
| Libros sin ejemplares tras carga | 0 |

Todos los ejemplares nuevos se registraron como `circulating`, con códigos únicos
`ALJ-{book_id}-{ordinal}` y ubicación NULL, sin inventar estantes. `acquired_at`
utiliza el valor predeterminado del esquema al registrarlos. La disponibilidad
posterior sigue dependiendo de préstamos y reservas, no solo de ese estado físico.

## Ejecución explícita e idempotencia

Programa: `src/data/initialize_inventory.py`. Usa PostgreSQL directamente y lotes
de 5.000 libros; no se ejecuta durante el arranque ni como migración.

```bash
# Entorno goodreads-eda, conexión PG* propia configurada:
export PGDATABASE=alejandria
python src/data/initialize_inventory.py --batch-size 5000 \
  --report data/reports_inventory/initial.json
```

- Bloquea los libros en orden antes de añadir copias, compatible con inventario y circulación.
- Conserva ejemplares existentes, códigos, ubicaciones, condiciones y préstamos.
- Añade solo la cantidad que falte hasta el objetivo estable de cada libro.
- No retira ejemplares si un libro ya tiene más que el objetivo.
- Una repetición no duplica stock: la segunda ejecución añadió **0 filas**.
- Se puede repetir tras una interrupción; los lotes confirmados permanecen y no se recrean.

La carga inicial duró **49,95 s** y la segunda pasada **11,12 s**, sin cambios.
Informes locales: data/reports_inventory/initial.json y repeated.json.
La prueba PostgreSQL desechable comprobó límites, repetición y conservación de un
ejemplar previo en mantenimiento con su código y ubicación originales.

## Consecuencias en la aplicación

Los libros importados ya tienen inventario y pueden entrar en solicitudes/reservas.
Las reglas siguen vigentes: el lector solicita; el personal entrega/devuelve;
máximo dos préstamos activos, cola FIFO y disponibilidad calculada. No se crearon
cuentas ni se asignaron roles como parte de esta carga.

Los informes anteriores que registran cero ejemplares describen el estado posterior
al ETL bibliográfico, antes de esta operación de inventario. El ETL Goodreads sigue
sin crear copias automáticamente.

## Corrección de rendimiento detectada

Con 1,86 millones de copias, el filtro negativo `NOT IN (SELECT book_id FROM
book_copies)` eligió un subplan materializado y superó un timeout de 2 s. Se cambió
`has_copies=false` y `available=false` a `NOT EXISTS` correlacionado, conservando su
semántica. PostgreSQL pudo usar anti-join e índice book_copies_book_status_idx.
La consulta representativa de ausencia completó en **408 ms** sobre todo el catálogo.
Se añadió una regresión para distinguir inexistencia, disponibilidad y ocupación.
No hubo cambios de esquema, modelos de ML ni reglas de circulación.
