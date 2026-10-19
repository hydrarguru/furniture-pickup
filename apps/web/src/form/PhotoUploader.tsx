import { MAX_IMAGES } from "@hamtning/shared";
import { Camera, RotateCw } from "lucide-react";
import { FieldError } from "./Field.js";
import type { PhotoUploads } from "./usePhotoUploads.js";

export const PHOTO_INPUT_ID = "photo-add";

const STATUS_TEXT = {
  processing: "Förbereder…",
  uploading: "Laddar upp…",
  done: "Uppladdad",
  error: "",
} as const;

export function PhotoUploader({ photos, error }: { photos: PhotoUploads; error?: string }) {
  return (
    <fieldset className={`photos${error ? " has-error" : ""}`}>
      <legend>Foton</legend>
      <p className="hint" id="photos-hint">
        Ta eller välj foton på det du vill lämna. Minst 1 och högst {MAX_IMAGES} foton. Bilderna
        förminskas och platsinformation tas bort innan de skickas.
      </p>

      {photos.items.length > 0 && (
        <ul className="photo-grid">
          {photos.items.map((p, i) => (
            <li key={p.id} className={`photo photo-${p.status}`}>
              {p.previewUrl ? (
                <img src={p.previewUrl} alt={`Foto ${i + 1}`} />
              ) : (
                <div className="photo-placeholder" aria-hidden="true" />
              )}
              <div className="photo-status" aria-live="polite">
                {p.status === "uploading" && (
                  <progress max={1} value={p.progress} aria-label={`Uppladdning foto ${i + 1}`} />
                )}
                {p.status === "error" ? (
                  <>
                    <span className="error">{p.error}</span>
                    {p.blob && (
                      <button type="button" className="link" onClick={() => photos.retry(p.id)}>
                        <RotateCw aria-hidden="true" />
                        Försök igen
                      </button>
                    )}
                  </>
                ) : (
                  <span className={p.status === "done" ? "visually-hidden" : ""}>
                    {STATUS_TEXT[p.status]}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="photo-remove"
                aria-label={`Ta bort foto ${i + 1}`}
                onClick={() => photos.remove(p.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {photos.canAdd && (
        <div className="photo-add">
          <label htmlFor={PHOTO_INPUT_ID} className="button secondary">
            <Camera aria-hidden="true" />
            {photos.items.length ? "Lägg till fler foton" : "Lägg till foton"}
          </label>
          <input
            id={PHOTO_INPUT_ID}
            className="visually-hidden"
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            aria-describedby={error ? "photos-hint photos-error" : "photos-hint"}
            onChange={(e) => {
              photos.addFiles(Array.from(e.target.files ?? []));
              e.target.value = ""; // allow picking the same file again after removing it
            }}
          />
        </div>
      )}
      {photos.notice && <p className="notice">{photos.notice}</p>}
      <FieldError id="photos-error" message={error} />
    </fieldset>
  );
}
