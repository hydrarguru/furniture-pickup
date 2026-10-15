import { type AdminRequestDetail, formatPostcode } from "@hamtning/shared";
import { ZoomIn } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { CloseButton, isBackdropClick, useModal } from "../dialog.js";
import { useRequestLocation } from "../queries.js";

const LocationMap = lazy(() => import("./LocationMap.js"));

type LocationQuery = ReturnType<typeof useRequestLocation>;

/** The pickup address with a small map of it; enlarging opens a bigger map with directions. */
export function AddressMap({ r }: { r: AdminRequestDetail }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog, open);
  const location = useRequestLocation(r.id);
  const oneLine = `${r.street}, ${formatPostcode(r.postcode)} ${r.city}`;
  const loc = location.data;
  const directions = (
    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLine)}`}
      target="_blank"
      rel="noreferrer"
    >
      Vägbeskrivning (Google Maps)
    </a>
  );

  return (
    <>
      <p>
        {r.street}
        <br />
        {formatPostcode(r.postcode)} {r.city}
      </p>
      <div className="map-preview">
        <LocationView location={location} compact />
        {loc && (
          <button
            type="button"
            className="secondary map-enlarge"
            onClick={() => setOpen(true)}
            aria-label="Förstora karta"
            title="Förstora karta"
          >
            <ZoomIn size={20} aria-hidden="true" />
          </button>
        )}
        {/* Without a map there is nothing to enlarge, but directions still work. */}
        {(location.isError || (location.isSuccess && !loc)) && (
          <p className="map-links small">{directions}</p>
        )}
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes a modal <dialog> natively. */}
      <dialog
        ref={dialog}
        className="lightbox map-dialog"
        aria-label="Karta"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (isBackdropClick(e)) setOpen(false);
        }}
      >
        {open && (
          <>
            <div className="lightbox-bar">
              <strong className="map-title">{oneLine}</strong>
              <CloseButton onClick={() => setOpen(false)} />
            </div>
            <LocationView location={location} />
            <p className="map-links small">
              {directions}
              {loc && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=17/${loc.lat}/${loc.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Öppna i OpenStreetMap
                </a>
              )}
            </p>
          </>
        )}
      </dialog>
    </>
  );
}

/** The map, or why there is none. Used both in the panel and in the dialog. */
function LocationView({
  location,
  compact = false,
}: {
  location: LocationQuery;
  compact?: boolean;
}) {
  const loc = location.data;
  const canvas = compact ? "map-canvas map-canvas-compact" : "map-canvas";
  if (location.isPending) return <p className="map-status muted">Söker adressen…</p>;
  if (location.isError)
    return (
      <p className="map-status banner" role="alert">
        Kartan kunde inte laddas just nu. Försök igen om en stund.
      </p>
    );
  if (!loc) return <p className="map-status muted">Adressen hittades inte på kartan.</p>;
  return (
    <>
      <Suspense fallback={<div className={canvas} />}>
        <LocationMap location={loc} compact={compact} />
      </Suspense>
      {loc.precision === "area" && (
        <p className="muted small">
          Gatan hittades inte. Ringen visar ungefär var postnumret ligger.
        </p>
      )}
    </>
  );
}
