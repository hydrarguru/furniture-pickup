import {
  type AdminRequestDetail,
  formatPostcode,
  PART_HOURS,
  STATUS_LABELS_SV,
  stockholmToday,
} from "@hamtning/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  CONDITION_LABELS,
  formatDate,
  formatDateTimeRange,
  formatDay,
  PART_LABELS,
} from "../../form/labels.js";
import { ApiError } from "../../lib/api.js";
import { formatStamp, StatusBadge } from "../labels.js";
import { useAddNote, useChangeStatus, useRequestDetail } from "../queries.js";

type Window = AdminRequestDetail["timeWindows"][number];

const windowTimes = (w: Window) =>
  w.part === "custom"
    ? { from: w.fromTime ?? "", to: w.toTime ?? "" }
    : { from: PART_HOURS[w.part].from, to: PART_HOURS[w.part].to };

const describeWindow = (w: Window) => {
  const { from, to } = windowTimes(w);
  return `${formatDate(w.date)}, ${w.part === "custom" ? "" : `${PART_LABELS[w.part].toLowerCase()} `}${from}–${to}`;
};

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const detail = useRequestDetail(id);

  if (detail.isPending) return <p className="muted">Laddar…</p>;
  if (detail.isError)
    return (
      <>
        <p className="banner" role="alert">
          {detail.error instanceof ApiError && detail.error.status === 404
            ? "Ärendet finns inte (eller har raderats)."
            : "Kunde inte hämta ärendet."}
        </p>
        <Link to="/admin">Till alla ärenden</Link>
      </>
    );
  return <Detail r={detail.data} />;
}

