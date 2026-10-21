import { useQueryClient } from "@tanstack/react-query";
import { ClipboardList, LogOut, Menu, Tags, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import storeIcon from "../../assets/favicon.ico";
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
  // The burger menu on narrow screens; on wider ones the menu is always shown and this is unused.
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();

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
    document.title =
      newCount > 0
        ? `(${newCount}) Ärenden – Glädjens Secondhand`
        : "Ärenden – Glädjens Secondhand";
  }, [newCount]);

  // Going somewhere closes the menu, so the page isn't hidden behind it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation on purpose
  useEffect(() => setMenuOpen(false), [pathname, search]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

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
          {/* The icon alone is the link, so its alt text is the link's name. */}
          <img src={storeIcon} alt="Glädjens Secondhand" width={32} height={32} />
        </Link>
        <button
          type="button"
          className="menu-toggle secondary"
          aria-expanded={menuOpen}
          aria-controls="admin-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="visually-hidden">Meny</span>
          {/* The count in the menu is hidden while it is closed, so it shows here too. */}
          {newCount > 0 && !menuOpen && (
            <span className="badge" aria-hidden="true">
              {newCount}
            </span>
          )}
        </button>
        <div id="admin-menu" className={menuOpen ? "admin-menu open" : "admin-menu"}>
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
        </div>
      </header>
      {stream === "down" && (
        <p className="admin-offline" role="status">
          Live-uppdateringar är tillfälligt nere. Listan uppdateras var 30:e sekund.
        </p>
      )}
      <main className="admin-main">
        {/* A new page (Ärenden, Kategorier, one ärende) fades in like a new tab of the list does.
            Keyed on the path only, so switching list tabs (?status=) doesn't replay it. */}
        <div key={pathname} className="page">
          <Outlet />
        </div>
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
