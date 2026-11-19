import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Book } from "@/api/types";
import { Cover } from "@/components/ui/Cover";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { es, interpolate } from "@/i18n/es";
import { cn } from "@/lib/cn";

const SPINE_GAP = 10;
// Widest "md" Cover (54px design - 4px) plus the link's p-1 padding. Using a
// smaller slot made rows overflow and the centred row clipped its first spine.
const MIN_SPINE_WIDTH = 58;

export function Shelf({ books, view }: { books: Book[]; view: "shelf" | "list" }) {
  const shelfRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(8);

  useEffect(() => {
    const element = shelfRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Usable width = wall content box minus the plank's horizontal padding (2rem).
      const style = window.getComputedStyle(element);
      const inner =
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 32;
      setColumns(Math.max(1, Math.floor((inner + SPINE_GAP) / (MIN_SPINE_WIDTH + SPINE_GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // Re-measure when switching back from the list view (the ref was null).
  }, [view]);

  if (view === "list") {
    return (
      <ul className="divide-y divide-[rgba(27,26,23,0.18)] border-y border-[rgba(27,26,23,0.24)] bg-ficha p-0 text-fg">
        {books.map((book) => (
          <li key={book.id} className="list-none">
            <Link
              to={`/books/${book.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 no-underline hover:bg-[#ded9ca] focus:bg-[#ded9ca]"
            >
              <span className="min-w-0 font-display text-lg">{book.title}</span>
              <span className="flex shrink-0 items-center gap-3">
                <StatusBadge tone={book.has_available_copies ? "good" : book.has_copies ? "warn" : "quiet"}>
                  {!book.has_copies
                    ? es.catalog.copiesNone
                    : book.has_available_copies
                      ? interpolate(es.catalog.copiesAvailable, {
                          available: book.available_copies,
                          total: book.total_copies,
                        })
                      : es.catalog.copiesBusy}
                </StatusBadge>
                <span className="typewriter text-xs text-fg-subtle">
                  {book.publication_year ?? "—"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  const rows: Book[][] = [];
  for (let index = 0; index < books.length; index += columns) rows.push(books.slice(index, index + columns));

  return (
    <div ref={shelfRef} className="shelf-wall space-y-5 p-3 sm:p-5" aria-label={es.catalog.shelfLabel}>
      {rows.map((row, rowIndex) => (
        <section className="shelf-plank" key={`row-${rowIndex}`} aria-label={`Estante ${rowIndex + 1}`}>
          <ul className="flex min-h-[220px] items-end justify-center gap-[10px] p-0" style={{ listStyle: "none" }}>
            {row.map((book, index) => (
              <li className="spine-stock list-none" style={{ animationDelay: `${Math.min(index, 30) * 18}ms` }} key={book.id}>
                <Link
                  to={`/books/${book.id}`}
                  className={cn("group block rounded-[2px] p-1 focus:bg-[rgba(246,215,122,0.2)]")}
                >
                  <Cover title={book.title} size="md" className="transition-transform duration-200 group-hover:-translate-y-3 group-hover:rotate-[4deg] group-focus:-translate-y-3 group-focus:rotate-[4deg]" />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mx-auto mt-2 block size-1.5 rounded-full",
                      book.has_available_copies ? "bg-lamp" : book.has_copies ? "bg-brass/60" : "bg-transparent",
                    )}
                  />
                  <span className="sr-only">
                    {book.title}.{" "}
                    {book.has_available_copies
                      ? interpolate(es.catalog.copiesAvailable, { available: book.available_copies, total: book.total_copies })
                      : book.has_copies
                        ? es.catalog.copiesBusy
                        : es.catalog.copiesNone}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
