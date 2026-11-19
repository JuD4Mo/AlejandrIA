import { useEffect, useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import { LibrarySpines } from "@/components/LibrarySpines";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es, interpolate } from "@/i18n/es";
import { genreLabel } from "@/lib/genres";
import "./account-library.css";

const GENRE_PAGE = 50;

export function PreferencesPage() {
  useDocumentTitle(es.routeTitles.preferences);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const preferencesQuery = useQuery({
    queryKey: ["preferences", "genres"],
    queryFn: () => endpoints.personalization.preferences({ limit: 100 }),
    retry: 0,
  });

  useEffect(() => {
    if (preferencesQuery.data) {
      // The selection is editable local state seeded once from the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(
        new Set(preferencesQuery.data.data.map((preference) => preference.genre_id)),
      );
    }
  }, [preferencesQuery.data]);

  const genresQuery = useInfiniteQuery({
    queryKey: ["named", "genres", "preferences"],
    queryFn: ({ pageParam }) =>
      endpoints.named.list("genres", { limit: GENRE_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === GENRE_PAGE
        ? allPages.length * GENRE_PAGE
        : undefined,
  });

  const genres = useMemo(() => {
    const seen = new Set<number>();
    return (genresQuery.data?.pages ?? [])
      .flatMap((page) =>
        page.data.filter((genre) => {
          if (seen.has(genre.id)) return false;
          seen.add(genre.id);
          return true;
        }),
      )
      .map((genre) => ({ ...genre, label: genreLabel(genre.value) }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [genresQuery.data]);

  const saved = useMemo(() => preferencesQuery.data?.data ?? [], [preferencesQuery.data]);
  const dirty =
    preferencesQuery.isSuccess &&
    (saved.length !== selected.size || saved.some((preference) => !selected.has(preference.genre_id)));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["preferences"] });
    void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      endpoints.personalization.replacePreferences([...selected]),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setMessage(es.personalization.preferencesSaved);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const clearMutation = useMutation({
    mutationFn: () => endpoints.personalization.clearPreferences(),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: () => {
      setSelected(new Set());
      setMessage(es.personalization.preferencesCleared);
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const removeOneMutation = useMutation({
    mutationFn: (input: { id: number; name: string }) =>
      endpoints.personalization.deletePreference(input.id),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: (_, input) => {
      setSelected((current) => {
        const next = new Set(current);
        next.delete(input.id);
        return next;
      });
      setMessage(interpolate(es.personalization.preferenceRemoved, { name: input.name }));
      invalidate();
    },
    onError: (error) => setActionError(error),
  });

  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
    setMessage(null);
  };

  return (
    <div className="preferences-page mx-auto max-w-4xl">
      <PageHeader
        title={es.personalization.preferencesTitle}
        description={es.personalization.preferencesIntro}
      />
      <LibrarySpines />

      {message ? (
        <p
          role="status"
          className="notice notice--success mb-4"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorState error={actionError} compact />
        </div>
      ) : null}

      <section className="mb-6" aria-labelledby="saved-genres">
        <h2 id="saved-genres" className="mb-2 text-[0.78rem] font-semibold text-fg-subtle">
          {es.personalization.savedTitle}
        </h2>
        {saved.length ? (
          <ul className="m-0 flex flex-wrap gap-2 p-0">
            {saved.map((preference) => {
              const name = genreLabel(preference.name);
              return (
                <li key={preference.genre_id} className="list-none">
                  <button
                    type="button"
                    className="chip"
                    disabled={removeOneMutation.isPending}
                    aria-label={interpolate(es.personalization.removeOne, { name })}
                    onClick={() => removeOneMutation.mutate({ id: preference.genre_id, name })}
                  >
                    {name}
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-[0.84rem] text-fg-muted">
            {preferencesQuery.isPending ? es.common.loading : es.personalization.savedNone}
          </p>
        )}
      </section>

      <div className="preferences-toolbar mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <p className="m-0 font-tabular text-[0.82rem] text-fg-subtle">
          {es.personalization.selected.replace("{{count}}", String(selected.size))}
          {dirty ? <span className="ml-2 text-warning">· {es.personalization.unsaved}</span> : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={preferencesQuery.isPending || !dirty}
          >
            {es.personalization.savePreferences}
          </Button>
          <ConfirmDialog
            trigger={
              <Button
                variant="secondary"
                disabled={saved.length === 0 || clearMutation.isPending}
              >
                {es.personalization.clearPreferences}
              </Button>
            }
            title={es.personalization.clearConfirm}
            destructive
            onConfirm={() => clearMutation.mutateAsync()}
            loading={clearMutation.isPending}
          />
        </div>
      </div>

      {preferencesQuery.isPending || genresQuery.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : preferencesQuery.isError ? (
        <ErrorState
          error={preferencesQuery.error}
          onRetry={() => void preferencesQuery.refetch()}
        />
      ) : genresQuery.isError ? (
        <ErrorState
          error={genresQuery.error}
          onRetry={() => void genresQuery.refetch()}
        />
      ) : genres.length === 0 ? (
        <EmptyState
          title={es.personalization.noGenres}
          body={es.personalization.noGenresHint}
          className="library-empty"
        />
      ) : (
        <>
          <div className="genre-ledger grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {genres.map((genre) => {
              const checked = selected.has(genre.id);
              return (
                <label
                  key={genre.id}
                  className={`genre-option flex cursor-pointer items-center gap-3 text-[0.88rem]${checked ? " is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(genre.id)}
                    disabled={!checked && selected.size >= 100}
                    className="size-4 accent-[#6b2024]"
                  />
                  <span className="min-w-0">{genre.label}</span>
                </label>
              );
            })}
          </div>
          {genresQuery.hasNextPage ? (
            <div className="mt-6 flex justify-center border-t border-line pt-5">
              <Button
                variant="secondary"
                onClick={() => void genresQuery.fetchNextPage()}
                loading={genresQuery.isFetchingNextPage}
              >
                {es.personalization.loadMoreGenres}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
