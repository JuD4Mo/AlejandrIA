import { api } from "./client";
import type {
  ActiveInput,
  Book,
  BookInput,
  Copy,
  CopyInput,
  DeletedResult,
  DeliveryInput,
  IdResult,
  Interaction,
  InteractionInput,
  InventorySummary,
  LoanActionResult,
  LoanListRow,
  LoanRequestListRow,
  LoginInput,
  LoginResponse,
  NamedEntity,
  NamedEntityInput,
  NamedKind,
  Page,
  Rating,
  RatingInput,
  RecommendationResponse,
  RegisterInput,
  RejectionInput,
  RenewalDecisionInput,
  RenewalListRow,
  ReservationActionResult,
  ReservationListRow,
  RolesInput,
  UpdatedResult,
  User,
  WorkInput,
} from "./types";

export interface BookFilters {
  limit?: number;
  offset?: number;
  title?: string;
  author_id?: number;
  genre_id?: number;
}

export interface PaginationInput {
  limit?: number;
  offset?: number;
}

function namedPath(kind: NamedKind): string {
  return `/${kind}`;
}

export const endpoints = {
  auth: {
    login: (input: LoginInput) =>
      api.post<LoginResponse>("/auth/login", input, {
        handleUnauthorized: false,
      }),
    register: (input: RegisterInput) =>
      api.post<User>("/auth/register", input, {
        handleUnauthorized: false,
      }),
    me: () => api.get<User>("/auth/me"),
  },

  users: {
    list: (params: PaginationInput = {}) =>
      api.get<Page<User>>("/users", params),
    setRoles: (id: number, input: RolesInput) =>
      api.put<UpdatedResult>(`/users/${id}/roles`, input),
    setActive: (id: number, input: ActiveInput) =>
      api.patch<UpdatedResult>(`/users/${id}/active`, input),
  },

  books: {
    list: (filters: BookFilters = {}) =>
      api.get<Page<Book>>("/books", filters),
    get: (id: number) => api.get<Book>(`/books/${id}`),
    create: (input: BookInput) => api.post<Book>("/books", input),
    update: (id: number, input: BookInput) =>
      api.put<Book>(`/books/${id}`, input),
    remove: (id: number) => api.delete<DeletedResult>(`/books/${id}`),
    similar: (id: number, limit = 10) =>
      api.get<RecommendationResponse>(`/books/${id}/similar`, { limit }),
  },

  named: {
    list: (kind: NamedKind, params: PaginationInput = {}) =>
      api.get<Page<NamedEntity>>(namedPath(kind), params),
    get: (kind: NamedKind, id: number) =>
      api.get<NamedEntity>(`${namedPath(kind)}/${id}`),
    create: (kind: NamedKind, input: NamedEntityInput | WorkInput) =>
      api.post<IdResult>(namedPath(kind), input),
    update: (
      kind: NamedKind,
      id: number,
      input: NamedEntityInput | WorkInput,
    ) => api.put<IdResult>(`${namedPath(kind)}/${id}`, input),
    remove: (kind: NamedKind, id: number) =>
      api.delete<DeletedResult>(`${namedPath(kind)}/${id}`),
  },

  copies: {
    list: (bookId: number, params: PaginationInput = {}) =>
      api.get<InventorySummary>(`/books/${bookId}/copies`, params),
    create: (bookId: number, input: CopyInput) =>
      api.post<IdResult>(`/books/${bookId}/copies`, input),
    update: (bookId: number, copyId: number, input: CopyInput) =>
      api.put<IdResult>(`/books/${bookId}/copies/${copyId}`, input),
  },

  circulation: {
    listRequests: (params: PaginationInput = {}) =>
      api.get<Page<LoanRequestListRow>>("/loan-requests", params),
    listLoans: (params: PaginationInput = {}) =>
      api.get<Page<LoanListRow>>("/loans", params),
    listRenewals: (params: PaginationInput = {}) =>
      api.get<Page<RenewalListRow>>("/renewals", params),
    listReservations: (params: PaginationInput = {}) =>
      api.get<Page<ReservationListRow>>("/reservations", params),

    createRequest: (bookId: number) =>
      api.post<IdResult>("/loan-requests", { book_id: bookId }),
    cancelRequest: (id: number) =>
      api.post<UpdatedResult>(`/loan-requests/${id}/cancel`),
    deliver: (id: number, input: DeliveryInput) =>
      api.post<LoanActionResult>(`/loan-requests/${id}/deliver`, input),
    reject: (id: number, input: RejectionInput) =>
      api.post<UpdatedResult>(`/loan-requests/${id}/reject`, input),

    returnLoan: (id: number) =>
      api.post<LoanActionResult>(`/loans/${id}/return`),
    requestRenewal: (id: number) =>
      api.post<IdResult>(`/loans/${id}/renewals`),
    cancelRenewal: (id: number) =>
      api.post<UpdatedResult>(`/renewals/${id}/cancel`),
    decideRenewal: (id: number, input: RenewalDecisionInput) =>
      api.post<UpdatedResult>(`/renewals/${id}/decision`, input),

    reserve: (bookId: number) =>
      api.post<ReservationActionResult>("/reservations", { book_id: bookId }),
    cancelReservation: (id: number) =>
      api.post<UpdatedResult>(`/reservations/${id}/cancel`),
    pickup: (id: number) =>
      api.post<LoanActionResult>(`/reservations/${id}/pickup`),
  },

  personalization: {
    preferences: (params: PaginationInput = {}) =>
      api.get<Page<import("./types").GenrePreference>>(
        "/users/me/preferences/genres",
        params,
      ),
    replacePreferences: (genreIds: number[]) =>
      api.put<UpdatedResult>("/users/me/preferences/genres", {
        genre_ids: genreIds,
      }),
    clearPreferences: () =>
      api.delete<DeletedResult>("/users/me/preferences/genres"),
    deletePreference: (genreId: number) =>
      api.delete<DeletedResult>(`/users/me/preferences/genres/${genreId}`),
    ratings: (params: PaginationInput = {}) =>
      api.get<Page<Rating>>("/users/me/ratings", params),
    putRating: (bookId: number, input: RatingInput) =>
      api.put<Rating>(`/users/me/ratings/${bookId}`, input),
    deleteRating: (bookId: number) =>
      api.delete<DeletedResult>(`/users/me/ratings/${bookId}`),
    interactions: (params: PaginationInput = {}) =>
      api.get<Page<Interaction>>("/users/me/interactions", params),
    addInteraction: (input: InteractionInput) =>
      api.post<Interaction>("/users/me/interactions", input),
    recommendations: (limit = 10) =>
      api.get<RecommendationResponse>("/users/me/recommendations", { limit }),
  },
};

export type CopiesPage = InventorySummary & { copies: Copy[] };
