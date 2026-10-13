import type { RequestStatus, RequestStatusView } from "@hamtning/shared";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  formatDate,
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
  declined: {
    title: "Inte godkänd",
    body: "Tyvärr kan vi inte ta emot sakerna den här gången.",
  },
  cancelled: { title: "Avbokad", body: "Du har avbokat förfrågan." },
};

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

  useEffect(() => {
    let active = true;
    getRequestStatus(token)
      .then((view) => active && setLoad({ state: "ready", view }))
      .catch((err) => {
        if (!active) return;
        const missing = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setLoad({ state: missing ? "missing" : "error" });
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const view = await cancelRequest(token);
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
      {justVerified && (
        <p className="banner success" role="status">
          Tack! Din förfrågan är bekräftad och skickad till oss.
        </p>
      )}
      <h1>Din förfrågan</h1>

      <section className={`status-card status-${view.status}`}>
        <p className="status-label">{text.title}</p>
        <p>{text.body}</p>
        {view.status === "accepted" && view.confirmedStart && (
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
          Ärendet och fotona raderas automatiskt den {formatDay(view.deleteAfter)}.
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
