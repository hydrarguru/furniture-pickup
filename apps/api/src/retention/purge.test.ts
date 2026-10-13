import { scheduledDeletion } from "@hamtning/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { images, items, requestEvents, requests, timeWindows } from "../db/schema.js";
import { createTestApp, seedRequest, type TestApp } from "../test/helpers.js";
import { purgeExpired } from "./purge.js";

let t: TestApp;
beforeEach(() => {
  t = createTestApp();
});

const NOW = new Date("2026-12-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 864e5).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 864e5).toISOString();
const exists = (id: string) =>
  Boolean(t.db.select().from(requests).where(eq(requests.id, id)).get());
const keysOf = (id: string) =>
  t.db
    .select()
    .from(images)
    .where(eq(images.requestId, id))
    .all()
    .map((i) => i.s3Key);

describe("purgeExpired", () => {
  it("deletes closed requests 30 days after closing, with photos and all related rows", async () => {
    const old = seedRequest(t, { status: "declined", closedAt: daysAgo(30), photos: 2 });
    const recent = seedRequest(t, { status: "cancelled", closedAt: daysAgo(29) });
    const oldKeys = keysOf(old);
    t.db
      .insert(requestEvents)
      .values({ id: "ev1", requestId: old, type: "note", note: "x", createdAt: daysAgo(40) })
      .run();

    expect(await purgeExpired(t, NOW)).toEqual({
      closed: 1,
      unverified: 0,
      inactive: 0,
      images: 2,
    });
    expect(exists(old)).toBe(false);
    expect(exists(recent)).toBe(true);
    for (const key of oldKeys) expect(t.storage.objects.has(key)).toBe(false);
    for (const table of [items, images, timeWindows, requestEvents])
      expect(t.db.select().from(table).where(eq(table.requestId, old)).all()).toHaveLength(0);
  });

  it("counts accepted requests from the end of the pickup, not from acceptance", async () => {
    // Accepted long ago, but the pickup is still ahead: closed_at holds the pickup end.
    const upcoming = seedRequest(t, {
      status: "accepted",
      createdAt: daysAgo(55),
      closedAt: daysAhead(5),
    });
    const done = seedRequest(t, { status: "accepted", closedAt: daysAgo(31) });
    await purgeExpired(t, NOW);
    expect(exists(upcoming)).toBe(true);
    expect(exists(done)).toBe(false);
  });

  it("deletes unverified requests after 7 days", async () => {
    const stale = seedRequest(t, { status: "unverified", verifiedAt: null, createdAt: daysAgo(7) });
    const fresh = seedRequest(t, { status: "unverified", verifiedAt: null, createdAt: daysAgo(6) });
    expect(await purgeExpired(t, NOW)).toMatchObject({ unverified: 1 });
    expect(exists(stale)).toBe(false);
    expect(exists(fresh)).toBe(true);
  });

  it("deletes open requests after 7 days without staff activity", async () => {
    const stale = [
      seedRequest(t, { status: "new", updatedAt: daysAgo(7) }),
      seedRequest(t, { status: "in_progress", updatedAt: daysAgo(10) }),
    ];
    const active = seedRequest(t, { status: "new", createdAt: daysAgo(40), updatedAt: daysAgo(6) });
    expect(await purgeExpired(t, NOW)).toMatchObject({ inactive: 2 });
    for (const id of stale) expect(exists(id)).toBe(false);
    expect(exists(active)).toBe(true);
  });

  it("does not apply the inactivity rule to decided requests", async () => {
    const ids = [
      seedRequest(t, { status: "accepted", updatedAt: daysAgo(20), closedAt: daysAhead(3) }),
      seedRequest(t, { status: "declined", updatedAt: daysAgo(20), closedAt: daysAgo(20) }),
    ];
    expect(await purgeExpired(t, NOW)).toEqual({
      closed: 0,
      unverified: 0,
      inactive: 0,
      images: 0,
    });
    for (const id of ids) expect(exists(id)).toBe(true);
  });

  it("deletes exactly what scheduledDeletion says is due", async () => {
    const cases = [
      { status: "unverified", verifiedAt: null, createdAt: daysAgo(7), updatedAt: daysAgo(7) },
      { status: "unverified", verifiedAt: null, createdAt: daysAgo(6), updatedAt: daysAgo(6) },
      { status: "new", updatedAt: daysAgo(7) },
      { status: "in_progress", updatedAt: daysAgo(6) },
      { status: "accepted", closedAt: daysAgo(30) },
      { status: "accepted", closedAt: daysAhead(1) },
      { status: "declined", closedAt: daysAgo(29) },
      { status: "cancelled", closedAt: daysAgo(31) },
    ] as const;
    const ids = cases.map((c) => seedRequest(t, { ...c }));
    const due = t.db
      .select()
      .from(requests)
      .all()
      .filter((r) => {
        const at = scheduledDeletion(r);
        return at !== null && at <= NOW.toISOString();
      })
      .map((r) => r.id);

    await purgeExpired(t, NOW);
    const deleted = ids.filter((id) => !exists(id));
    expect(deleted.sort()).toEqual(due.sort());
    expect(deleted).toHaveLength(4);
  });

  it("works through a backlog larger than one batch", async () => {
    for (let i = 0; i < 230; i++)
      seedRequest(t, { status: "declined", closedAt: daysAgo(31), photos: 0 });
    expect(await purgeExpired(t, NOW)).toMatchObject({ closed: 230 });
    expect(t.db.select().from(requests).all()).toHaveLength(0);
  });

  it("keeps the rows when photo deletion fails, so the next run retries", async () => {
    const id = seedRequest(t, { status: "declined", closedAt: daysAgo(31) });
    const realDelete = t.storage.delete.bind(t.storage);
    t.storage.delete = async () => {
      throw new Error("garage down");
    };
    await expect(purgeExpired(t, NOW)).rejects.toThrow("garage down");
    expect(exists(id)).toBe(true);

    t.storage.delete = realDelete;
    expect(await purgeExpired(t, NOW)).toMatchObject({ closed: 1 });
    expect(exists(id)).toBe(false);
  });

  it("agrees with the deletion date shown to staff and requesters", async () => {
    // deleteAfter = closedAt + 30 days; the purge must not run before that moment.
    const closedAt = daysAgo(30);
    const id = seedRequest(t, { status: "declined", closedAt });
    await purgeExpired(t, new Date(NOW.getTime() - 1)); // one millisecond early
    expect(exists(id)).toBe(true);
    await purgeExpired(t, NOW);
    expect(exists(id)).toBe(false);
  });
});
