import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { ListFilter } from "../api.js";
import { daysUntil, deletionCountdown, formatStamp, StatusBadges } from "../labels.js";
import { CancellationList } from "./CancellationList.js";

/** Open requests this close to automatic deletion get a warning in the list. */
const WARN_DAYS = 3;

import { useRequestList, useSummary } from "../queries.js";

/** Customer cancellations are deleted requests, so their tab shows the reasons log instead. */
type Tab = ListFilter | "cancellations";

const TABS: { filter: Tab; label: string }[] = [
  { filter: "new", label: "Nya" },
  { filter: "in_progress", label: "Under behandling" },
  { filter: "accepted", label: "Godkända" },
  { filter: "on_the_way", label: "På väg" },
  { filter: "declined", label: "Nekade" },
  { filter: "cancellations", label: "Avbokade" },
  { filter: "all", label: "Alla" },
];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.filter === v);

export function RequestListPage() {
  // Tab and search live in the URL, so they survive reloads and the back button.
  const [params, setParams] = useSearchParams();
  const tab = params.get("status");
  const status: Tab = isTab(tab) ? tab : "new";
  const showCancellations = status === "cancellations";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const counts = useSummary(false).data?.counts;
  const list = useRequestList(showCancellations ? "all" : status, q, !showCancellations);

  // Debounce typing into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() === q) return;
      setParams(
        (p) => {
          if (search.trim()) p.set("q", search.trim());
          else p.delete("q");
          return p;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [search, q, setParams]);

  const rows = list.data?.pages.flatMap((p) => p.requests) ?? [];
  const deletedName = (useLocation().state as { deletedName?: string } | null)?.deletedName;

  return (
    <>
      <h1>Ärenden</h1>
      {deletedName && (
        <p className="banner success" role="status">
          Ärendet för {deletedName} har raderats.
        </p>
      )}
      <div className="list-tools">
        <div className="tabs" role="tablist" aria-label="Status">
          {TABS.map((t) => (
            <button
              key={t.filter}
              type="button"
              role="tab"
              aria-selected={status === t.filter}
              className={status === t.filter ? "tab active" : "tab"}
              onClick={() =>
                setParams((p) => {
                  p.set("status", t.filter);
                  return p;
                })
              }
            >
              {t.label}
              {t.filter !== "all" && t.filter !== "cancellations" && counts && (
                <span className="count">{counts[t.filter]}</span>
              )}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          placeholder={
            showCancellations ? "Sök anledning, föremål…" : "Sök namn, adress, telefon, föremål…"
          }
          aria-label={showCancellations ? "Sök avbokningar" : "Sök ärenden"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {showCancellations ? (
        <CancellationList q={q} />
      ) : list.isPending ? (
        <p className="muted">Laddar…</p>
      ) : list.isError ? (
        <p className="banner" role="alert">
          Kunde inte hämta ärenden.
        </p>
      ) : rows.length === 0 ? (
        <p className="empty">{q ? `Inga träffar för "${q}".` : "Inga ärenden här."}</p>
      ) : (
        <ul className="request-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                to={`/admin/arenden/${r.id}`}
                className={`request-row${r.seen ? "" : " unseen"}`}
              >
                {r.thumbnailUrl ? (
                  <img src={r.thumbnailUrl} alt="" className="thumb" loading="lazy" />
                ) : (
                  <span className="thumb" aria-hidden="true" />
                )}
                <span className="row-main">
                  <span className="row-title">
                    {!r.seen && <span className="dot" title="Inte öppnad" />}
                    {r.name}
                    <span className="muted"> · {r.city}</span>
                  </span>
                  <span className="row-items">{r.itemSummary}</span>
                  <span className="muted small">
                    {formatStamp(r.verifiedAt ?? r.createdAt)} · {r.imageCount} foton
                    {(r.status === "new" || r.status === "in_progress") &&
                      r.deleteAfter &&
                      daysUntil(r.deleteAfter) < WARN_DAYS && (
                        <span className="deletion-warning">
                          {" "}
                          · {deletionCountdown(r.deleteAfter)}
                        </span>
                      )}
                  </span>
                </span>
                <StatusBadges status={r.status} verifiedAt={r.verifiedAt} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!showCancellations && list.hasNextPage && (
        <button
          type="button"
          className="secondary load-more"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "Laddar…" : "Visa fler"}
        </button>
      )}
    </>
  );
}
