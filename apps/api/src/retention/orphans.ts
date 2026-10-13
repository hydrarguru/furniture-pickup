import type { Db } from "../db/client.js";
import { images, pendingUploads } from "../db/schema.js";
import type { Storage } from "../storage/index.js";

/** Only uploads live here; anything else in the bucket is never touched. */
export const UPLOAD_PREFIX = "uploads/";
/**
 * Objects younger than this are left alone. Every legitimate upload has a pending_uploads or
 * images row from before the browser starts uploading, so this is a safety margin, not a rule.
 */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface OrphanSweep {
  scanned: number;
  orphans: string[];
  deleted: number;
}

/**
 * Finds photos in storage that no request or pending upload refers to (left behind by a
 * database restore, a crash mid-delete, or test runs against a throwaway database) and,
 * unless `dryRun`, deletes them.
 */
export async function sweepOrphanedPhotos(
  deps: { db: Db; storage: Storage },
  opts: { now?: Date; minAgeMs?: number; dryRun?: boolean } = {},
): Promise<OrphanSweep> {
  const cutoff = (opts.now ?? new Date()).getTime() - (opts.minAgeMs ?? ORPHAN_MIN_AGE_MS);
  // Load references first: anything created after this point is newer than the cutoff anyway.
  const referenced = new Set([
    ...deps.db
      .select({ key: images.s3Key })
      .from(images)
      .all()
      .map((r) => r.key),
    ...deps.db
      .select({ key: pendingUploads.s3Key })
      .from(pendingUploads)
      .all()
      .map((r) => r.key),
  ]);

  let scanned = 0;
  const orphans: string[] = [];
  for await (const object of deps.storage.list(UPLOAD_PREFIX)) {
    scanned++;
    if (!referenced.has(object.key) && object.lastModified.getTime() <= cutoff)
      orphans.push(object.key);
  }
  if (!opts.dryRun && orphans.length > 0) await deps.storage.delete(orphans);
  return { scanned, orphans, deleted: opts.dryRun ? 0 : orphans.length };
}
