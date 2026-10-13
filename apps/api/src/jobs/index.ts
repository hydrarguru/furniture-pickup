import type { Db } from "../db/client.js";
import type { AppEventBus } from "../events.js";
import { sweepOrphanedPhotos } from "../retention/orphans.js";
import { purgeExpired } from "../retention/purge.js";
import type { Storage } from "../storage/index.js";
import { cleanupExpiredUploads } from "../storage/uploads.js";

const HOUR_MS = 60 * 60 * 1000;

/** Starts recurring maintenance jobs. Returns a function that stops them. */
export function startJobs(deps: { db: Db; storage: Storage; events: AppEventBus }) {
  const run = async (name: string, job: () => Promise<unknown>) => {
    try {
      const result = await job();
      console.log(`[job] ${name}`, result);
    } catch (err) {
      // Never let a failed job take the API down; the next tick retries.
      console.error(`[job] ${name} failed`, err);
    }
  };

  // Hourly rather than daily: data is gone within an hour of its retention date.
  const tick = async () => {
    await run("cleanup-uploads", () => cleanupExpiredUploads(deps));
    await run("purge-retention", async () => {
      const result = await purgeExpired(deps);
      const count = result.closed + result.unverified + result.inactive;
      // Lets open admin pages refresh their counts.
      if (count > 0) deps.events.emit("requests.purged", { count });
      return result;
    });
    await run("sweep-orphaned-photos", async () => {
      const { scanned, deleted } = await sweepOrphanedPhotos(deps);
      return { scanned, deleted }; // keys are not logged
    });
  };
  void tick();
  const timer = setInterval(tick, HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
