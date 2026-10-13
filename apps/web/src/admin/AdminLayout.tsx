import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ApiError } from "../lib/api.js";
import { adminApi } from "./api.js";
import { useMe, useSummary } from "./queries.js";
import { type NewRequestToast, useNotificationStream } from "./useNotificationStream.js";

const TOAST_MS = 8000;

export function AdminLayout() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <p className="admin-loading">Laddar…</p>;
  if (me.error instanceof ApiError && me.error.status === 401)
    return (
      <Navigate
        to="/admin/logga-in"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  if (me.error || !me.data)
    return (
      <p className="banner" role="alert">
        Det gick inte att nå servern. Ladda om sidan.
      </p>
    );
  return <Shell name={me.data.name} isAdmin={me.data.role === "admin"} />;
}

function Shell({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<NewRequestToast[]>([]);

  const onNewRequest = useCallback((r: NewRequestToast) => {
    setToasts((t) => [...t, r]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== r.id)), TOAST_MS);
  }, []);
  const stream = useNotificationStream(onNewRequest);
  const unseen = useSummary(stream !== "open").data?.unseenCount ?? 0;

  useEffect(() => {
    document.title = unseen > 0 ? `(${unseen}) Ärenden – Admin` : "Ärenden – Admin";
  }, [unseen]);

  async function logout() {
    try {
      await adminApi.logout();
    } finally {
      qc.clear();
      navigate("/admin/logga-in", { replace: true });
    }
  }

  return (
    <div className="admin">
      <header className="admin-header">
        <Link to="/admin" className="brand">
          Hämtning · Admin
        </Link>
        <nav aria-label="Admin">
          <NavLink to="/admin" end>
            Ärenden
            {unseen > 0 && (
              <span className="badge">
                {unseen}
                <span className="visually-hidden"> nya oöppnade</span>
              </span>
            )}
          </NavLink>
          {isAdmin && <NavLink to="/admin/kategorier">Kategorier</NavLink>}
        </nav>
        <div className="admin-user">
          <span className="muted">{name}</span>
          <button type="button" className="link" onClick={logout}>
            Logga ut
          </button>
        </div>
      </header>
      {stream === "down" && (
        <p className="admin-offline" role="status">
          Live-uppdateringar är tillfälligt nere. Listan uppdateras var 30:e sekund.
        </p>
      )}
      <main className="admin-main">
        <Outlet />
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <strong>Ny förfrågan</strong> från {t.name}, {t.city}.{" "}
            <Link to={`/admin/arenden/${t.id}`}>Öppna</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
