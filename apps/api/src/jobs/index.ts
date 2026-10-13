import type { Db } from "../db/client.js";
import { purgeExpired } from "../retention/purge.js";
import type { Storage } from "../storage/index.js";
import { cleanupExpiredUploads } from "../storage/uploads.js";

const HOUR_MS = 60 * 60 * 1000;

/** Starts recurring maintenance jobs. Returns a function that stops them. */
export function startJobs(deps: { db: Db; storage: Storage }) {
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
    await run("purge-retention", () => purgeExpired(deps));
  };
  void tick();
  const timer = setInterval(tick, HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
