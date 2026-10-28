import {
  CALL_TO_CANCEL_STATUSES,
  CANCEL_REASON_MAX,
  cancelRequestSchema,
  type RequestStatus,
  type RequestStatusView,
  STORE_PHONE,
} from "@hamtning/shared";
import { ArrowLeft, CircleX, Mail, PhoneCall } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { FieldError, fieldA11y } from "../form/Field.js";
import {
  formatDate,
  formatDateTime,
  formatDateTimeRange,
  formatDay,
  PART_HINTS,
  PART_LABELS,
} from "../form/labels.js";
import { ApiError, cancelRequest, getRequestStatus, resendVerification } from "../lib/api.js";

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
  completed: { title: "Hämtad", body: "Vi har hämtat sakerna. Tack för att du skänker till oss!" },
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
  | { state: "ready"; view: RequestStatusView }
  /** The requester cancelled: the request no longer exists. */
  | { state: "cancelled" };

export function StatusPage() {
  const { token = "" } = useParams();
  const justVerified = Boolean(
    (useLocation().state as { justVerified?: boolean } | null)?.justVerified,
  );
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const [updated, setUpdated] = useState(false);
  // The status on screen, so a check can tell news from the store apart from what is shown.
  const shownStatus = useRef<RequestStatus | null>(null);
  // Set once the requester has cancelled: the request is gone, so there is nothing to check.
  const stopped = useRef(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      clearTimeout(timer);
      if (stopped.current) return;
      try {
        const view = await getRequestStatus(token);
        if (!active || stopped.current) return;
        if (shownStatus.current && view.status !== shownStatus.current) setUpdated(true);
        shownStatus.current = view.status;
        setLoad({ state: "ready", view });
      } catch (err) {
        if (!active || stopped.current) return;
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

  if (load.state === "loading")
    return (
      <p role="status" className="lead">
        Hämtar ärendet…
      </p>
    );
  if (load.state === "cancelled")
    return (
      <>
        <h1>Förfrågan är avbokad</h1>
        <p className="banner success" role="status">
          Vi har raderat din förfrågan och dina foton.
        </p>
        <p>
          <Link to="/boka">Skicka en ny förfrågan</Link>
        </p>
      </>
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
          <Link to="/boka">Till formuläret</Link>
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

      <StatusDetails
        view={view}
        customer={{
          token,
          onCancelled: () => {
            stopped.current = true;
            setLoad({ state: "cancelled" });
          },
          onRefused: (next) => {
            shownStatus.current = next.status;
            setLoad({ state: "ready", view: next });
          },
        }}
      />

      <p className="muted small">
        Spara mejlet med länken. Det är så du hittar tillbaka till ärendet.
      </p>
    </>
  );
}

/**
 * The status, timeline, items and times, plus what the customer can do from here. Without
 * `customer` it is the staff preview: the same page with the actions replaced by a note.
 */
export function StatusDetails({
  view,
  customer,
}: {
  view: RequestStatusView;
  customer?: {
    token: string;
    onCancelled: () => void;
    onRefused: (view: RequestStatusView) => void;
  };
}) {
  const text = STATUS_TEXT[view.status];
  return (
    <>
      <section className={`status-card status-${view.status}`}>
        <p className="status-label">{text.title}</p>
        <p>{text.body}</p>
        {(view.status === "accepted" || view.status === "on_the_way") && view.confirmedStart && (
          <p>
            <strong>Hämtning: {formatDateTimeRange(view.confirmedStart, view.confirmedEnd)}</strong>
          </p>
        )}
        {/* This page's link can't verify (it proves nothing about the email), only the emailed one can. */}
        {view.status === "unverified" &&
          (customer ? (
            <ResendVerification token={customer.token} />
          ) : (
            <p>
              Kunden uppmanas klicka på bekräftelselänken i mejlet och kan få ett nytt mejl här.
            </p>
          ))}
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

      {view.canCancel ? (
        customer ? (
          <CancelSection
            token={customer.token}
            onCancelled={customer.onCancelled}
            onRefused={customer.onRefused}
          />
        ) : (
          <p className="muted">Här kan kunden avboka förfrågan (den raderas då direkt).</p>
        )
      ) : (
        (CALL_TO_CANCEL_STATUSES as readonly RequestStatus[]).includes(view.status) && (
          <CallToCancel />
        )
      )}
    </>
  );
}

const CALL_US = (
  <>
    ring oss på <a href={`tel:${STORE_PHONE.e164}`}>{STORE_PHONE.display}</a>
  </>
);

const RESEND_ERRORS: Record<string, string> = {
  too_soon: "Vi skickade nyss ett mejl. Vänta en minut innan du försöker igen.",
  resend_limit:
    "Du har fått så många nya länkar som går. Skicka en ny förfrågan om du inte hittar mejlet.",
  rate_limited:
    "Du har fått så många nya länkar som går. Skicka en ny förfrågan om du inte hittar mejlet.",
  already_verified: "Förfrågan är redan bekräftad.",
};

/** The emailed link is the only way to verify; this mails a fresh one if the first went missing. */
function ResendVerification({ token }: { token: string }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setSending(true);
    setError(null);
    try {
      await resendVerification(token);
      setSent(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        RESEND_ERRORS[code] ?? "Det gick inte att skicka mejlet just nu. Försök igen om en stund.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <p>
        Klicka på bekräftelselänken i mejlet vi skickade dig. Hittar du det inte? Titta i
        skräpposten.
      </p>
      {sent ? (
        <p className="banner success" role="status">
          Vi har skickat en ny länk. Använd länken i det senaste mejlet.
        </p>
      ) : (
        <p>
          <button type="button" className="secondary" onClick={resend} disabled={sending}>
            <Mail aria-hidden="true" />
            {sending ? "Skickar…" : "Skicka bekräftelsemejlet igen"}
          </button>
        </p>
      )}
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Before staff have started: the requester cancels with a reason, which deletes the request. */
function CancelSection({
  token,
  onCancelled,
  onRefused,
}: {
  token: string;
  onCancelled: () => void;
  onRefused: (view: RequestStatusView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = cancelRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0]?.message);
      return;
    }
    setReasonError(undefined);
    setSending(true);
    setError(null);
    try {
      await cancelRequest(token, parsed.data.reason);
      onCancelled();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return onCancelled(); // already gone
      if (err instanceof ApiError && err.status === 409) {
        // Staff started on it in the meantime: show the current status with the phone number.
        try {
          onRefused(await getRequestStatus(token));
        } catch {
          setError("Det gick inte att avboka just nu. Försök igen om en stund.");
        }
        return;
      }
      setError("Det gick inte att avboka just nu. Försök igen om en stund.");
    } finally {
      setSending(false);
    }
  }

  if (!open)
    return (
      <section className="cancel">
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          <CircleX aria-hidden="true" />
          Avboka förfrågan
        </button>
      </section>
    );

  return (
    <section className="cancel" aria-labelledby="cancel-heading">
      <h2 id="cancel-heading">Avboka förfrågan</h2>
      <p>
        Förfrågan och dina foton raderas direkt. Det går inte att ångra, men du är alltid välkommen
        att skicka en ny.
      </p>
      <form onSubmit={submit} noValidate>
        <div className={`field${reasonError ? " has-error" : ""}`}>
          <label htmlFor="cancel-reason">Varför vill du avboka?</label>
          <p className="hint" id="cancel-reason-hint">
            Svaret hjälper oss att bli bättre. Vi sparar det i 30 dagar, utan dina kontaktuppgifter.
          </p>
          <textarea
            {...fieldA11y("cancel-reason", reasonError, "hint")}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <FieldError id="cancel-reason-error" message={reasonError} />
        </div>
        <div className="nav">
          <button type="button" className="secondary" onClick={() => setOpen(false)}>
            <ArrowLeft aria-hidden="true" />
            Behåll förfrågan
          </button>
          <button type="submit" className="danger" disabled={sending}>
            <CircleX aria-hidden="true" />
            {sending ? "Avbokar…" : "Avboka och radera"}
          </button>
        </div>
      </form>
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Once staff have started, cancelling and changes go through the store by phone. */
function CallToCancel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="cancel">
      {open ? (
        <div className="call-to-cancel" role="status">
          <p>
            <strong>Vi har redan börjat planera hämtningen.</strong>
          </p>
          <p>Vill du avboka eller ändra något, {CALL_US}.</p>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          <PhoneCall aria-hidden="true" />
          Avboka eller ändra
        </button>
      )}
    </section>
  );
}
