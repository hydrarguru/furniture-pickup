import type { RequestFormInput } from "@hamtning/shared";
import { useFormContext } from "react-hook-form";
import { Field, fieldA11y } from "../Field.js";

export function ContactStep() {
  const {
    register,
    formState: { errors },
  } = useFormContext<RequestFormInput>();

  return (
    <>
      <p className="lead">Vi använder uppgifterna för att kontakta dig om hämtningen.</p>
      <Field id="name" label="Namn" error={errors.name?.message}>
        <input
          {...register("name")}
          {...fieldA11y("name", errors.name?.message)}
          autoComplete="name"
        />
      </Field>
      <Field
        id="email"
        label="E-post"
        hint="Du får en länk hit för att bekräfta förfrågan."
        error={errors.email?.message}
      >
        <input
          {...register("email")}
          {...fieldA11y("email", errors.email?.message, "hint")}
          type="email"
          autoComplete="email"
          inputMode="email"
        />
      </Field>
      <Field id="phone" label="Telefon" error={errors.phone?.message}>
        <input
          {...register("phone")}
          {...fieldA11y("phone", errors.phone?.message)}
          type="tel"
          autoComplete="tel"
        />
      </Field>
      <Field id="street" label="Gatuadress" error={errors.street?.message}>
        <input
          {...register("street")}
          {...fieldA11y("street", errors.street?.message)}
          autoComplete="street-address"
        />
      </Field>
      <div className="row">
        <Field id="postcode" label="Postnummer" error={errors.postcode?.message}>
          <input
            {...register("postcode")}
            {...fieldA11y("postcode", errors.postcode?.message)}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            className="short"
          />
        </Field>
        <Field id="city" label="Ort" error={errors.city?.message}>
          <input
            {...register("city")}
            {...fieldA11y("city", errors.city?.message)}
            autoComplete="address-level2"
          />
        </Field>
      </div>
    </>
  );
}
