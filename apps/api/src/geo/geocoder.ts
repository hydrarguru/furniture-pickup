import type { GeoLocation } from "@hamtning/shared";

export interface Address {
  street: string;
  postcode: string;
  city: string;
}

export interface Geocoder {
  /** `null` when the address can't be found. Throws when the geocoding service is unreachable. */
  locate(address: Address): Promise<GeoLocation | null>;
}

export const NOMINATIM_DEFAULT_URL = "https://nominatim.openstreetmap.org";

/** Nominatim's usage policy allows at most one request per second. */
const MIN_INTERVAL_MS = 1100;
/** Addresses don't move, but the cache holds personal data, so it is kept small and short-lived. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

type Search = Record<string, string>;

/**
 * Geocodes through Nominatim (OpenStreetMap). Runs on the server so employees' browsers never
 * talk to it, requests are spaced out for the whole app, and results are cached.
 */
export class NominatimGeocoder implements Geocoder {
  private readonly cache = new Map<string, { at: number; result: GeoLocation | null }>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  constructor(
    private readonly opts: {
      baseUrl: string;
      /** Identifies the app, as the usage policy requires. */
      userAgent: string;
      now?: () => number;
      wait?: (ms: number) => Promise<void>;
    },
  ) {}

  async locate(address: Address): Promise<GeoLocation | null> {
    const key = [address.street, address.postcode, address.city]
      .map((s) => s.trim().toLowerCase())
      .join("|");
    const now = this.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.result;

    const postcode = address.postcode.replace(/\s/g, "");
    const exact = await this.search({
      street: address.street,
      postalcode: postcode,
      city: address.city,
    });
    // A misspelled street still finds the area, which is enough to plan a route.
    const result: GeoLocation | null = exact
      ? { ...exact, precision: "address" }
      : await this.search({ postalcode: postcode, city: address.city }).then((p) =>
          p ? { ...p, precision: "area" } : null,
        );

    this.cache.delete(key);
    this.cache.set(key, { at: now, result });
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return result;
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** Runs searches one at a time, at least MIN_INTERVAL_MS apart. */
  private search(params: Search) {
    const run = this.queue.then(async () => {
      const wait = this.lastCall + MIN_INTERVAL_MS - this.now();
      if (wait > 0) await (this.opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
      this.lastCall = this.now();
      return this.fetchFirst(params);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async fetchFirst(params: Search) {
    const url = new URL("/search", this.opts.baseUrl);
    for (const [k, v] of Object.entries({
      ...params,
      country: "Sweden",
      countrycodes: "se",
      format: "jsonv2",
      limit: "1",
    }))
      url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { "user-agent": this.opts.userAgent, "accept-language": "sv" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const [first] = (await res.json()) as { lat: string; lon: string }[];
    if (!first) return null;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }
}
