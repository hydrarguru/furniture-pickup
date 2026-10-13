import type { RequestStatus, RequestStatusView } from "@hamtning/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  formatDate,
  formatDateTime,
  formatDateTimeRange,
  formatDay,
  PART_HINTS,
  PART_LABELS,
} from "../form/labels.js";
import { ApiError, cancelRequest, getRequestStatus } from "../lib/api.js";

const STATUS_TEXT: Record<RequestStatus, { title: string; body: string }> = {
  unverified: {
    title: "Inte bekräftad",
    body: "Förfrågan har inte bekräftats ännu och har därför inte skickats till oss.",
  },
  new: {
    title: "Mottagen",
    body: "Vi har tagit emot din förfrågan och går igenom den så snart vi kan.",
  },
  in_progress: {
    title: "Under behandling",
    body: "Vi går igenom din förfrågan och hör av oss.",
  },
  accepted: { title: "Godkänd", body: "Vi hämtar gärna sakerna." },
  on_the_way: { title: "På väg", body: "Vi är på väg till dig för att hämta sakerna." },
  declined: {
    title: "Inte godkänd",
    body: "Tyvärr kan vi inte ta emot sakerna den här gången.",
  },
  cancelled: { title: "Avbokad", body: "Du har avbokat förfrågan." },
};

/** How often an open status page checks for news from the store. */
export const STATUS_REFRESH_MS = 30_000;

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; view: RequestStatusView };

export function StatusPage() {
  const { token = "" } = useParams();
  const justVerified = Boolean(
    (useLocation().state as { justVerified?: boolean } | null)?.justVerified,
  );
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [updated, setUpdated] = useState(false);
  // The status on screen, so a check can tell news from the store apart from what is shown.
  const shownStatus = useRef<RequestStatus | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      clearTimeout(timer);
      try {
        const view = await getRequestStatus(token);
        if (!active) return;
        if (shownStatus.current && view.status !== shownStatus.current) setUpdated(true);
        shownStatus.current = view.status;
        setLoad({ state: "ready", view });
      } catch (err) {
        if (!active) return;
        const missing = err instanceof ApiError && (err.status === 404 || err.status === 400);
        // A failed background check keeps what is on screen; only a deleted request replaces it.
        if (missing) setLoad({ state: "missing" });
        else if (!shownStatus.current) setLoad({ state: "error" });
        if (missing) return;
      }
      if (!document.hidden) timer = setTimeout(refresh, STATUS_REFRESH_MS);
    }
    // Hidden tabs don't poll; coming back checks straight away.
    const onVisible = () => {
      if (!document.hidden) refresh();
    };

    refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const view = await cancelRequest(token);
      shownStatus.current = view.status;
      setLoad({ state: "ready", view });
      setConfirming(false);
    } catch {
      setCancelError("Det gick inte att avboka just nu. Försök igen om en stund.");
    } finally {
      setCancelling(false);
    }
  }

  if (load.state === "loading")
    return (
      <p role="status" className="lead">
        Hämtar ärendet…
      </p>
    );
  if (load.state !== "ready")
    return (
      <>
        <h1>Ärendet hittades inte</h1>
        <p>
          {load.state === "missing"
            ? "Länken är ogiltig eller så har ärendet raderats."
            : "Något gick fel. Försök igen om en stund."}
        </p>
        <p>
          <Link to="/">Till formuläret</Link>
        </p>
      </>
    );

  const { view } = load;
  const text = STATUS_TEXT[view.status];

  return (
    <>
      {/* Only while waiting for staff: once they act, the status box says what happens next. */}
      {justVerified && view.status === "new" && (
        <p className="banner success" role="status">
          Tack! Din förfrågan är bekräftad och skickad till oss.
        </p>
      )}
      <h1>Din förfrågan</h1>
      <p className="visually-hidden" role="status">
        {updated ? `Ärendet har uppdaterats: ${text.title}` : ""}
      </p>

      <section className={`status-card status-${view.status}`}>
        <p className="status-label">{text.title}</p>
        <p>{text.body}</p>
        {(view.status === "accepted" || view.status === "on_the_way") && view.confirmedStart && (
          <p>
            <strong>Hämtning: {formatDateTimeRange(view.confirmedStart, view.confirmedEnd)}</strong>
          </p>
        )}
        {view.status === "unverified" && (
          <p>
            <Link to={`/bekrafta/${token}`}>Bekräfta förfrågan nu</Link>
          </p>
        )}
        {view.staffMessage && (
          <blockquote className="staff-message">
            <p className="muted">Meddelande från butiken</p>
            <p>{view.staffMessage}</p>
          </blockquote>
        )}
      </section>

      {view.timeline.length > 0 && (
        <>
          <h2 id="timeline-heading">Förlopp</h2>
          <ol className="timeline" aria-labelledby="timeline-heading">
            {view.timeline.map((step) => (
              <li key={step.status} className={step.status === view.status ? "current" : ""}>
                <span className="timeline-status">{STATUS_TEXT[step.status].title}</span>
                <time dateTime={step.at}>{formatDateTime(step.at)}</time>
              </li>
            ))}
          </ol>
        </>
      )}

      <h2>Föremål</h2>
      <ul className="plain">
        {view.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list in server order
          <li key={i}>
            {item.quantity > 1 ? `${item.quantity} × ` : ""}
            {item.title}
          </li>
        ))}
      </ul>
      <p className="muted">
        {view.imageCount} {view.imageCount === 1 ? "foto" : "foton"}
      </p>

      <h2>Dina förslag på tider</h2>
      <ul className="plain">
        {view.timeWindows.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list in server order
          <li key={i}>
            {formatDate(w.date)},{" "}
            {w.part === "custom"
              ? `${w.fromTime}–${w.toTime}`
              : `${PART_LABELS[w.part].toLowerCase()} ${PART_HINTS[w.part]}`}
          </li>
        ))}
      </ul>

      {view.deleteAfter && (
        <p className="muted">
          {view.status === "new" || view.status === "in_progress"
            ? `Hinner vi inte hantera förfrågan raderas den automatiskt den ${formatDay(view.deleteAfter)}. Du är då välkommen att skicka en ny.`
            : view.status === "unverified"
              ? `Förfrågan raderas den ${formatDay(view.deleteAfter)} om den inte bekräftas.`
              : `Ärendet och fotona raderas automatiskt den ${formatDay(view.deleteAfter)}.`}
        </p>
      )}

      {view.canCancel && (
        <section className="cancel">
          {confirming ? (
            <>
              <p>
                <strong>Vill du avboka? Det går inte att ångra.</strong>
              </p>
              <div className="nav">
                <button type="button" className="secondary" onClick={() => setConfirming(false)}>
                  Behåll förfrågan
                </button>
                <button type="button" className="danger" onClick={cancel} disabled={cancelling}>
                  {cancelling ? "Avbokar…" : "Ja, avboka"}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="secondary" onClick={() => setConfirming(true)}>
              Avboka förfrågan
            </button>
          )}
          {cancelError && (
            <p className="banner" role="alert">
              {cancelError}
            </p>
          )}
        </section>
      )}

      <p className="muted small">
        Spara mejlet med länken. Det är så du hittar tillbaka till ärendet.
      </p>
    </>
  );
}
