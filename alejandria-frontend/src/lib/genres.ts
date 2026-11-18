/**
 * The imported catalogue keeps the ten Goodreads genre labels verbatim
 * (docs/database/importacion_goodreads.md §2). They are stored and sent to the
 * recommender literally, so the UI only translates them for display.
 */
export const GOODREADS_GENRES = {
  children: "Infantil",
  "comics, graphic": "Cómic y novela gráfica",
  "fantasy, paranormal": "Fantasía y paranormal",
  fiction: "Ficción",
  "history, historical fiction, biography": "Historia, ficción histórica y biografía",
  "mystery, thriller, crime": "Misterio, suspense y crimen",
  "non-fiction": "No ficción",
  poetry: "Poesía",
  romance: "Romance",
  "young-adult": "Juvenil",
} as const;

export type GoodreadsGenre = keyof typeof GOODREADS_GENRES;

export function normalizeGenre(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const labels = new Map<string, string>(
  Object.entries(GOODREADS_GENRES).map(([name, label]) => [normalizeGenre(name), label]),
);

/** Spanish label for a stored genre name; unknown (staff-created) names pass through. */
export function genreLabel(name: string): string {
  const known = labels.get(normalizeGenre(name));
  if (known) return known;
  const trimmed = name.trim();
  return trimmed.charAt(0).toLocaleUpperCase("es") + trimmed.slice(1);
}
