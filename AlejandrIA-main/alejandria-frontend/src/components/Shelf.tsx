import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Book } from "@/api/types";
import { Cover } from "@/components/ui/Cover";
import { es } from "@/i18n/es";
import { cn } from "@/lib/cn";

const SPINE_GAP = 10;
const MIN_SPINE_WIDTH = 42;

export function Shelf({ books, view }: { books: Book[]; view: "shelf" | "list" }) {
  const shelfRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(8);

  useEffect(() => {
    const element = shelfRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setColumns(Math.max(1, Math.floor((element.clientWidth + SPINE_GAP) / (MIN_SPINE_WIDTH + SPINE_GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (view === "list") {
    return (
      <ul className="divide-y divide-[rgba(27,26,23,0.18)] border-y border-[rgba(27,26,23,0.24)] bg-ficha p-0 text-ink">
        {books.map((book) => (
          <li key={book.id} className="list-none">
            <Link
              to={`/books/${book.id}`}
              className="flex items-baseline justify-between gap-4 px-4 py-3 no-underline hover:bg-[#ded9ca] focus:bg-[#ded9ca]"
            >
              <span className="font-display text-lg">{book.title}</span>
              <span className="typewriter shrink-0 text-xs opacity-70">
                {book.publication_year ?? es.book.year}
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
    <div ref={shelfRef} className="shelf-wall space-y-5 p-3 sm:p-5" aria-label="Estantería de libros">
      {rows.map((row, rowIndex) => (
        <section className="shelf-plank" key={`row-${rowIndex}`} aria-label={`Estante ${rowIndex + 1}`}>
          <ul className="flex min-h-[220px] items-end justify-center gap-[10px] p-0" style={{ listStyle: "none" }}>
            {row.map((book, index) => (
              <li className="spine-stock list-none" style={{ animationDelay: `${Math.min(index, 30) * 18}ms` }} key={book.id}>
                <Link
                  to={`/books/${book.id}`}
                  className={cn("group block rounded-[2px] p-1 focus:bg-[rgba(246,215,122,0.2)]")}
                  aria-label={book.title}
                >
                  <Cover title={book.title} size="md" className="transition-transform duration-200 group-hover:-translate-y-3 group-hover:rotate-[4deg] group-focus:-translate-y-3 group-focus:rotate-[4deg]" />
                  <span className="sr-only">{book.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
