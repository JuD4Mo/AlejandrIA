# Alejandría — frontend

React 18 + Vite + TypeScript client for the Alejandría library API (`/api/v1`).
Tailwind v4, TanStack Query, React Router, Radix Dialog, react-hook-form + zod.

## Run

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

For a production build served from another origin, the backend CORS
configuration (`alejandria-backend/internal/middleware/global.go`) must allow
that origin.

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
