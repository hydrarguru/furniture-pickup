import { beforeEach, describe, expect, it } from "vitest";
import { createUploadSlots } from "../storage/uploads.js";
import { createTestApp, seedRequest, type TestApp } from "../test/helpers.js";
import { sweepOrphanedPhotos } from "./orphans.js";

let t: TestApp;
beforeEach(() => {
  t = createTestApp();
});

const NOW = new Date("2026-12-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe("sweepOrphanedPhotos", () => {
  it("deletes unreferenced uploads older than 24 hours and nothing else", async () => {
    const id = seedRequest(t, { photos: 1 });
    const attached = [...t.storage.objects.keys()][0] as string;
    t.storage.put(attached, 100, "image/jpeg", hoursAgo(500));
    const [slot] = await createUploadSlots(t, [{ contentType: "image/jpeg", size: 1 }]);
    const pending = slot?.key as string;
    t.storage.put(pending, 1, "image/jpeg", hoursAgo(30)); // issued, upload done, not yet submitted

    t.storage.put("uploads/orphan-old.jpg", 1, "image/jpeg", hoursAgo(25));
    t.storage.put("uploads/orphan-young.jpg", 1, "image/jpeg", hoursAgo(23));
    t.storage.put("backups/app.db", 1, "application/octet-stream", hoursAgo(1000)); // outside uploads/

    const result = await sweepOrphanedPhotos(t, { now: NOW });
    expect(result).toEqual({ scanned: 4, orphans: ["uploads/orphan-old.jpg"], deleted: 1 });
    expect([...t.storage.objects.keys()].sort()).toEqual(
      [attached, pending, "uploads/orphan-young.jpg", "backups/app.db"].sort(),
    );
    expect(id).toBeTruthy();
  });

  it("only reports in a dry run", async () => {
    t.storage.put("uploads/orphan.jpg", 1, "image/jpeg", hoursAgo(48));
    const result = await sweepOrphanedPhotos(t, { now: NOW, dryRun: true });
    expect(result).toEqual({ scanned: 1, orphans: ["uploads/orphan.jpg"], deleted: 0 });
    expect(t.storage.objects.has("uploads/orphan.jpg")).toBe(true);
  });

  it("can be told to ignore age, e.g. to clean up after test runs", async () => {
    t.storage.put("uploads/just-now.jpg", 1, "image/jpeg", NOW);
    expect(await sweepOrphanedPhotos(t, { now: NOW, minAgeMs: 0 })).toMatchObject({ deleted: 1 });
  });

  it("does nothing on an empty bucket", async () => {
    expect(await sweepOrphanedPhotos(t, { now: NOW })).toEqual({
      scanned: 0,
      orphans: [],
      deleted: 0,
    });
  });
});
