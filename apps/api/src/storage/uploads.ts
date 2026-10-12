import { createHmac } from "node:crypto";
import { MAX_IMAGE_BYTES } from "@hamtning/shared";
import { inArray, lt } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "../db/client.js";
import { images, pendingUploads } from "../db/schema.js";
import type { Storage } from "./index.js";

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** How long an uploaded-but-unsubmitted file may live before the cleanup job removes it. */
export const PENDING_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ALLOWED_TYPES = new Set(Object.keys(EXTENSIONS));
const KEY_RE = /^uploads\/[0-9A-HJKMNP-TV-Z]{26}\.(jpg|png|webp)$/;

export const hashIp = (ip: string, secret: string) =>
  createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32);

export interface PresignedUpload {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

export async function createUploadSlots(
  deps: { db: Db; storage: Storage },
  files: { contentType: string; size: number }[],
  ipHash: string | null,
  now = new Date(),
): Promise<PresignedUpload[]> {
  const expiresAt = new Date(now.getTime() + PENDING_UPLOAD_TTL_MS).toISOString();
  const slots = files.map((f) => ({
    key: `uploads/${ulid(now.getTime())}.${EXTENSIONS[f.contentType]}`,
    contentType: f.contentType,
    size: f.size,
  }));
  const urls = await Promise.all(
    slots.map((s) => deps.storage.presignUpload(s, UPLOAD_URL_TTL_SECONDS)),
  );
  deps.db
    .insert(pendingUploads)
    .values(slots.map((s) => ({ s3Key: s.key, expiresAt, ipHash })))
    .run();
  return slots.map((s, i) => ({ ...s, url: urls[i] as string }));
}

export type UploadCheck =
  | { ok: true; files: { key: string; contentType: string; size: number }[] }
  | { ok: false; key: string; reason: "unknown_key" | "missing" | "bad_type" | "too_large" };

/**
 * Called when a request is submitted: every key must have been issued by us (and not expired),
 * actually exist in storage, and be a permitted type/size according to storage itself.
 */
export async function checkUploadedImages(
  deps: { db: Db; storage: Storage },
  keys: string[],
  now = new Date(),
): Promise<UploadCheck> {
  const unique = [...new Set(keys)];
  const issued = deps.db
    .select({ key: pendingUploads.s3Key, expiresAt: pendingUploads.expiresAt })
    .from(pendingUploads)
    .where(inArray(pendingUploads.s3Key, unique))
    .all();
  const valid = new Set(issued.filter((r) => r.expiresAt > now.toISOString()).map((r) => r.key));

  const files: { key: string; contentType: string; size: number }[] = [];
  for (const key of unique) {
    if (!KEY_RE.test(key) || !valid.has(key)) return { ok: false, key, reason: "unknown_key" };
    const obj = await deps.storage.head(key);
    if (!obj) return { ok: false, key, reason: "missing" };
    if (!obj.contentType || !ALLOWED_TYPES.has(obj.contentType))
      return { ok: false, key, reason: "bad_type" };
    if (obj.size <= 0 || obj.size > MAX_IMAGE_BYTES) return { ok: false, key, reason: "too_large" };
    files.push({ key, contentType: obj.contentType, size: obj.size });
  }
  return { ok: true, files };
}

/**
 * Deletes uploads that were never attached to a submitted request.
 * Keys already referenced by `images` are only unregistered, never deleted from storage.
 */
export async function cleanupExpiredUploads(
  deps: { db: Db; storage: Storage },
  now = new Date(),
): Promise<{ removed: number }> {
  const expired = deps.db
    .select({ key: pendingUploads.s3Key })
    .from(pendingUploads)
    .where(lt(pendingUploads.expiresAt, now.toISOString()))
    .all()
    .map((r) => r.key);
  if (expired.length === 0) return { removed: 0 };

  const attached = new Set(
    deps.db
      .select({ key: images.s3Key })
      .from(images)
      .where(inArray(images.s3Key, expired))
      .all()
      .map((r) => r.key),
  );
  const orphans = expired.filter((k) => !attached.has(k));

  // Storage first: if it fails, the rows stay and the next run retries.
  if (orphans.length > 0) await deps.storage.delete(orphans);
  deps.db.delete(pendingUploads).where(inArray(pendingUploads.s3Key, expired)).run();
  return { removed: orphans.length };
}
