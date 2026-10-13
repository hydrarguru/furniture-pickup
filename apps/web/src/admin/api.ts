import type {
  AdminCancellation,
  AdminCategory,
  AdminRequestDetail,
  AdminRequestPage,
  Me,
  NotificationSummary,
  StatusChange,
} from "@hamtning/shared";
import { ApiError } from "../lib/api.js";

export type ListFilter =
  | "all"
  | "new"
  | "in_progress"
  | "accepted"
  | "on_the_way"
  | "declined"
  | "cancelled";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      accept: "application/json",
      // Required by the API's CSRF check on every state-changing admin request.
      "x-requested-with": "fetch",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "http_error";
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // keep the generic code
    }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export const adminApi = {
  me: () => call<Me>("GET", "/auth/me"),
  login: (email: string, password: string) => call<Me>("POST", "/auth/login", { email, password }),
  logout: () => call<{ ok: true }>("POST", "/auth/logout"),

  listRequests: (opts: { status: ListFilter; q: string; cursor?: string }) => {
    const params = new URLSearchParams({ status: opts.status });
    if (opts.q) params.set("q", opts.q);
    if (opts.cursor) params.set("cursor", opts.cursor);
    return call<AdminRequestPage>("GET", `/admin/requests?${params}`);
  },
  getRequest: (id: string) => call<AdminRequestDetail>("GET", `/admin/requests/${id}`),
  changeStatus: (id: string, change: StatusChange) =>
    call<AdminRequestDetail>("PATCH", `/admin/requests/${id}/status`, change),
  deleteRequest: (id: string) => call<{ ok: true }>("DELETE", `/admin/requests/${id}`),
  addNote: (id: string, note: string) =>
    call<AdminRequestDetail>("POST", `/admin/requests/${id}/notes`, { note }),

  cancellations: () =>
    call<{ cancellations: AdminCancellation[] }>("GET", "/admin/cancellations").then(
      (r) => r.cancellations,
    ),

  summary: () => call<NotificationSummary>("GET", "/admin/notifications/summary"),

  categories: () => call<{ categories: AdminCategory[] }>("GET", "/admin/categories"),
  createCategory: (labelSv: string) =>
    call<AdminCategory>("POST", "/admin/categories", { labelSv }),
  updateCategory: (id: number, patch: Partial<Omit<AdminCategory, "id">>) =>
    call<AdminCategory>("PATCH", `/admin/categories/${id}`, patch),
};

export const NOTIFICATION_STREAM_URL = "/api/admin/notifications/stream";
