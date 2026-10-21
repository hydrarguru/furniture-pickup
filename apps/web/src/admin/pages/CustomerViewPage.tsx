import { Eye } from "lucide-react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../lib/api.js";
import { StatusDetails } from "../../pages/StatusPage.js";
import { useCustomerView } from "../queries.js";

/**
 * The customer's status page as staff see it: the same content, read-only. It loads through the
 * staff session, so there is no customer link involved and nothing here can cancel the request.
 */
export function CustomerViewPage() {
  const { id = "" } = useParams();
  const view = useCustomerView(id);

  return (
    <div className="customer-view">
      <Link to={`/admin/arenden/${id}`} className="back">
        ← Tillbaka till ärendet
      </Link>
      <p className="banner info">
        <Eye aria-hidden="true" />
        <span>
          <strong>Förhandsvisning.</strong> Så här ser kunden sin statussida. Inget du gör här
          ändrar ärendet.
        </span>
      </p>
      {view.isPending ? (
        <p className="muted">Laddar…</p>
      ) : view.isError ? (
        <p className="banner" role="alert">
          {view.error instanceof ApiError && view.error.status === 404
            ? "Ärendet finns inte (eller har raderats)."
            : "Kunde inte hämta statussidan."}
        </p>
      ) : (
        <>
          <h1>Din förfrågan</h1>
          <StatusDetails view={view.data} />
        </>
      )}
    </div>
  );
}
