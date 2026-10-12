import { Link, useLocation } from "react-router";

export function ThanksPage() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  return (
    <>
      <h1>Tack!</h1>
      <p>
        Vi har skickat en bekräftelselänk till {email ? <strong>{email}</strong> : "din e-post"}.
        Klicka på länken inom 24 timmar, annars tas förfrågan bort.
      </p>
      <p>Hittar du inte mejlet? Titta i skräpposten.</p>
      <p>
        <Link to="/">Skicka en ny förfrågan</Link>
      </p>
    </>
  );
}
