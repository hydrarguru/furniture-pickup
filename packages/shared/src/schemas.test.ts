import { describe, expect, it } from "vitest";
import { statusChangeSchema } from "./admin.js";
import {
  addDays,
  pickupDateRange,
  stockholmToday,
  stockholmToUtcIso,
} from "./dates.js";
import { normalizePhone } from "./phone.js";
import { formatPostcode, normalizePostcode } from "./postcode.js";
import { createRequestSchema } from "./schemas.js";
import { scheduledDeletion } from "./statuses.js";

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

describe("dates", () => {
  it("uses the Swedish calendar day, not UTC", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Stockholm (UTC+1 in winter).
    expect(stockholmToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("allows pickups 2 to 60 days ahead", () => {
    expect(pickupDateRange(new Date("2026-10-12T10:00:00Z"))).toEqual({
      min: "2026-10-14",
      max: "2026-12-11",
    });
  });
});

const inDays = (n: number) => addDays(stockholmToday(), n);

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
    timeWindows: [{ date: inDays(7), part: "forenoon" as const }],
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
    expect(
      createRequestSchema.safeParse({ ...valid, imageKeys: [] }).success,
    ).toBe(false);
  });
  it("allows at most three time windows", () => {
    const w = { date: inDays(7), part: "forenoon" as const };
    expect(
      createRequestSchema.safeParse({ ...valid, timeWindows: [w, w, w, w] })
        .success,
    ).toBe(false);
  });
  it.each([
    ["tomorrow", 1],
    ["61 days ahead", 61],
  ])("rejects a pickup date %s", (_name, days) => {
    const r = createRequestSchema.safeParse({
      ...valid,
      timeWindows: [{ date: inDays(days), part: "forenoon" }],
    });
    expect(r.success).toBe(false);
  });
  it("accepts the edges of the date range", () => {
    for (const d of [2, 60]) {
      const r = createRequestSchema.safeParse({
        ...valid,
        timeWindows: [{ date: inDays(d), part: "forenoon" }],
      });
      expect(r.success).toBe(true);
    }
  });
  it("requires valid from/to times for custom windows only", () => {
    const custom = (fromTime: string, toTime: string) =>
      createRequestSchema.safeParse({
        ...valid,
        timeWindows: [{ date: inDays(7), part: "custom", fromTime, toTime }],
      }).success;
    expect(custom("09:00", "11:00")).toBe(true);
    expect(custom("11:00", "09:00")).toBe(false);
    expect(custom("", "")).toBe(false);
    expect(custom("25:00", "26:00")).toBe(false);
    // Non-custom windows ignore leftover (even empty) time fields and drop them.
    const r = createRequestSchema.parse({
      ...valid,
      timeWindows: [
        { date: inDays(7), part: "evening", fromTime: "", toTime: "10:00" },
      ],
    });
    expect(r.timeWindows[0]).not.toHaveProperty("fromTime", "10:00");
    expect(r.timeWindows[0]?.toTime).toBeUndefined();
  });
  it("treats empty optional text fields as not given", () => {
    const r = createRequestSchema.parse({
      ...valid,
      message: "",
      accessNotes: "  ",
      items: [{ title: "Soffa", description: "" }],
    });
    expect(r.message).toBeUndefined();
    expect(r.accessNotes).toBeUndefined();
    expect(r.items[0]?.description).toBeUndefined();
  });
});

describe("stockholmToUtcIso", () => {
  it("handles summer and winter time", () => {
    expect(stockholmToUtcIso("2026-07-01", "09:00")).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(stockholmToUtcIso("2026-12-01", "09:00")).toBe(
      "2026-12-01T08:00:00.000Z",
    );
  });
  it("handles the days DST starts and ends", () => {
    // 2026: summer time starts 29 March, ends 25 October.
    expect(stockholmToUtcIso("2026-03-29", "12:00")).toBe(
      "2026-03-29T10:00:00.000Z",
    );
    expect(stockholmToUtcIso("2026-10-25", "12:00")).toBe(
      "2026-10-25T11:00:00.000Z",
    );
  });
});

describe("statusChangeSchema", () => {
  it("requires a pickup time when accepting", () => {
    expect(statusChangeSchema.safeParse({ status: "accepted" }).success).toBe(
      false,
    );
    expect(
      statusChangeSchema.safeParse({
        status: "accepted",
        confirmed: { date: "2026-10-20", fromTime: "09:00", toTime: "11:00" },
      }).success,
    ).toBe(true);
  });
  it("rejects backwards times and statuses staff may not set", () => {
    expect(
      statusChangeSchema.safeParse({
        status: "accepted",
        confirmed: { date: "2026-10-20", fromTime: "11:00", toTime: "09:00" },
      }).success,
    ).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "cancelled" }).success).toBe(
      false,
    );
    expect(statusChangeSchema.safeParse({ status: "unverified" }).success).toBe(
      false,
    );
  });
});

describe("scheduledDeletion", () => {
  const base = {
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-05T10:00:00.000Z",
    closedAt: null,
  };
  it("gives each kind of request its own clock", () => {
    expect(scheduledDeletion({ ...base, status: "unverified" })).toBe(
      "2026-10-08T10:00:00.000Z",
    );
    expect(scheduledDeletion({ ...base, status: "new" })).toBe(
      "2026-10-12T10:00:00.000Z",
    );
    expect(scheduledDeletion({ ...base, status: "in_progress" })).toBe(
      "2026-10-12T10:00:00.000Z",
    );
    const closedAt = "2026-10-20T15:00:00.000Z";
    for (const status of ["accepted", "declined", "cancelled"] as const)
      expect(scheduledDeletion({ ...base, status, closedAt })).toBe(
        "2026-11-19T15:00:00.000Z",
      );
  });
});
