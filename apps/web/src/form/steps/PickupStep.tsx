import { MAX_TIME_WINDOWS, pickupDateRange, type RequestFormInput } from "@hamtning/shared";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Field, FieldError, fieldA11y } from "../Field.js";
import { PART_HINTS, PART_LABELS } from "../labels.js";

export const emptyWindow = (): Partial<RequestFormInput["timeWindows"][number]> => ({
  date: "",
  fromTime: "",
  toTime: "",
  note: "",
});

const ELEVATOR_OPTIONS = [
  { value: true, label: "Ja" },
  { value: false, label: "Nej" },
  { value: undefined, label: "Vet ej" },
] as const;

export function PickupStep() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<RequestFormInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "timeWindows" });
  const windows = useWatch({ control, name: "timeWindows" });
  const { min, max } = pickupDateRange();

  return (
    <>
      <h3>Hur når vi sakerna?</h3>
      <div className="row">
        <Field id="floor" label="Våning" optional error={errors.floor?.message}>
          <input
            {...register("floor", {
              setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
            })}
            {...fieldA11y("floor", errors.floor?.message)}
            type="number"
            inputMode="numeric"
            className="short"
          />
        </Field>
        <Controller
          control={control}
          name="hasElevator"
          render={({ field }) => (
            <fieldset className="field">
              <legend>Finns hiss?</legend>
              <div className="segmented">
                {ELEVATOR_OPTIONS.map((o) => (
                  <label key={o.label}>
                    <input
                      type="radio"
                      name={field.name}
                      checked={field.value === o.value}
                      onChange={() => field.onChange(o.value)}
                      onBlur={field.onBlur}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        />
      </div>
      <Field
        id="accessNotes"
        label="Bra att veta"
        optional
        hint="Portkod, trappor, smala passager, var vi kan parkera"
        error={errors.accessNotes?.message}
      >
        <textarea
          {...register("accessNotes")}
          {...fieldA11y("accessNotes", errors.accessNotes?.message, "hint")}
          rows={2}
        />
      </Field>

      <h3>När passar det?</h3>
      <p className="hint">
        Föreslå upp till {MAX_TIME_WINDOWS} tider. Vi bekräftar en av dem eller hör av oss om en
        annan tid.
      </p>
      <ol className="cards">
        {fields.map((field, i) => {
          const err = errors.timeWindows?.[i];
          const id = (name: string) => `timeWindows-${i}-${name}`;
          const isCustom = windows?.[i]?.part === "custom";
          return (
            <li key={field.id} className="card">
              <div className="card-header">
                <h4>Förslag {i + 1}</h4>
                {fields.length > 1 && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => remove(i)}
                    aria-label={`Ta bort förslag ${i + 1}`}
                  >
                    Ta bort
                  </button>
                )}
              </div>
              <Field id={id("date")} label="Datum" error={err?.date?.message}>
                <input
                  {...register(`timeWindows.${i}.date`)}
                  {...fieldA11y(id("date"), err?.date?.message)}
                  type="date"
                  min={min}
                  max={max}
                />
              </Field>
              <fieldset
                className={`field${err?.part ? " has-error" : ""}`}
                aria-describedby={err?.part ? id("part-error") : undefined}
              >
                <legend>Tid på dagen</legend>
                <div className="choice-grid">
                  {(Object.keys(PART_LABELS) as (keyof typeof PART_LABELS)[]).map((part) => (
                    <label key={part} className="choice">
                      <input type="radio" value={part} {...register(`timeWindows.${i}.part`)} />
                      <span>
                        {PART_LABELS[part]}
                        <small>{PART_HINTS[part]}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <FieldError id={id("part-error")} message={err?.part?.message} />
              </fieldset>
              {isCustom && (
                <div className="row">
                  <Field id={id("from")} label="Från" error={err?.fromTime?.message}>
                    <input
                      {...register(`timeWindows.${i}.fromTime`)}
                      {...fieldA11y(id("from"), err?.fromTime?.message)}
                      type="time"
                      step={900}
                    />
                  </Field>
                  <Field id={id("to")} label="Till" error={err?.toTime?.message}>
                    <input
                      {...register(`timeWindows.${i}.toTime`)}
                      {...fieldA11y(id("to"), err?.toTime?.message)}
                      type="time"
                      step={900}
                    />
                  </Field>
                </div>
              )}
              <Field id={id("note")} label="Kommentar" optional error={err?.note?.message}>
                <input
                  {...register(`timeWindows.${i}.note`)}
                  {...fieldA11y(id("note"), err?.note?.message)}
                />
              </Field>
            </li>
          );
        })}
      </ol>
      <FieldError message={errors.timeWindows?.message ?? errors.timeWindows?.root?.message} />
      {fields.length < MAX_TIME_WINDOWS && (
        <button
          type="button"
          className="secondary"
          onClick={() => append(emptyWindow() as RequestFormInput["timeWindows"][number])}
        >
          Föreslå en till tid
        </button>
      )}

      <Field id="message" label="Övrigt" optional error={errors.message?.message}>
        <textarea
          {...register("message")}
          {...fieldA11y("message", errors.message?.message)}
          rows={3}
        />
      </Field>
    </>
  );
}
