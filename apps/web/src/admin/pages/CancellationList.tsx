import { RETENTION_DAYS_CLOSED } from "@hamtning/shared";
import { formatStamp } from "../labels.js";
import { useCancellations } from "../queries.js";

/** The "Avbokade" tab on the request list: why customers cancelled before staff started. */
export function CancellationList({ q }: { q: string }) {
  const list = useCancellations();
  const needle = q.toLowerCase();
  const rows = (list.data ?? []).filter(
    (c) => !needle || `${c.reason} ${c.items}`.toLowerCase().includes(needle),
  );

  return (
    <>
      <p className="muted">
        Förfrågningar som kunden själv avbokade innan ni hade börjat på dem. Själva förfrågan,
        kontaktuppgifterna och fotona raderas direkt; bara anledningen sparas, i{" "}
        {RETENTION_DAYS_CLOSED} dagar.
      </p>
      {list.isPending ? (
        <p className="muted">Laddar…</p>
      ) : list.isError ? (
        <p className="banner" role="alert">
          Det gick inte att hämta avbokningarna.
        </p>
      ) : rows.length === 0 ? (
        <p className="empty">
          {q
            ? `Inga träffar för "${q}".`
            : `Inga avbokningar de senaste ${RETENTION_DAYS_CLOSED} dagarna.`}
        </p>
      ) : (
        <table className="cancellation-table">
          <thead>
            <tr>
              <th scope="col">Avbokad</th>
              <th scope="col">Föremål</th>
              <th scope="col">Anledning</th>
              <th scope="col">Skickad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{formatStamp(c.cancelledAt)}</td>
                <td>{c.items}</td>
                <td className="reason">{c.reason}</td>
                <td className="muted">{formatStamp(c.requestCreatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
