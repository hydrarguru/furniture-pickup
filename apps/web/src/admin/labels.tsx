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
