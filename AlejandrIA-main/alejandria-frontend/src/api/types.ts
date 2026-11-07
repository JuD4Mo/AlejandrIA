/**
 * Exact HTTP contract of the Go API at /api/v1.
 *
 * Sources: alejandria-backend/internal/{user,catalog,inventory,circulation,
 * personalization,recommendation} plus the SQL migrations for circulation.
 *
 * Important: circulation LIST endpoints are built with PostgreSQL row_to_json,
 * so their field names are database column names, not the Go structs used by
 * single-action responses. Both shapes are modelled below.
 */

export type Role = "lector" | "bibliotecario" | "administrador";

export type IsoDateString = string;

export interface Pagination {
  limit: number;
  offset: number;
}

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export interface FieldError {
  field: string;
  error: string;
}

export interface ErrorAction {
  type: "redirect";
  message: string;
  value: string;
}

/** Body written by errs.HTTPError. All fields are always present. */
export interface ApiErrorBody {
  code: string;
  message: string;
  status: number;
  override: boolean;
  errors: FieldError[] | null;
  action: ErrorAction | null;
}

/* -------------------------------------------------------------------------- */
/* Auth and users                                                             */
/* -------------------------------------------------------------------------- */

/** GET /auth/me; POST /auth/register (201); GET /users rows. */
export interface User {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  roles: Role[];
  created_at: IsoDateString;
}

