import { afterEach, describe, expect, it, vi } from "vitest";
import { NominatimGeocoder } from "./geocoder.js";

const address = { street: "Kungsgatan 5", postcode: "411 19", city: "Göteborg" };

function setup(responses: unknown[][]) {
  let clock = 1_000_000;
  const waits: number[] = [];
  const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) =>
    Response.json(responses.shift() ?? []),
  );
  vi.stubGlobal("fetch", fetchMock);
  const geocoder = new NominatimGeocoder({
    baseUrl: "https://nominatim.test",
    userAgent: "hamtning (+https://hamta.test)",
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  const urls = () => fetchMock.mock.calls.map(([url]) => url);
  return { geocoder, fetchMock, urls, waits, advance: (ms: number) => (clock += ms) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NominatimGeocoder", () => {
  it("searches the structured address in Sweden and identifies the app", async () => {
    const { geocoder, fetchMock, urls } = setup([[{ lat: "57.7065", lon: "11.9668" }]]);
    expect(await geocoder.locate(address)).toEqual({
      lat: 57.7065,
      lon: 11.9668,
      precision: "address",
    });
    const [url] = urls();
    expect(url?.pathname).toBe("/search");
    expect(Object.fromEntries(url?.searchParams ?? [])).toMatchObject({
      street: "Kungsgatan 5",
      postalcode: "41119",
      city: "Göteborg",
      countrycodes: "se",
      format: "jsonv2",
      limit: "1",
    });
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({
      "user-agent": "hamtning (+https://hamta.test)",
    });
  });

  it("falls back to the postcode area when the street isn't found", async () => {
    const { geocoder, urls } = setup([[], [{ lat: "57.7", lon: "11.9" }]]);
    expect(await geocoder.locate(address)).toEqual({ lat: 57.7, lon: 11.9, precision: "area" });
    expect(urls()[1]?.searchParams.has("street")).toBe(false);
  });

  it("returns null when nothing matches", async () => {
    const { geocoder } = setup([[], []]);
    expect(await geocoder.locate(address)).toBeNull();
  });

  it("caches results, including misses, for a day", async () => {
    const hit = { lat: "1", lon: "2" };
    const { geocoder, fetchMock, advance } = setup([[hit], [hit]]);
    await geocoder.locate(address);
    await geocoder.locate({ ...address, city: " göteborg " });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(25 * 60 * 60 * 1000);
    await geocoder.locate(address);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps calls at least a second apart", async () => {
    const { geocoder, waits } = setup([[{ lat: "1", lon: "2" }], [{ lat: "3", lon: "4" }]]);
    await Promise.all([
      geocoder.locate(address),
      geocoder.locate({ ...address, street: "Annan gata 1" }),
    ]);
    expect(waits).toEqual([1100]);
  });

  it("throws when Nominatim fails, without caching the failure", async () => {
    const { geocoder, fetchMock } = setup([]);
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }));
    await expect(geocoder.locate(address)).rejects.toThrow("503");
    fetchMock.mockResolvedValueOnce(Response.json([{ lat: "1", lon: "2" }]));
    expect(await geocoder.locate(address)).toMatchObject({ lat: 1, lon: 2 });
  });
});
