import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { BookInput } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/Loading";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { mapApiError } from "@/lib/errors";

const digits = (value: string) => /^\d+$/.test(value.trim());

const schema = z.object({
  title: z.string().trim().min(1, es.staff.bookForm.titleRequired),
  work_id: z.string(),
  goodreads_book_id: z
    .string()
    .refine((value) => value === "" || digits(value), "Usa solo dígitos."),
  description: z.string(),
  isbn: z.string(),
  isbn13: z.string(),
  language_code: z.string(),
  publication_year: z
    .string()
    .refine(
      (value) =>
        value === "" ||
        (digits(value) && Number(value) >= 0 && Number(value) <= 9999),
      es.staff.bookForm.yearInvalid,
    ),
  num_pages: z
    .string()
    .refine(
      (value) => value === "" || (digits(value) && Number(value) > 0),
      es.staff.bookForm.pagesInvalid,
    ),
  image_url: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface AuthorRow {
  author_id: string;
  role: string;
}

export function BookFormPage() {
  const { id } = useParams();
  const bookId = id ? Number(id) : null;
  const editing = bookId !== null;
  useDocumentTitle(
    editing ? es.routeTitles.staffBookEdit : es.routeTitles.staffBookNew,
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [authors, setAuthors] = useState<AuthorRow[]>([]);
  const [genreIds, setGenreIds] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const bookQuery = useQuery({
    queryKey: ["books", bookId],
    queryFn: () => endpoints.books.get(bookId as number),
    enabled: editing && Number.isInteger(bookId) && (bookId as number) > 0,
    retry: 0,
  });
  const worksQuery = useQuery({
    queryKey: ["named", "works", "options"],
    queryFn: () => endpoints.named.list("works", { limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const authorsQuery = useQuery({
    queryKey: ["named", "authors", "options"],
    queryFn: () => endpoints.named.list("authors", { limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const genresQuery = useQuery({
    queryKey: ["named", "genres", "options"],
    queryFn: () => endpoints.named.list("genres", { limit: 100 }),
    staleTime: 5 * 60_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      title: "",
      work_id: "",
      goodreads_book_id: "",
      description: "",
      isbn: "",
      isbn13: "",
      language_code: "",
      publication_year: "",
      num_pages: "",
      image_url: "",
    },
  });

  useEffect(() => {
    const book = bookQuery.data;
    if (!book) return;
    reset({
      title: book.title,
      work_id: book.work_id ? String(book.work_id) : "",
      goodreads_book_id: book.goodreads_book_id ?? "",
      description: book.description ?? "",
      isbn: book.isbn ?? "",
      isbn13: book.isbn13 ?? "",
      language_code: book.language_code ?? "",
      publication_year:
        book.publication_year !== null ? String(book.publication_year) : "",
      num_pages: book.num_pages !== null ? String(book.num_pages) : "",
      image_url: book.image_url ?? "",
    });
    // Hydrate editable arrays from the fetched book once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthors(
      book.authors.map((author) => ({
        author_id: String(author.author_id),
        role: author.role,
      })),
    );
    setGenreIds(new Set(book.genre_ids));
  }, [bookQuery.data, reset]);

  const mutation = useMutation({
    mutationFn: (input: BookInput) =>
      editing
        ? endpoints.books.update(bookId as number, input)
        : endpoints.books.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      navigate("/staff/catalog", { replace: true });
    },
    onError: (error) => setSubmitError(error),
  });

  const submit = handleSubmit((values) => {
    setFormError(null);
    setSubmitError(null);
    const rows = authors.filter(
      (row) => row.author_id.trim() !== "" || row.role.trim() !== "",
    );
    for (const row of rows) {
      if (!row.author_id || Number(row.author_id) <= 0) {
        setFormError(es.staff.bookForm.authorIdInvalid);
        return;
      }
      if (!row.role.trim()) {
        setFormError(es.staff.bookForm.authorRoleRequired);
        return;
      }
    }
    const input: BookInput = {
      title: values.title.trim(),
      work_id: values.work_id ? Number(values.work_id) : null,
      goodreads_book_id: values.goodreads_book_id.trim() || null,
      description: values.description.trim() || null,
      isbn: values.isbn.trim() || null,
      isbn13: values.isbn13.trim() || null,
      language_code: values.language_code.trim() || null,
      publication_year:
        values.publication_year !== "" ? Number(values.publication_year) : null,
      num_pages: values.num_pages !== "" ? Number(values.num_pages) : null,
      image_url: values.image_url.trim() || null,
      authors: rows.map((row) => ({
        author_id: Number(row.author_id),
        role: row.role.trim(),
      })),
      genre_ids: [...genreIds],
    };
    mutation.mutate(input);
  });

  if (editing && bookQuery.isError) {
    if (bookQuery.error instanceof ApiError && bookQuery.error.status === 404) {
      return (
        <EmptyState
          title={es.staff.bookForm.notFound}
          action={
            <Button asChild variant="secondary">
              <Link to="/staff/catalog">{es.errors.goBack}</Link>
            </Button>
          }
        />
      );
    }
    return (
      <ErrorState error={bookQuery.error} onRetry={() => void bookQuery.refetch()} />
    );
  }

  if (editing && bookQuery.isPending) {
    return <PageLoader label={es.common.loading} />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={editing ? es.staff.editBook : es.staff.newBook}
        back={{ to: "/staff/catalog", label: es.staff.catalogTitle }}
      />
      <form onSubmit={submit} noValidate className="space-y-8">
        <section className="paper-panel p-5 sm:p-6">
          <h2 className="mb-4 font-display text-2xl font-semibold">
            Datos bibliográficos
          </h2>
          <div className="space-y-4">
            <Field
              label={es.staff.bookForm.titleLabel}
              htmlFor="book-title"
              required
              error={errors.title?.message}
            >
              <Input
                id="book-title"
                placeholder={es.staff.bookForm.titlePlaceholder}
                {...register("title")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={es.staff.bookForm.workLabel} htmlFor="book-work">
                <Select id="book-work" {...register("work_id")}>
                  <option value="">{es.staff.bookForm.workPlaceholder}</option>
                  {(worksQuery.data?.data ?? []).map((work) => (
                    <option key={work.id} value={work.id}>
                      {work.value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={es.staff.bookForm.goodreadsLabel}
                htmlFor="book-goodreads"
                hint={es.staff.bookForm.goodreadsHint}
                error={errors.goodreads_book_id?.message}
              >
                <Input
                  id="book-goodreads"
                  inputMode="numeric"
                  {...register("goodreads_book_id")}
                />
              </Field>
              <Field
                label={es.staff.bookForm.languageLabel}
                htmlFor="book-language"
              >
                <Input
                  id="book-language"
                  placeholder={es.staff.bookForm.languagePlaceholder}
                  {...register("language_code")}
                />
              </Field>
              <Field
                label={es.staff.bookForm.yearLabel}
                htmlFor="book-year"
                error={errors.publication_year?.message}
              >
                <Input
                  id="book-year"
                  inputMode="numeric"
                  {...register("publication_year")}
                />
              </Field>
              <Field
                label={es.staff.bookForm.pagesLabel}
                htmlFor="book-pages"
                error={errors.num_pages?.message}
              >
                <Input
                  id="book-pages"
                  inputMode="numeric"
                  {...register("num_pages")}
                />
              </Field>
              <Field label={es.staff.bookForm.isbnLabel} htmlFor="book-isbn">
                <Input id="book-isbn" {...register("isbn")} />
              </Field>
              <Field label={es.staff.bookForm.isbn13Label} htmlFor="book-isbn13">
                <Input id="book-isbn13" {...register("isbn13")} />
              </Field>
              <Field
                label={es.staff.bookForm.imageLabel}
                htmlFor="book-image"
                hint={es.staff.bookForm.imageHint}
              >
                <Input id="book-image" {...register("image_url")} />
              </Field>
            </div>
            <Field
              label={es.staff.bookForm.descriptionLabel}
              htmlFor="book-description"
            >
              <Textarea id="book-description" {...register("description")} />
            </Field>
          </div>
        </section>

        <section className="paper-panel p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">
              {es.staff.bookForm.authorsLabel}
            </h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setAuthors((rows) => [...rows, { author_id: "", role: "author" }])
              }
            >
              {es.staff.bookForm.addAuthor}
            </Button>
          </div>
          {authors.length === 0 ? (
            <p className="m-0 text-[0.86rem] text-[rgba(243,240,250,0.62)]">
              {es.staff.bookForm.noAuthors}
            </p>
          ) : (
            <div className="space-y-3">
              {authors.map((row, index) => (
                <div
                  key={index}
                  className="grid gap-3 border border-[rgba(243,240,250,0.12)] p-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <Field
                    label={es.staff.bookForm.authorIdLabel}
                    htmlFor={`book-author-${index}`}
                  >
                    <Select
                      id={`book-author-${index}`}
                      value={row.author_id}
                      onChange={(event) =>
                        setAuthors((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, author_id: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">—</option>
                      {(authorsQuery.data?.data ?? []).map((author) => (
                        <option key={author.id} value={author.id}>
                          {author.value} (#{author.id})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={es.staff.bookForm.authorRoleLabel}
                    htmlFor={`book-role-${index}`}
                  >
                    <Input
                      id={`book-role-${index}`}
                      value={row.role}
                      placeholder={es.staff.bookForm.authorRolePlaceholder}
                      onChange={(event) =>
                        setAuthors((rows) =>
                          rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, role: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-end"
                    onClick={() =>
                      setAuthors((rows) =>
                        rows.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    {es.staff.bookForm.removeAuthor}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="paper-panel p-5 sm:p-6">
          <h2 className="font-display text-2xl font-semibold">
            {es.staff.bookForm.genresLabel}
          </h2>
          <p className="mt-1 text-[0.82rem] text-[rgba(243,240,250,0.62)]">
            {es.staff.bookForm.genresHint}
          </p>
          {genresQuery.isPending ? (
            <PageLoader label={es.common.loading} />
          ) : (genresQuery.data?.data ?? []).length === 0 ? (
            <p className="mt-3 text-[0.86rem] text-[rgba(243,240,250,0.62)]">
              {es.staff.bookForm.noGenres}
            </p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(genresQuery.data?.data ?? []).map((genre) => {
                const checked = genreIds.has(genre.id);
                return (
                  <label
                    key={genre.id}
                    className={
                      checked
                        ? "flex cursor-pointer items-center gap-2 border border-[rgba(107,32,36,0.34)] bg-[rgba(107,32,36,0.06)] px-3 py-2 text-[0.86rem]"
                        : "flex cursor-pointer items-center gap-2 border border-[rgba(243,240,250,0.16)] px-3 py-2 text-[0.86rem] hover:border-[rgba(243,240,250,0.3)]"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setGenreIds((current) => {
                          const next = new Set(current);
                          if (next.has(genre.id)) next.delete(genre.id);
                          else next.add(genre.id);
                          return next;
                        })
                      }
                      className="size-4 accent-[#6b2024]"
                    />
                    {genre.value}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {formError ? (
          <p
            role="alert"
            className="border-l-2 border-oxblood bg-[rgba(107,32,36,0.06)] px-4 py-3 text-[0.86rem] text-oxblood"
          >
            {formError}
          </p>
        ) : null}
        {submitError ? <ErrorState error={submitError} compact /> : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[rgba(243,240,250,0.16)] pt-5">
          <Button asChild variant="secondary">
            <Link to="/staff/catalog">{es.common.cancel}</Link>
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {editing ? es.staff.bookForm.saveEdit : es.staff.bookForm.saveNew}
          </Button>
        </div>
        {mutation.isError ? (
          <p className="text-right text-[0.8rem] text-oxblood">
            {mapApiError(mutation.error).message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