export interface RegisterInput {
  email: string;
  display_name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface RolesInput {
  roles: Role[];
}

export interface ActiveInput {
  is_active: boolean;
}

export interface UpdatedResult {
  updated: true;
}

export interface DeletedResult {
  deleted: true;
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

export interface AuthorLink {
  author_id: number;
  role: string;
}

/** Complete book payload. GET responses include every field (null when unset). */
export interface BookInput {
  title: string;
  work_id: number | null;
  /** External Goodreads identifier. Always a string; preserve leading zeros. */
  goodreads_book_id: string | null;
  description: string | null;
  isbn: string | null;
  isbn13: string | null;
  language_code: string | null;
  publication_year: number | null;
  num_pages: number | null;
  image_url: string | null;
  authors: AuthorLink[];
  genre_ids: number[];
}

export interface Book extends BookInput {
  id: number;
}

export type NamedKind = "works" | "authors" | "genres";

/**
 * GET /{works,authors,genres}. `value` is the work title or the author/genre
 * name. goodreads_id is omitted for genres and when null.
 */
export interface NamedEntity {
  id: number;
  value: string;
  goodreads_id?: string;
}

export interface WorkInput {
  title: string;
  goodreads_id?: string | null;
}

export interface NamedEntityInput {
  name: string;
  goodreads_id?: string | null;
}

/** POST/PUT /{works,authors,genres} and POST/PUT /books/{id}/copies. */
export interface IdResult {
  id: number;
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

export type CopyStatus =
  | "circulating"
  | "maintenance"
  | "lost"
  | "withdrawn";

export interface Copy {
  id: number;
  book_id: number;
  inventory_code: string;
  status: CopyStatus;
  location: string | null;
  available_for_circulation: boolean;
}

/**
 * GET /books/{id}/copies.
 * `total` and `available` cover every copy of the book; `copies` is the
 * requested limit/offset window. Availability is a conservative snapshot.
 */
export interface InventorySummary {
  total: number;
  available: number;
  copies: Copy[];
}

export interface CopyInput {
  inventory_code: string;
  /** Optional on create; the backend defaults to "circulating". */
  status?: CopyStatus;
  location?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Circulation                                                                */
/* -------------------------------------------------------------------------- */

export type LoanRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface BookRequestInput {
  book_id: number;
}

export interface DeliveryInput {
  copy_id: number;
}

export interface RejectionInput {
  reason: string;
}

export interface RenewalDecisionInput {
  approve: boolean;
  reason?: string;
}

/**
 * GET /loan-requests row (row_to_json(loan_requests)).
 */
export interface LoanRequestListRow {
  id: number;
  user_id: number;
  book_id: number;
  status: LoanRequestStatus;
  created_at: IsoDateString;
  decided_at: IsoDateString | null;
  decided_by: number | null;
  decision_note: string | null;
}

/**
 * GET /loans row (row_to_json(loans)).
 */
export interface LoanListRow {
  id: number;
  request_id: number;
  user_id: number;
  book_id: number;
  copy_id: number;
  delivered_by: number;
  delivered_at: IsoDateString;
  initial_due_at: IsoDateString;
  due_at: IsoDateString;
  returned_at: IsoDateString | null;
  returned_by: number | null;
}

/**
 * Loan payload returned by deliver, return and pickup actions
 * (circulation.Loan Go struct). It is narrower than a list row.
 */
export interface LoanActionResult {
  id: number;
  user_id: number;
  book_id: number;
  copy_id: number;
  due_at: IsoDateString;
  returned_at: IsoDateString | null;
}

export type ReservationStatus =
  | "waiting"
  | "ready"
  | "fulfilled"
  | "expired"
  | "cancelled";

export type AssignmentOrigin = "manual" | "system" | "unknown";

/**
 * GET /reservations row (row_to_json(reservations)).
 */
export interface ReservationListRow {
  id: number;
  user_id: number;
  book_id: number;
  status: ReservationStatus;
  copy_id: number | null;
  created_at: IsoDateString;
  assigned_at: IsoDateString | null;
  assigned_by: number | null;
  pickup_expires_at: IsoDateString | null;
  assignment_origin: AssignmentOrigin | null;
  closed_at: IsoDateString | null;
  loan_id: number | null;
}

/**
 * Reservation payload returned by POST /reservations
 * (circulation.Reservation Go struct).
 */
export interface ReservationActionResult {
  id: number;
  user_id: number;
  book_id: number;
  status: ReservationStatus;
  copy_id: number | null;
  pickup_expires_at: IsoDateString | null;
  assigned_by: number | null;
  assignment_origin: AssignmentOrigin | null;
}

export type RenewalStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * GET /renewals row (row_to_json(loan_renewals)).
 */
export interface RenewalListRow {
  id: number;
  loan_id: number;
  requested_at: IsoDateString;
  status: RenewalStatus;
  previous_due_at: IsoDateString;
  new_due_at: IsoDateString | null;
  decided_at: IsoDateString | null;
  decided_by: number | null;
  decision_note: string | null;
}

/* -------------------------------------------------------------------------- */
/* Personalization                                                            */
/* -------------------------------------------------------------------------- */

export interface GenrePreference {
  genre_id: number;
  name: string;
  created_at: IsoDateString;
}

export interface GenreSelectionInput {
  genre_ids: number[];
}

export interface Rating {
  book_id: number;
  title: string;
  goodreads_book_id: string | null;
  rating: number;
  created_at: IsoDateString;
  updated_at: IsoDateString;
}

export interface RatingInput {
  rating: number;
}

/**
 * Backend allow-list from migration 006 / InteractionInput:
 * view, recommendation_click, favorite_added, favorite_removed.
 */
export type InteractionType =
  | "view"
  | "recommendation_click"
  | "favorite_added"
  | "favorite_removed";

export interface InteractionInput {
  book_id: number;
  interaction_type: InteractionType;
}

export interface Interaction {
  id: number;
  book_id: number;
  title: string;
  goodreads_book_id: string | null;
  interaction_type: InteractionType;
  occurred_at: IsoDateString;
}

/* -------------------------------------------------------------------------- */
/* Recommendations (Go API; never call FastAPI directly)                      */
/* -------------------------------------------------------------------------- */

export type RecommendationStatus =
  | "ok"
  | "preferences_required"
  | "no_content_matches";

export type RecommendationModel =
  | "content_cold_start"
  | "content_similar"
  | string;

export interface RecommendationItem {
  /** External Goodreads identifier string; never parse as a number. */
  goodreads_book_id: string;
  local_book_id: number | null;
  in_local_catalog: boolean;
  local_title: string | null;
  total_copies: number | null;
  available_copies: number | null;
  /** null = unknown; false = no copy now; true = available at query time. */
  available: boolean | null;
  title: string | null;
  authors: string[];
  genres: string[];
  score: number | null;
  model: RecommendationModel;
  score_scope: string;
  content_score: number | null;
  collaborative_score: number | null;
}

export interface RecommendationResponse {
  status: RecommendationStatus;
  /** Present for preferences_required / no_content_matches. */
  message?: string;
  source: string;
  recommendation_type: string;
  model_version: string;
  count: number;
  recommendations: RecommendationItem[];
}
