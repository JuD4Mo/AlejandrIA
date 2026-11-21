# Alejandría — frontend

React 18 + Vite + TypeScript client for the Alejandría library API (`/api/v1`).
Tailwind v4, TanStack Query, React Router, Radix Dialog, react-hook-form + zod.

## Run

### Docker Compose (desde la raíz del repositorio)

Con .env configurado, artefactos V2 presentes y PostgreSQL migrado:

```bash
docker compose up -d --build --wait --wait-timeout 600
```

Abrir **http://127.0.0.1:3000** (`FRONTEND_PORT` permite cambiarlo). La imagen
multietapa compila con Node 24 y sirve dist con Nginx. `/api/v1` se reenvía a Go
por la red interna, conservando Authorization; las recargas de rutas SPA funcionan.
No se necesitan instalaciones npm en el host para esta modalidad y no hay HMR.

Primera instalación, migraciones explícitas, puertos y pruebas de orquestación:
[docs/docker-compose.md](../docs/docker-compose.md).

### Desarrollo con Vite

```bash
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api` to `http://127.0.0.1:8080` (see `vite.config.ts`),
so start the Go backend first (see `../docs/docker-compose.md` and
`../docs/backend`). Calls are same-origin through the proxy; no CORS setup is
needed in development.

| Script              | What it does                    |
| ------------------- | ------------------------------- |
| `npm run typecheck` | `tsc --noEmit`                  |
| `npm run lint`      | ESLint                          |
| `npm test`          | Vitest (jsdom)                  |
| `npm run build`     | Typecheck + production build    |

Compose utiliza el mismo origen para UI y API mediante el proxy Nginx. No requiere
habilitar CORS adicional para ese flujo.

## Generar nuevas recomendaciones

En Inicio, debajo de «Recomendaciones para ti», el botón **Generar nuevas
recomendaciones** hace POST a `/api/v1/users/me/recommendations/refresh` enviando
los IDs visibles, incluso si la caché sigue fresca. Muestra «Generando recomendaciones…»
y se deshabilita mientras hay una petición activa. Los resultados previos permanecen
visibles durante la consulta; ante errores transitorios se conservan con un aviso.

El backend excluye libros valorados, prestados y las últimas 500 recomendaciones
registradas por cuenta. El historial persiste en PostgreSQL (migración 010).
La selección cambia por exclusiones, sin alterar scores ni reentrenar. Si no quedan
coincidencias positivas se muestra el agotamiento, sin rellenar con libros arbitrarios.
Sin intereses utilizables, Go indica que deben configurarse preferencias.
Detalles: [renovación de recomendaciones](../docs/backend/renovacion_recomendaciones.md).

## Roles and routes

The JWT is kept in `sessionStorage` (`alejandria.token`).

- **Lector** — `/` (home, recommendations, favourites, recently viewed),
  `/catalog`, `/books/:id`, `/me/circulation`, `/me/preferences`, `/me/ratings`.
- **Bibliotecario** — `/staff/requests`, `/staff/loans`, `/staff/renewals`,
  `/staff/reservations`, `/staff/catalog` (books, copies, works, authors, genres).
- **Administrador** — everything above plus `/admin/users`.

New readers see the onboarding ("constelación") once; its answers map to the
ten Goodreads genre labels and are saved as preferences.

## Notes on the data

- Genres are stored with their Goodreads labels (`"fantasy, paranormal"`…) and
  translated for display only (`src/lib/genres.ts`).
- The catalogue is large (~931k books, ~268k authors), so the catalogue uses
  keyset pagination (`after_id` / `next_after_id`), the author filter comes from
  a book's author link, and the book form takes work/author **IDs** with a live
  name lookup instead of drop-downs.
- Favourites have no list endpoint; they are derived from the latest
  `favorite_added` / `favorite_removed` interaction per book
  (`src/hooks/useFavorites.ts`).
