import { Link, useLocation } from "react-router";

export function ThanksPage() {
  const state = useLocation().state as { email?: string; statusToken?: string } | null;
  const email = state?.email;
  const statusUrl = state?.statusToken ? `/arende/${state.statusToken}` : null;
  return (
    <>
      <h1>Tack!</h1>
      <p>
        Vi har skickat en bekräftelselänk till {email ? <strong>{email}</strong> : "din e-post"}.
        Klicka på länken inom 24 timmar, annars tas förfrågan bort.
      </p>
      {statusUrl && (
        <p>
          Du kan följa ditt ärende här:{" "}
          <Link to={statusUrl}>{window.location.origin + statusUrl}</Link>
        </p>
      )}
      <p>Hittar du inte mejlet? Titta i skräpposten.</p>
      <p>
        <Link to="/boka">Skicka en ny förfrågan</Link>
      </p>
    </>
  );
}
