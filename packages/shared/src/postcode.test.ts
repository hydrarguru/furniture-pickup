import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone.js";
import { formatPostcode, normalizePostcode } from "./postcode.js";
import { createRequestSchema } from "./schemas.js";

describe("postcode", () => {
  it("normalizes with and without space", () => {
    expect(normalizePostcode("412 50")).toBe("41250");
    expect(normalizePostcode("41250")).toBe("41250");
    expect(formatPostcode("41250")).toBe("412 50");
  });
  it("rejects invalid input", () => {
    expect(normalizePostcode("4125")).toBeNull();
    expect(normalizePostcode("abcde")).toBeNull();
  });
});

describe("phone", () => {
  it("normalizes Swedish numbers to E.164", () => {
    expect(normalizePhone("070-123 45 67")).toBe("+46701234567");
    expect(normalizePhone("+46 70 123 45 67")).toBe("+46701234567");
    expect(normalizePhone("0046701234567")).toBe("+46701234567");
  });
  it("rejects garbage", () => {
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("createRequestSchema", () => {
  const valid = {
    name: "Anna Andersson",
    email: "Anna@Example.se",
    phone: "070-123 45 67",
    street: "Storgatan 1",
    postcode: "412 50",
    city: "Göteborg",
    items: [{ title: "Soffa" }],
    imageKeys: ["uploads/abc.jpg"],
    timeWindows: [{ date: "2026-11-01", part: "forenoon" as const }],
    consent: true as const,
    turnstileToken: "t",
  };
  it("accepts and normalizes a valid request", () => {
    const r = createRequestSchema.parse(valid);
    expect(r.email).toBe("anna@example.se");
    expect(r.phone).toBe("+46701234567");
    expect(r.postcode).toBe("41250");
    expect(r.items[0]?.quantity).toBe(1);
  });
  it("requires at least one photo", () => {
    expect(createRequestSchema.safeParse({ ...valid, imageKeys: [] }).success).toBe(false);
  });
  it("allows at most three time windows", () => {
    const w = { date: "2026-11-01", part: "forenoon" as const };
    expect(createRequestSchema.safeParse({ ...valid, timeWindows: [w, w, w, w] }).success).toBe(
      false,
    );
  });
});