function Detail({ r }: { r: AdminRequestDetail }) {
  return (
    <article className="detail">
      <Link to="/admin" className="back">
        ← Alla ärenden
      </Link>
      <header className="detail-header">
        <h1>{r.name}</h1>
        <StatusBadge status={r.status} />
      </header>
      <p className="muted small">
        Inkom {formatStamp(r.createdAt)}
        {r.verifiedAt && ` · bekräftad ${formatStamp(r.verifiedAt)}`}
        {r.deleteAfter && ` · raderas automatiskt ${formatDay(r.deleteAfter)}`}
      </p>

      <div className="detail-grid">
        <div className="detail-col">
          <Actions r={r} />

          <section className="panel">
            <h2>Föremål</h2>
            <ul className="plain">
              {r.items.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.quantity > 1 ? `${item.quantity} × ` : ""}
                    {item.title}
                  </strong>
                  {[item.category, item.condition && CONDITION_LABELS[item.condition]]
                    .filter(Boolean)
                    .map((x) => ` · ${x}`)}
                  {item.description && <div className="muted">{item.description}</div>}
                </li>
              ))}
            </ul>
            <Gallery images={r.images} />
          </section>

          <section className="panel">
            <h2>Föreslagna tider</h2>
            <ul className="plain">
              {r.timeWindows.map((w) => (
                <li key={w.id}>
                  {describeWindow(w)}
                  {w.note && <span className="muted"> · {w.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <h2>Kontakt och plats</h2>
            <p>
              <a href={`tel:${r.phone}`}>{r.phone}</a>
              <br />
              <a href={`mailto:${r.email}`}>{r.email}</a>
            </p>
            <p>
              {r.street}
              <br />
              {formatPostcode(r.postcode)} {r.city}
            </p>
            <p className="muted">
              {[
                r.floor != null && `Våning ${r.floor}`,
                r.hasElevator === true && "hiss finns",
                r.hasElevator === false && "ingen hiss",
              ]
                .filter(Boolean)
                .join(" · ") || "Våning/hiss ej angivet"}
            </p>
            {r.accessNotes && <p>{r.accessNotes}</p>}
            {r.message && (
              <blockquote className="staff-message">
                <p className="muted">Meddelande från kunden</p>
                <p>{r.message}</p>
              </blockquote>
            )}
          </section>

          <Notes r={r} />
        </div>
      </div>
    </article>
  );
}

function Actions({ r }: { r: AdminRequestDetail }) {
  const change = useChangeStatus(r.id);
  const [mode, setMode] = useState<"none" | "accept" | "decline">("none");
  const error =
    change.error instanceof ApiError
      ? change.error.code === "date_in_past"
        ? "Datumet har redan passerat."
        : change.error.code === "cancelled_by_requester"
          ? "Kunden har avbokat ärendet."
          : "Ändringen kunde inte sparas."
      : change.error
        ? "Ändringen kunde inte sparas."
        : null;

  if (r.status === "cancelled")
    return (
      <section className="panel">
        <p>Kunden har avbokat förfrågan. Inga fler åtgärder behövs.</p>
      </section>
    );

  return (
    <section className="panel actions">
      {r.status === "accepted" && r.confirmedStart && (
        <p>
          <strong>Hämtning: {formatDateTimeRange(r.confirmedStart, r.confirmedEnd)}</strong>
        </p>
      )}
      {r.staffMessage && (
        <p className="muted">
          Meddelande till kunden: <em>{r.staffMessage}</em>
        </p>
      )}

      {mode === "none" && (
        <div className="action-buttons">
          {r.status === "new" && (
            <button
              type="button"
              className="secondary"
              disabled={change.isPending}
              onClick={() => change.mutate({ status: "in_progress" })}
            >
              Markera som pågående
            </button>
          )}
          <button type="button" onClick={() => setMode("accept")}>
            {r.status === "accepted" ? "Ändra hämtningstid…" : "Godkänn…"}
          </button>
          {r.status !== "declined" && (
            <button type="button" className="secondary" onClick={() => setMode("decline")}>
              Avslå…
            </button>
          )}
          {r.status !== "new" && (
            <button
              type="button"
              className="link"
              disabled={change.isPending}
              onClick={() => change.mutate({ status: "new" })}
            >
              Återställ till {STATUS_LABELS_SV.new.toLowerCase()}
            </button>
          )}
        </div>
      )}
      {mode === "accept" && (
        <AcceptForm
          r={r}
          busy={change.isPending}
          onCancel={() => setMode("none")}
          onSubmit={(confirmed, message) =>
            change.mutate(
              { status: "accepted", confirmed, message },
              { onSuccess: () => setMode("none") },
            )
          }
        />
      )}
      {mode === "decline" && (
        <DeclineForm
          busy={change.isPending}
          onCancel={() => setMode("none")}
          onSubmit={(message) =>
            change.mutate({ status: "declined", message }, { onSuccess: () => setMode("none") })
          }
        />
      )}
      {error && (
        <p className="banner" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AcceptForm({
  r,
  busy,
  onCancel,
  onSubmit,
}: {
  r: AdminRequestDetail;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (
    confirmed: { date: string; fromTime: string; toTime: string },
    message?: string,
  ) => void;
}) {
  const [choice, setChoice] = useState<string>(r.timeWindows[0]?.id ?? "custom");
  const [custom, setCustom] = useState({ date: "", fromTime: "", toTime: "" });
  const [message, setMessage] = useState(r.status === "accepted" ? (r.staffMessage ?? "") : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const w = r.timeWindows.find((x) => x.id === choice);
    const confirmed = w
      ? { date: w.date, fromTime: windowTimes(w).from, toTime: windowTimes(w).to }
      : custom;
    if (!confirmed.date || !confirmed.fromTime || !confirmed.toTime)
      return setError("Ange datum, från och till.");
    if (confirmed.fromTime >= confirmed.toTime)
      return setError("Från-tiden måste vara före till-tiden.");
    setError(null);
    onSubmit(confirmed, message.trim() || undefined);
  }

  return (
    <form onSubmit={submit} className="inline-form">
      <fieldset className="field">
        <legend>Hämtningstid</legend>
        {r.timeWindows.map((w) => (
          <label key={w.id} className="radio-line">
            <input
              type="radio"
              name="window"
              checked={choice === w.id}
              onChange={() => setChoice(w.id)}
            />
            {describeWindow(w)}
          </label>
        ))}
        <label className="radio-line">
          <input
            type="radio"
            name="window"
            checked={choice === "custom"}
            onChange={() => setChoice("custom")}
          />
          Annan tid
        </label>
        {choice === "custom" && (
          <div className="row">
            <div className="field">
              <label htmlFor="custom-date">Datum</label>
              <input
                id="custom-date"
                type="date"
                min={stockholmToday()}
                value={custom.date}
                onChange={(e) => setCustom({ ...custom, date: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="custom-from">Från</label>
              <input
                id="custom-from"
                type="time"
                value={custom.fromTime}
                onChange={(e) => setCustom({ ...custom, fromTime: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="custom-to">Till</label>
              <input
                id="custom-to"
                type="time"
                value={custom.toTime}
                onChange={(e) => setCustom({ ...custom, toTime: e.target.value })}
              />
            </div>
          </div>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="accept-message">
          Meddelande till kunden <span className="optional">(valfritt)</span>
        </label>
        <textarea
          id="accept-message"
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="t.ex. Vi ringer när vi är på väg."
        />
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Kunden får ett mejl med tiden och meddelandet.</p>
      <div className="nav">
        <button type="button" className="secondary" onClick={onCancel}>
          Avbryt
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Sparar…" : "Godkänn och meddela kunden"}
        </button>
      </div>
    </form>
  );
}

function DeclineForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (message?: string) => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(message.trim() || undefined);
      }}
    >
      <div className="field">
        <label htmlFor="decline-message">
          Meddelande till kunden <span className="optional">(valfritt)</span>
        </label>
        <textarea
          id="decline-message"
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="t.ex. Vi tar tyvärr inte emot madrasser."
        />
      </div>
      <p className="muted small">Kunden får ett mejl om att förfrågan inte godkändes.</p>
      <div className="nav">
        <button type="button" className="secondary" onClick={onCancel}>
          Avbryt
        </button>
        <button type="submit" className="danger" disabled={busy}>
          {busy ? "Sparar…" : "Avslå och meddela kunden"}
        </button>
      </div>
    </form>
  );
}

function Gallery({ images }: { images: AdminRequestDetail["images"] }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal?.();
    if (open === null && d.open) d.close?.();
  }, [open]);

  if (images.length === 0) return null;
  const step = (delta: number) =>
    setOpen((i) => (i === null ? i : (i + delta + images.length) % images.length));

  return (
    <>
      <ul className="gallery">
        {images.map((img, i) => (
          <li key={img.id}>
            <button
              type="button"
              className="gallery-thumb"
              onClick={() => setOpen(i)}
              aria-label={`Visa foto ${i + 1}`}
            >
              <img src={img.url} alt="" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="lightbox"
        aria-label="Foto"
        onClose={() => setOpen(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
      >
        {open !== null && images[open] && (
          <>
            <img src={images[open].url} alt={`Foto ${open + 1} av ${images.length}`} />
            <div className="lightbox-bar">
              <button
                type="button"
                className="secondary"
                onClick={() => step(-1)}
                aria-label="Föregående foto"
              >
                ←
              </button>
              <span>
                {open + 1} / {images.length}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => step(1)}
                aria-label="Nästa foto"
              >
                →
              </button>
              <button type="button" onClick={() => setOpen(null)}>
                Stäng
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

function describeEvent(e: AdminRequestDetail["events"][number]) {
  const who = e.employeeName ?? (e.type === "status_change" ? "Kunden" : "Systemet");
  if (e.type === "note") return { who, text: e.note ?? "" };
  if (e.type === "email_sent") return { who: "E-post", text: `Skickat: ${e.note ?? ""}` };
  const to = e.toStatus ? STATUS_LABELS_SV[e.toStatus] : "?";
  const from = e.fromStatus ? STATUS_LABELS_SV[e.fromStatus] : "?";
  return { who, text: `${from} → ${to}${e.note ? `: ${e.note}` : ""}` };
}

function Notes({ r }: { r: AdminRequestDetail }) {
  const addNote = useAddNote(r.id);
  const [note, setNote] = useState("");
  return (
    <section className="panel">
      <h2>Anteckningar och historik</h2>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          addNote.mutate(note.trim(), { onSuccess: () => setNote("") });
        }}
      >
        <div className="field">
          <label htmlFor="note" className="visually-hidden">
            Ny anteckning
          </label>
          <textarea
            id="note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Intern anteckning (syns inte för kunden)"
          />
        </div>
        <button type="submit" className="secondary" disabled={addNote.isPending || !note.trim()}>
          Spara anteckning
        </button>
        {addNote.isError && <p className="error">Anteckningen kunde inte sparas.</p>}
      </form>
      <ol className="history">
        {r.events.map((e) => {
          const { who, text } = describeEvent(e);
          return (
            <li key={e.id} className={`event-${e.type}`}>
              <span className="muted small">
                {formatStamp(e.createdAt)} · {who}
              </span>
              <span>{text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
