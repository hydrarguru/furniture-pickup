export const REQUEST_STATUSES = [
  "unverified",
  "new",
  "in_progress",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Closed requests are purged 30 days after they entered one of these states. */
export const CLOSED_STATUSES = [
  "accepted",
  "declined",
  "cancelled",
] as const satisfies readonly RequestStatus[];

export const isClosedStatus = (s: RequestStatus): boolean =>
  (CLOSED_STATUSES as readonly string[]).includes(s);

export const RETENTION_DAYS_CLOSED = 30;
export const RETENTION_DAYS_UNVERIFIED = 7;

export const STATUS_LABELS_SV: Record<RequestStatus, string> = {
  unverified: "Ej bekräftad",
  new: "Ny",
  in_progress: "Pågående",
  accepted: "Godkänd",
  declined: "Avslagen",
  cancelled: "Avbruten",
};
