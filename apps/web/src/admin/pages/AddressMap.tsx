import { type AdminRequestDetail, formatPostcode } from "@hamtning/shared";
import { lazy, Suspense, useRef, useState } from "react";
import { CloseButton, isBackdropClick, useModal } from "../dialog.js";
import { useRequestLocation } from "../queries.js";

const LocationMap = lazy(() => import("./LocationMap.js"));

/** The pickup address; clicking it shows where it is on a map. */
export function AddressMap({ r }: { r: AdminRequestDetail }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog, open);
  const location = useRequestLocation(r.id, open);
  const oneLine = `${r.street}, ${formatPostcode(r.postcode)} ${r.city}`;
  const loc = location.data;

  return (
    <>
      <p>
        <button type="button" className="link address-link" onClick={() => setOpen(true)}>
          {r.street}
          <br />
          {formatPostcode(r.postcode)} {r.city}
          <span className="small"> · Visa på karta</span>
        </button>
      </p>
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
            {location.isPending && <p className="map-status muted">Söker adressen…</p>}
            {location.isError && (
              <p className="map-status banner" role="alert">
                Kartan kunde inte laddas just nu. Försök igen om en stund.
              </p>
            )}
            {location.isSuccess && !loc && (
              <p className="map-status">Adressen hittades inte på kartan.</p>
            )}
            {loc && (
              <>
                {loc.precision === "area" && (
                  <p className="muted small">
                    Gatan hittades inte. Ringen visar ungefär var postnumret ligger.
                  </p>
                )}
                <Suspense fallback={<div className="map-canvas" />}>
                  <LocationMap location={loc} />
                </Suspense>
              </>
            )}
            <p className="map-links small">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLine)}`}
                target="_blank"
                rel="noreferrer"
              >
                Vägbeskrivning (Google Maps)
              </a>
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
