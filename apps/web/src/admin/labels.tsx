import type { RequestStatus } from "@hamtning/shared";
import { STATUS_LABELS_SV } from "@hamtning/shared";

export const statusLabel = (s: RequestStatus) => STATUS_LABELS_SV[s];

const stamp = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

/** "13 okt. 10:24" in Swedish time. */
export const formatStamp = (iso: string) => stamp.format(new Date(iso));

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left until `iso` (0 when less than a day remains). */
export const daysUntil = (iso: string, now = Date.now()) =>
  Math.max(0, Math.floor((new Date(iso).getTime() - now) / DAY_MS));

/** "raderas om 2 dagar" / "raderas inom ett dygn" */
export function deletionCountdown(iso: string) {
  const days = daysUntil(iso);
  return days === 0
    ? "raderas inom ett dygn"
    : `raderas om ${days} ${days === 1 ? "dag" : "dagar"}`;
}
