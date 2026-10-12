import type { RequestFormInput } from "@hamtning/shared";
import { formatPostcode, normalizePostcode } from "@hamtning/shared";
import { useFormContext, useWatch } from "react-hook-form";
import { Link } from "react-router";
import { FieldError } from "../Field.js";
import { CONDITION_LABELS, formatDate, PART_HINTS, PART_LABELS } from "../labels.js";
import type { PhotoUploads } from "../usePhotoUploads.js";

interface Props {
  photos: PhotoUploads;
  onEdit: (step: number) => void;
}

function Section({
  title,
  step,
  onEdit,
  children,
}: {
  title: string;
  step: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="review-section">
      <div className="card-header">
        <h3>{title}</h3>
        <button
          type="button"
          className="link"
          onClick={() => onEdit(step)}
          aria-label={`Ändra ${title.toLowerCase()}`}
        >
          Ändra
        </button>
      </div>
      {children}
    </section>
  );
}

export function ReviewStep({ photos, onEdit }: Props) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<RequestFormInput>();
  const v = useWatch({ control }) as Partial<RequestFormInput>;
  const postcode = v.postcode ? (normalizePostcode(v.postcode) ?? v.postcode) : "";

  return (
    <>
      <p className="lead">Kontrollera uppgifterna innan du skickar.</p>

      <Section title="Kontaktuppgifter" step={0} onEdit={onEdit}>
        <p>
          {v.name}
          <br />
          {v.email} · {v.phone}
          <br />
          {v.street}, {postcode.length === 5 ? formatPostcode(postcode) : postcode} {v.city}
        </p>
      </Section>

      <Section title="Föremål" step={1} onEdit={onEdit}>
        <ul className="plain">
          {v.items?.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only summary in form order
            <li key={i}>
              <strong>
                {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
                {item.title}
              </strong>
              {item.condition && ` · ${CONDITION_LABELS[item.condition]}`}
              {item.description && <div className="muted">{item.description}</div>}
            </li>
          ))}
        </ul>
        <ul className="thumbs" aria-label="Foton">
          {photos.items
            .filter((p) => p.status === "done" && p.previewUrl)
            .map((p, i) => (
              <li key={p.id}>
                <img src={p.previewUrl} alt={`Foto ${i + 1}`} />
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Hämtning" step={2} onEdit={onEdit}>
        <ul className="plain">
          {v.timeWindows?.map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only summary in form order
            <li key={i}>
              {formatDate(w.date ?? "")},{" "}
              {w.part === "custom"
                ? `${w.fromTime}–${w.toTime}`
                : w.part && `${PART_LABELS[w.part].toLowerCase()} ${PART_HINTS[w.part]}`}
              {w.note && <span className="muted"> · {w.note}</span>}
            </li>
          ))}
        </ul>
        {(v.floor != null || v.hasElevator != null || v.accessNotes) && (
          <p className="muted">
            {[
              v.floor != null && `Våning ${v.floor}`,
              v.hasElevator === true && "hiss finns",
              v.hasElevator === false && "ingen hiss",
              v.accessNotes,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {v.message && <p className="muted">{v.message}</p>}
      </Section>

      <div className={`field consent${errors.consent ? " has-error" : ""}`}>
        <label className="checkbox">
          <input
            type="checkbox"
            {...register("consent")}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "consent-error" : undefined}
          />
          <span>
            Jag godkänner att mina uppgifter och foton hanteras enligt{" "}
            <Link to="/integritet" target="_blank">
              integritetspolicyn
            </Link>
            . De raderas senast 30 dagar efter att ärendet avslutats.
          </span>
        </label>
        <FieldError id="consent-error" message={errors.consent?.message} />
      </div>
    </>
  );
}
