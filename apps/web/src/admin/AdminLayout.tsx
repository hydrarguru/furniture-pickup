import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LogOut, Tags } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { ApiError } from "../lib/api.js";
import { ThemeToggle } from "../ThemeToggle.js";
import { adminApi } from "./api.js";
import { useMe, useSummary } from "./queries.js";
import { type NewRequestToast, useNotificationStream } from "./useNotificationStream.js";

const TOAST_MS = 8000;

type Toast = ({ kind: "new" } & NewRequestToast) | { kind: "cancelled"; id: string };

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
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((toast: Toast) => {
    setToasts((t) => [...t, toast]);
    setTimeout(() => setToasts((t) => t.filter((x) => x !== toast)), TOAST_MS);
  }, []);
  const onNewRequest = useCallback((r: NewRequestToast) => show({ kind: "new", ...r }), [show]);
  const onCancelled = useCallback((r: { id: string }) => show({ kind: "cancelled", ...r }), [show]);
  const stream = useNotificationStream(onNewRequest, onCancelled);
  // The same number as the "Nya" tab: every new request, opened or not.
  const newCount = useSummary(stream !== "open").data?.counts.new ?? 0;

  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) Ärenden – Glädjens Secondhand` : "Ärenden – Glädjens Secondhand";
  }, [newCount]);

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
          Glädjens Secondhand
        </Link>
        <nav aria-label="Admin">
          <NavLink to="/admin" end>
            <ClipboardList aria-hidden="true" />
            Ärenden
            {newCount > 0 && (
              <span className="badge">
                {newCount}
                <span className="visually-hidden"> nya</span>
              </span>
            )}
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin/kategorier">
              <Tags aria-hidden="true" />
              Kategorier
            </NavLink>
          )}
        </nav>
        <div className="admin-user">
          <span className="muted">{name}</span>
          <ThemeToggle />
          <button type="button" className="link" onClick={logout}>
            <LogOut aria-hidden="true" />
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
        {toasts.map((t) =>
          t.kind === "new" ? (
            <div key={`new-${t.id}`} className="toast">
              <strong>Ny förfrågan</strong> från {t.name}, {t.city}.{" "}
              <Link to={`/admin/arenden/${t.id}`}>Öppna</Link>
            </div>
          ) : (
            <div key={`cancelled-${t.id}`} className="toast toast-cancelled">
              <strong>En kund avbokade</strong> och förfrågan är raderad.{" "}
              <Link to="/admin?status=cancellations">Se anledning</Link>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
