import { Link } from "react-router-dom";
import type { RecommendationItem } from "@/api/types";
import { recordInteraction } from "@/api/interactions";
import { Cover } from "@/components/ui/Cover";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { es } from "@/i18n/es";
import { cn } from "@/lib/cn";

export function RecommendationCard({
  item,
  className,
}: {
  item: RecommendationItem;
  className?: string;
}) {
  const title = item.title ?? item.local_title ?? `Goodreads ${item.goodreads_book_id}`;
  const local = item.in_local_catalog && item.local_book_id !== null;
  const body = (
    <>
      <div className="recommendation-spine-wrap">
        <Cover title={title} genres={item.genres} size="md" showInitial={false} />
      </div>
      <div className="recommendation-copy">
        <h3 className="recommendation-title group-hover:text-oxblood">{title}</h3>
        <p className="recommendation-authors">
          {item.authors.length
            ? item.authors.join(", ")
            : es.recommendations.authorsUnknown}
        </p>
        {item.genres.length ? (
          <p className="recommendation-genres">{item.genres.join(" · ")}</p>
        ) : null}
      </div>
      <div className="recommendation-statuses">
        {local ? (
          <StatusBadge tone="quiet">{es.book.addedToCatalog}</StatusBadge>
        ) : (
          <StatusBadge tone="warn">{es.recommendations.externalBadge}</StatusBadge>
        )}
        {local ? (
          item.available === true ? (
            <StatusBadge tone="good">{es.recommendations.localAvailable}</StatusBadge>
          ) : item.available === false ? (
            <StatusBadge tone="neutral">
              {es.recommendations.localUnavailable}
            </StatusBadge>
          ) : (
            <StatusBadge tone="quiet">
              {es.recommendations.localUnknown}
            </StatusBadge>
          )
        ) : null}
      </div>
    </>
  );

  const shell = cn(
    "recommendation-item group",
    className,
  );

  if (local && item.local_book_id !== null) {
    return (
      <Link
        to={`/books/${item.local_book_id}`}
        onClick={() => recordInteraction(item.local_book_id as number, "recommendation_click")}
        className={cn(shell, "book-lift no-underline")}
      >
        {body}
      </Link>
    );
  }

  return (
    <article className={cn(shell, "border-dashed")}>
      {body}
      <p className="recommendation-ghost-note">
        {es.recommendations.externalNoAction}
      </p>
    </article>
  );
}
