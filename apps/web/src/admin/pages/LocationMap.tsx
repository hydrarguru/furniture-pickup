import type { GeoLocation } from "@hamtning/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useRef } from "react";

// Leaflet guesses its icon URLs from the CSS path, which breaks once Vite bundles it.
const icon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

/** Area matches are the middle of a postcode area; show roughly how far off they can be. */
const AREA_RADIUS_M = 600;

/** Loaded lazily: Leaflet is only needed once someone opens the map. */
export default function LocationMap({ location }: { location: GeoLocation }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const point: L.LatLngTuple = [location.lat, location.lon];
    const map = L.map(el).setView(point, location.precision === "address" ? 17 : 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // The site sends no Referer, but OSM's tile policy requires one. The origin alone is enough.
      referrerPolicy: "strict-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    if (location.precision === "address") L.marker(point, { icon }).addTo(map);
    else L.circle(point, { radius: AREA_RADIUS_M }).addTo(map);
    // The map can mount before the dialog has its final size; redraw whenever it changes.
    const resized = new ResizeObserver(() => map.invalidateSize());
    resized.observe(el);
    return () => {
      resized.disconnect();
      map.remove();
    };
  }, [location]);

  return <div ref={container} className="map-canvas" />;
}
