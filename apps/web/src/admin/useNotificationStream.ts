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
 * Keeps the notification summary live over Server-Sent Events and reports newly verified
 * requests. EventSource reconnects by itself; while the stream is not open, callers fall back
 * to polling.
 */
export function useNotificationStream(onNewRequest: (r: NewRequestToast) => void) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "open" | "down">("connecting");

  useEffect(() => {
    const source = new EventSource(NOTIFICATION_STREAM_URL);
    source.onopen = () => setStatus("open");
    source.onerror = () => setStatus("down");
    source.addEventListener("summary", (e) => {
      qc.setQueryData<NotificationSummary>(keys.summary, JSON.parse((e as MessageEvent).data));
    });
    source.addEventListener("verified", (e) => {
      onNewRequest(JSON.parse((e as MessageEvent).data) as NewRequestToast);
      void qc.invalidateQueries({ queryKey: [...keys.requests, "list"] });
    });
    return () => source.close();
    // onNewRequest is expected to be stable (useCallback / setState).
  }, [qc, onNewRequest]);

  return status;
}
