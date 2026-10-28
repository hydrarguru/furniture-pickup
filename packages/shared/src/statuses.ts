export const REQUEST_STATUSES = [
  "unverified",
  "new",
  "in_progress",
  "accepted",
  "on_the_way" /** Staff are driving to the pickup. Only reachable from `accepted`. */,
  "completed" /** The items have been picked up. Only reachable from `on_the_way`; final. */,
  "declined",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Open requests with no staff activity (status change or note) for this long are deleted. */
export const RETENTION_DAYS_CLOSED = 30;
export const RETENTION_DAYS_UNVERIFIED = 7;
export const RETENTION_DAYS_INACTIVE = 7;

/** Requests waiting for staff. Their retention clock restarts on every status change or note. */
export const OPEN_STATUSES = ["new", "in_progress"] as const satisfies readonly RequestStatus[];

const DAY_MS = 24 * 60 * 60 * 1000;
const plusDays = (iso: string, days: number) =>
  new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();

/**
 * When a request will be deleted automatically. The single source of truth for what staff and
 * requesters are shown; the purge job deletes exactly the requests whose date has passed.
 */
export function scheduledDeletion(r: {
  status: RequestStatus;
  closedAt: string | null;
  updatedAt: string;
  createdAt: string;
}): string | null {
  if (r.status === "unverified") return plusDays(r.createdAt, RETENTION_DAYS_UNVERIFIED);
  if (r.closedAt) return plusDays(r.closedAt, RETENTION_DAYS_CLOSED);
  if ((OPEN_STATUSES as readonly string[]).includes(r.status))
    return plusDays(r.updatedAt, RETENTION_DAYS_INACTIVE);
  return null;
}

export const STATUS_LABELS_SV: Record<RequestStatus, string> = {
  unverified: "Ej verifierad",
  new: "Ny",
  in_progress: "Under behandling",
  accepted: "Godkänd",
  on_the_way: "På väg",
  completed: "Hämtad",
  declined: "Nekad",
  cancelled: "Avbokad",
};
