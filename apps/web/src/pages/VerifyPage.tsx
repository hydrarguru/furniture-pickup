import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, verifyRequest } from "../lib/api.js";

type State = "verifying" | "expired" | "invalid" | "error";

/**
 * Landing page for the link in the verification email. Verification is a POST made from
 * here (not a GET on the link itself), so mail scanners that prefetch links can't verify.
 */
export function VerifyPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("verifying");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    verifyRequest(token)
      .then(() => navigate(`/arende/${token}`, { replace: true, state: { justVerified: true } }))
      .catch((err) => {
        if (!(err instanceof ApiError)) return setState("error");
        if (err.status === 410) return setState("expired");
        setState(err.status === 404 || err.status === 400 ? "invalid" : "error");
      });
  }, [token, navigate]);

  if (state === "verifying")
    return (
      <p role="status" className="lead">
        Bekräftar din förfrågan…
      </p>
    );

  return (
    <>
      <h1>{state === "expired" ? "Länken har gått ut" : "Förfrågan kunde inte bekräftas"}</h1>
      <p>
        {state === "expired" &&
          "Bekräftelselänken gällde i 24 timmar. Förfrågan har inte skickats till oss, så fyll i formuläret igen."}
        {state === "invalid" &&
          "Länken är ogiltig eller så har förfrågan redan raderats. Kontrollera att du kopierat hela länken från mejlet."}
        {state === "error" && "Något gick fel. Försök igen om en stund."}
      </p>
      <p>
        {state === "error" ? (
          <button type="button" onClick={() => window.location.reload()}>
            Försök igen
          </button>
        ) : (
          <Link to="/">Till formuläret</Link>
        )}
      </p>
    </>
  );
}
