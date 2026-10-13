import { RETENTION_DAYS_CLOSED, RETENTION_DAYS_UNVERIFIED } from "@hamtning/shared";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { images, requests } from "../db/schema.js";
import type { Storage } from "../storage/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Deleted per round, so a large backlog doesn't hold one huge transaction or S3 call. */
const BATCH = 100;

/**
 * Permanently deletes requests and everything belonging to them. Photos go first: if storage
 * fails, the rows stay and the next attempt retries, so a photo is never orphaned without a
 * request that points to it. Items, photos rows, time windows and history cascade in SQLite.
 */
export async function deleteRequests(
  deps: { db: Db; storage: Storage },
  ids: string[],
): Promise<{ requests: number; images: number }> {
  if (ids.length === 0) return { requests: 0, images: 0 };
  const keys = deps.db
    .select({ key: images.s3Key })
    .from(images)
    .where(inArray(images.requestId, ids))
    .all()
    .map((r) => r.key);
  if (keys.length > 0) await deps.storage.delete(keys);
  const res = deps.db.delete(requests).where(inArray(requests.id, ids)).run();
  return { requests: res.changes, images: keys.length };
}

/** Deletes every request past its retention period. Safe to run as often as you like. */
export async function purgeExpired(deps: { db: Db; storage: Storage }, now = new Date()) {
  const closedBefore = new Date(now.getTime() - RETENTION_DAYS_CLOSED * DAY_MS).toISOString();
  const unverifiedBefore = new Date(
    now.getTime() - RETENTION_DAYS_UNVERIFIED * DAY_MS,
  ).toISOString();

  const rounds = [
    // closed_at is only set for accepted (end of pickup), declined and cancelled requests.
    {
      name: "closed",
      where: and(isNotNull(requests.closedAt), lte(requests.closedAt, closedBefore)),
    },
    {
      name: "unverified",
      where: and(eq(requests.status, "unverified"), lte(requests.createdAt, unverifiedBefore)),
    },
  ] as const;

  const result = { closed: 0, unverified: 0, images: 0 };
  for (const round of rounds) {
    for (;;) {
      const ids = deps.db
        .select({ id: requests.id })
        .from(requests)
        .where(round.where)
        .limit(BATCH)
        .all()
        .map((r) => r.id);
      if (ids.length === 0) break;
      const deleted = await deleteRequests(deps, ids);
      result[round.name] += deleted.requests;
      result.images += deleted.images;
    }
  }
  return result;
}
