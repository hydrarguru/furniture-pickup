import { useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../lib/api.js";
import { adminApi } from "../api.js";
import { keys, useMe } from "../queries.js";

export function LoginPage() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/admin";
  const qc = useQueryClient();
  const me = useMe();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to={from} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const employee = await adminApi.login(
        String(data.get("username")),
        String(data.get("password")),
      );
      qc.setQueryData(keys.me, employee);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Fel användarnamn eller lösenord."
          : err instanceof ApiError && err.status === 429
            ? "För många försök. Vänta en stund och försök igen."
            : "Det gick inte att logga in just nu.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login">
      <h1>Logga in</h1>
      <p className="muted">För personal i butiken.</p>
      <form onSubmit={submit} className="wizard">
        <div className="field">
          <label htmlFor="login-username">Användarnamn</label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">Lösenord</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <div className="nav">
          <button type="submit" disabled={busy}>
            <LogIn aria-hidden="true" />
            {busy ? "Loggar in…" : "Logga in"}
          </button>
        </div>
      </form>
    </main>
  );
}
