import {
  type RequestFormInput,
  type RequestForm as RequestFormValues,
  requestFormSchema,
} from "@hamtning/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { type FieldErrors, type FieldPath, FormProvider, get, useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { ApiError, submitRequest } from "../lib/api.js";
import { clearDraft, loadDraft, saveDraft } from "../lib/draft.js";
import { PHOTO_INPUT_ID } from "./PhotoUploader.js";
import { ContactStep } from "./steps/ContactStep.js";
import { emptyItem, ItemsStep } from "./steps/ItemsStep.js";
import { emptyWindow, PickupStep } from "./steps/PickupStep.js";
import { ReviewStep } from "./steps/ReviewStep.js";
import { Turnstile } from "./Turnstile.js";
import { usePhotoUploads } from "./usePhotoUploads.js";

const STEPS: { title: string; fields: FieldPath<RequestFormInput>[] }[] = [
  { title: "Dina uppgifter", fields: ["name", "email", "phone", "street", "postcode", "city"] },
  { title: "Föremål och foton", fields: ["items", "imageKeys"] },
  { title: "Hämtning", fields: ["floor", "hasElevator", "accessNotes", "timeWindows", "message"] },
  { title: "Granska och skicka", fields: ["consent"] },
];
const LAST = STEPS.length - 1;

const defaults = (): Partial<RequestFormInput> => ({
  name: "",
  email: "",
  phone: "",
  street: "",
  postcode: "",
  city: "",
  accessNotes: "",
  message: "",
  items: [emptyItem()],
  timeWindows: [emptyWindow() as RequestFormInput["timeWindows"][number]],
  imageKeys: [],
});

const WAIT_FOR_PHOTOS = "Vänta tills alla foton har laddats upp.";
const WAIT_FOR_CHECK = "Vänta tills säkerhetskontrollen nedan är klar.";

function submitErrorMessage(err: unknown) {
  if (!(err instanceof ApiError))
    return "Det gick inte att nå oss. Kontrollera anslutningen och försök igen.";
  if (err.status === 429) return "Du har skickat för många förfrågningar. Försök igen om en timme.";
  if (err.code === "turnstile_failed") return "Säkerhetskontrollen misslyckades. Försök igen.";
  if (err.code === "invalid_images")
    // Most likely the 2-hour upload window passed while the form was open.
    return "Fotona kunde inte tas emot. Gå tillbaka, ta bort dem och ladda upp dem igen.";
  return "Något gick fel när förfrågan skulle skickas. Försök igen om en stund.";
}

export function RequestForm() {
  const navigate = useNavigate();
  const form = useForm<RequestFormInput, unknown, RequestFormValues>({
    resolver: zodResolver(requestFormSchema),
    mode: "onTouched",
    defaultValues: { ...defaults(), ...loadDraft() },
  });
  const { setValue, trigger, watch, getFieldState, handleSubmit, formState } = form;
  const photos = usePhotoUploads();
  const [step, setStep] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  // The uploader owns the photos; the form only sees the finished keys.
  useEffect(() => {
    setValue("imageKeys", photos.keys, {
      shouldValidate: Boolean(getFieldState("imageKeys").error),
    });
  }, [photos.keys, setValue, getFieldState]);

  useEffect(() => {
    const sub = watch((values) => saveDraft(values as Partial<RequestFormInput>));
    return () => sub.unsubscribe();
  }, [watch]);

  // Move focus to the new step's heading so screen readers announce it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on step change only
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
    window.scrollTo?.({ top: 0 });
  }, [step]);

  const goTo = (next: number) => {
    setBanner(null);
    setStep(next);
  };

  async function next() {
    const current = STEPS[step] as (typeof STEPS)[number];
    const valid = await trigger(current.fields, { shouldFocus: true });
    if (!valid) {
      if (step === 1 && getFieldState("imageKeys").error && !getFieldState("items").error) {
        document.getElementById(PHOTO_INPUT_ID)?.focus();
      }
      return;
    }
    if (step === 1 && photos.busy) {
      setBanner(WAIT_FOR_PHOTOS);
      return;
    }
    goTo(step + 1);
  }

  async function onValid(values: RequestFormValues) {
    if (photos.busy) {
      setBanner(WAIT_FOR_PHOTOS);
      return;
    }
    if (!turnstileToken) {
      setBanner(WAIT_FOR_CHECK);
      return;
    }
    setBanner(null);
    try {
      await submitRequest(values, turnstileToken);
      clearDraft();
      navigate("/tack", { state: { email: values.email } });
    } catch (err) {
      setBanner(submitErrorMessage(err));
      // The server has consumed the token whatever the outcome: drop it and get a fresh one.
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    }
  }

  function onInvalid(errors: FieldErrors<RequestFormInput>) {
    const first = STEPS.findIndex((s) => s.fields.some((f) => get(errors, f)));
    if (first >= 0 && first !== step) goTo(first);
  }

  const current = STEPS[step] as (typeof STEPS)[number];

  return (
    <FormProvider {...form}>
      <form className="wizard" noValidate onSubmit={handleSubmit(onValid, onInvalid)}>
        <ol className="steps" aria-label="Steg">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={i === step ? "current" : i < step ? "done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="visually-hidden">
                Steg {i + 1}: {s.title}
              </span>
            </li>
          ))}
        </ol>
        <p className="step-count">
          Steg {step + 1} av {STEPS.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1}>
          {current.title}
        </h2>

        {/* All steps stay mounted so inputs keep their state; only the current one is shown. */}
        <section hidden={step !== 0}>
          <ContactStep />
        </section>
        <section hidden={step !== 1}>
          <ItemsStep photos={photos} />
        </section>
        <section hidden={step !== 2}>
          <PickupStep />
        </section>
        <section hidden={step !== LAST}>
          <ReviewStep photos={photos} onEdit={goTo} />
        </section>

        {/* Mounted only on the last step so the token is fresh when the user submits. */}
        {step === LAST && <Turnstile onToken={setTurnstileToken} resetSignal={turnstileReset} />}

        {banner && (
          <p className="banner" role="alert">
            {banner}
          </p>
        )}

        <div className="nav">
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => goTo(step - 1)}>
              Tillbaka
            </button>
          )}
          {step < LAST ? (
            <button type="button" onClick={next}>
              Nästa
            </button>
          ) : (
            <button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? "Skickar…" : "Skicka förfrågan"}
            </button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
