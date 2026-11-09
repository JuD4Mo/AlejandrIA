import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { endpoints } from "@/api/endpoints";
import type { Book } from "@/api/types";
import { es } from "@/i18n/es";
import { useNamedLabels } from "@/hooks/useNamedLabels";
import { Cover } from "./ui/Cover";

export function BookCard({ book }: { book: Book }) {
  const authorIds = useMemo(
    () => book.authors.map((author) => author.author_id),
    [book.authors],
  );
  const { labels } = useNamedLabels("authors", authorIds);
  const authors = authorIds
    .map((id) => labels.get(id))
    .filter((label): label is string => Boolean(label));
  const copiesQuery = useQuery({
    queryKey: ["copies", book.id, "availability"],
    queryFn: () => endpoints.copies.list(book.id, { limit: 1 }),
    staleTime: 30_000,
    retry: 0,
  });

  return (
    <Link
      to={`/books/${book.id}`}
      className="book-lift group flex h-full flex-col border border-[rgba(27,26,23,0.2)] bg-ficha p-4 text-ink no-underline hover:border-brass"
    >
      <div className="mb-4 flex justify-center">
        <Cover
          title={book.title}
          genres={[]}
          size="md"
          className="transition-transform duration-500 group-hover:rotate-[-1deg]"
        />
      </div>
      <div className="flex flex-1 flex-col">
        <h3 className="font-display text-xl font-semibold leading-tight text-ink group-hover:text-oxblood">
          {book.title}
        </h3>
        <p className="mt-1 text-[0.82rem] text-[rgba(243,240,250,0.66)]">
          {authors.length
            ? authors.join(", ")
            : book.publication_year
              ? String(book.publication_year)
              : es.catalog.byAuthor.replace("{{name}}", "—")}
        </p>
        <div className="mt-auto pt-3">
          {book.publication_year ? (
            <p className="m-0 font-tabular text-[0.75rem] text-[rgba(243,240,250,0.5)]">
              {es.book.year} {book.publication_year}
            </p>
          ) : null}
          <p className="m-0 mt-1 text-[0.72rem] text-[rgba(243,240,250,0.55)]">
            {copiesQuery.isPending
              ? es.catalog.availabilityLoading
              : copiesQuery.isError
                ? es.catalog.availabilityError
                : `${copiesQuery.data.available} de ${copiesQuery.data.total} ${es.book.copyAvailable.toLowerCase()}`}
          </p>
        </div>
      </div>
    </Link>
  );
}
