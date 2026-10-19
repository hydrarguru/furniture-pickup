import type { RequestFormInput } from "@hamtning/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { type Category, getCategories } from "../../lib/api.js";
import { Field, fieldA11y } from "../Field.js";
import { CONDITION_LABELS } from "../labels.js";
import { PhotoUploader } from "../PhotoUploader.js";
import type { PhotoUploads } from "../usePhotoUploads.js";

export const emptyItem = (): RequestFormInput["items"][number] => ({
  title: "",
  quantity: 1,
  description: "",
});

const MAX_ITEMS = 30;

function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    let active = true;
    // No categories (or an error) just hides the dropdown; it is optional.
    getCategories()
      .then((c) => active && setCategories(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return categories;
}

const optionalNumber = (v: unknown) => (v === "" || v == null ? undefined : Number(v));

export function ItemsStep({ photos }: { photos: PhotoUploads }) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<RequestFormInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const categories = useCategories();

  return (
    <>
      <p className="lead">
        Berätta vad du vill lämna. Lägg till en rad per sak eller grupp av saker.
      </p>

      <ol className="cards">
        {fields.map((field, i) => {
          const err = errors.items?.[i];
          const id = (name: string) => `items-${i}-${name}`;
          return (
            <li key={field.id} className="card">
              <div className="card-header">
                <h3>Föremål {i + 1}</h3>
                {fields.length > 1 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => remove(i)}
                    aria-label={`Ta bort föremål ${i + 1}`}
                  >
                    <Trash2 aria-hidden="true" />
                    Ta bort
                  </button>
                )}
              </div>
              <Field id={id("title")} label="Vad är det?" error={err?.title?.message}>
                <input
                  {...register(`items.${i}.title`)}
                  {...fieldA11y(id("title"), err?.title?.message)}
                  placeholder="t.ex. Soffa, 3-sits"
                />
              </Field>
              <div className="row">
                {categories.length > 0 && (
                  <Field id={id("category")} label="Kategori" optional>
                    <select
                      {...register(`items.${i}.categoryId`, { setValueAs: optionalNumber })}
                      id={id("category")}
                    >
                      <option value="">Välj…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field id={id("condition")} label="Skick" optional>
                  <select
                    {...register(`items.${i}.condition`, { setValueAs: (v) => v || undefined })}
                    id={id("condition")}
                  >
                    <option value="">Välj…</option>
                    {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={id("quantity")} label="Antal" error={err?.quantity?.message}>
                  <input
                    {...register(`items.${i}.quantity`, { setValueAs: optionalNumber })}
                    {...fieldA11y(id("quantity"), err?.quantity?.message)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    className="short"
                  />
                </Field>
              </div>
              <Field
                id={id("description")}
                label="Beskrivning"
                optional
                error={err?.description?.message}
              >
                <textarea
                  {...register(`items.${i}.description`)}
                  {...fieldA11y(id("description"), err?.description?.message)}
                  rows={2}
                  placeholder="Mått, material, eventuella skador"
                />
              </Field>
            </li>
          );
        })}
      </ol>
      {fields.length < MAX_ITEMS && (
        <button type="button" className="secondary" onClick={() => append(emptyItem())}>
          <Plus aria-hidden="true" />
          Lägg till föremål
        </button>
      )}

      <PhotoUploader photos={photos} error={errors.imageKeys?.message} />
    </>
  );
}
