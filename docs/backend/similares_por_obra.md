# Libros similares: diversidad por obra

## Caso reproducido

El libro local 132502 corresponde al Goodreads book_id `13564701`, título
*Harry Potter and the Half-Blood Prince*, año 2012 e ISBN 1781100055.
Su work_id original es `41335427` (obra local 262337).

Antes del cambio, los diez resultados de similares eran otras ediciones de esa
misma obra. Por ejemplo, book_id `17347380` (2013, ISBN 0545582997), `2073648`
(2005, ISBN 0307283674) y `1138943` (2005, ISBN 0439791324). Sus puntuaciones
eran aproximadamente 0,985, 0,980 y 0,975: el índice encontraba textos muy similares,
pero la selección excluía solo el book_id abierto, no su obra.

## Regla aplicada

En `RecommendationEngine.recommend_similar`:

1. Se calculan las mismas similitudes TF-IDF/coseno.
2. Se excluyen el libro semilla y todas las ediciones con su work_id conocido.
3. Se ordenan coincidencias positivas y finitas por score descendente, con empates
   estables por content_row.
4. Se selecciona como máximo una edición por cada work_id conocido: la de mayor
   similitud entre sus candidatos. Se continúa buscando hasta completar K o agotar
   coincidencias elegibles; no se filtra únicamente una lista Top-K ya truncada.

Los IDs se conservan como texto, incluidos sus ceros iniciales. Los metadatos de
obra se alinean explícitamente con content_row. Cuando falta work_id (nulo o
vacío), cada book_id se conserva como entidad independiente: no se fusionan libros
por títulos iguales ni se inventan relaciones. Un Parquet antiguo sin esa columna
puede seguir utilizándose con esa política conservadora.

No se alteran catálogo, ISBN, años, ejemplares, Parquet ni artefactos entrenados.
La obra y sus ediciones permanecen consultables en el catálogo bibliotecario.
La regla afecta a **Libros similares**, no cambia la política de los rankings
personales colaborativos, híbridos o de preferencias ni sus métricas históricas.

## Interpretación

Otros volúmenes de Harry Potter pueden aparecer: son obras distintas y comparten
contenido, autor y temas. Este agrupamiento no impone límites por autor o serie.
Un work_id incorrecto en la fuente puede limitar la agrupación; el título solo no
se considera una identidad fiable.

## Pruebas

Fixture sintético con varias ediciones de la obra semilla y de otra obra, IDs de
obra `0001` y `1`, metadatos en orden físico inverso al índice, títulos iguales
sin obra identificada, empates y contenido sin coincidencias. Comprueba exclusión
de la obra semilla, selección de la mejor edición, continuidad más allá del Top-K
original, puntuaciones intactas y ausencia de relleno con similitud cero.

## Verificación operativa

Se desplegó el cambio y se consultaron por el proxy frontend → Go → FastAPI los
libros locales 132502 y 235330 (otra edición, book_id `17347380`). Cada petición
de diez resultados devolvió diez work_id conocidos distintos y ninguno era
`41335427`; todos los scores eran positivos. El híbrido personal y la consulta
de historial histórico continuaron respondiendo correctamente.

La nueva lista sigue muy concentrada en Harry Potter e incluye guías de estudio,
colecciones y un libro deluxe al que la fuente asigna otro work_id. Esto muestra
que la identidad de obra corrige el caso de reediciones comprobadas, pero no
garantiza diversidad de saga/autor ni resuelve por sí sola clasificaciones de la
fuente. No se afirma una mejora de Precision@K/Recall@K con esta prueba.

Pasaron 16 pruebas Python API/inferencia y 45 pruebas frontend, typecheck, lint y
las compilaciones Docker de frontend e inferencia. El texto explicativo actualizado
también se comprobó en el bundle servido.
