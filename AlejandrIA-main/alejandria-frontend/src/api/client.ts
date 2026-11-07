import {
  clearToken,
  getToken,
  notifySessionExpired,
  setFlash,
} from "@/auth/session";
import { es } from "@/i18n/es";
import type { ApiErrorBody } from "./types";

export const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string | null {
    return this.body?.code ?? null;
  }

  get fieldErrors() {
    return this.body?.errors ?? [];
  }
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: object;
  /** Set false for login/register so a 401 never looks like an expired session. */
  handleUnauthorized?: boolean;
}

function buildUrl(path: string, query?: object): string {
  const url = `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as [string, QueryValue][]) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${url}?${suffix}` : url;
}

function parseErrorBody(payload: unknown, status: number): ApiErrorBody | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<ApiErrorBody>;
  if (typeof candidate.message !== "string") return null;
  return {
    code: typeof candidate.code === "string" ? candidate.code : "ERROR",
    message: candidate.message,
    status: typeof candidate.status === "number" ? candidate.status : status,
    override: Boolean(candidate.override),
    errors: Array.isArray(candidate.errors) ? candidate.errors : null,
    action:
      candidate.action && typeof candidate.action === "object"
        ? candidate.action
        : null,
  };
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query, handleUnauthorized = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "network request failed",
      status: 0,
      override: false,
      errors: null,
      action: null,
    });
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    if (response.status === 401 && handleUnauthorized) {
      clearToken();
      setFlash(es.auth.sessionExpired);
      notifySessionExpired();
    }
    throw new ApiError(response.status, parseErrorBody(payload, response.status));
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: object) =>
    request<T>(path, { query }),
  post: <T>(path: string, body?: unknown, options?: Partial<RequestOptions>) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
