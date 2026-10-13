import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ListFilter } from "../api.js";
import { formatStamp, StatusBadge } from "../labels.js";
import { useRequestList, useSummary } from "../queries.js";

const TABS: { filter: ListFilter; label: string }[] = [
  { filter: "new", label: "Nya" },
  { filter: "in_progress", label: "Pågående" },
  { filter: "accepted", label: "Godkända" },
  { filter: "declined", label: "Avslagna" },
  { filter: "cancelled", label: "Avbokade" },
  { filter: "all", label: "Alla" },
];

const isFilter = (v: string | null): v is ListFilter => TABS.some((t) => t.filter === v);

export function RequestListPage() {
  // Tab and search live in the URL, so they survive reloads and the back button.
  const [params, setParams] = useSearchParams();
  const status = isFilter(params.get("status")) ? (params.get("status") as ListFilter) : "new";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const counts = useSummary(false).data?.counts;
  const list = useRequestList(status, q);

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

  return (
    <>
      <h1>Ärenden</h1>
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
              {t.filter !== "all" && counts && <span className="count">{counts[t.filter]}</span>}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          placeholder="Sök namn, adress, telefon, föremål…"
          aria-label="Sök ärenden"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {list.isPending ? (
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
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
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
