import type { NotificationSummary } from "@hamtning/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NOTIFICATION_STREAM_URL } from "./api.js";
import { keys } from "./queries.js";

export interface NewRequestToast {
  id: string;
  name: string;
  city: string;
}

/**
 * Keeps the notification summary and request lists live over Server-Sent Events, and reports
 * newly verified and customer-cancelled requests. EventSource reconnects by itself; while the stream is not open,
 * callers fall back to polling.
 */
export function useNotificationStream(
  onNewRequest: (r: NewRequestToast) => void,
  onCancelled: (r: { id: string }) => void,
) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "open" | "down">("connecting");

  useEffect(() => {
    const source = new EventSource(NOTIFICATION_STREAM_URL);
    source.onopen = () => setStatus("open");
    source.onerror = () => setStatus("down");
    source.addEventListener("summary", (e) => {
      qc.setQueryData<NotificationSummary>(keys.summary, JSON.parse((e as MessageEvent).data));
    });
    // A fresh, still unverified submission: no toast, just show it in the "Nya" list.
    source.addEventListener("submitted", () => {
      void qc.invalidateQueries({ queryKey: [...keys.requests, "list"] });
    });
    source.addEventListener("verified", (e) => {
      onNewRequest(JSON.parse((e as MessageEvent).data) as NewRequestToast);
      // Lists retag it, and an open detail page unlocks its actions.
      void qc.invalidateQueries({ queryKey: keys.requests });
    });
    source.addEventListener("cancelled", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as { id: string };
      onCancelled(r);
      // The request is gone: lists drop it and an open detail page shows "not found".
      void qc.invalidateQueries({ queryKey: keys.requests });
      void qc.invalidateQueries({ queryKey: keys.cancellations });
    });
    return () => source.close();
    // The callbacks are expected to be stable (useCallback / setState).
  }, [qc, onNewRequest, onCancelled]);

  return status;
}
