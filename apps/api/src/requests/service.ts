import {
  CANCELLABLE_STATUSES,
  type CreateRequest,
  type RequestStatus,
  type RequestStatusView,
  scheduledDeletion,
} from "@hamtning/shared";
import { and, asc, count, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  categories,
  images,
  items,
  pendingUploads,
  requestEvents,
  requests,
  timeWindows,
} from "../db/schema.js";
import type { AppEventBus } from "../events.js";
import { newId } from "../ids.js";
import type { Mailer } from "../mailer/index.js";
import { verificationMail } from "../mailer/templates.js";
import { hashToken, newToken } from "../security/tokens.js";
import type { Storage } from "../storage/index.js";
import { checkUploadedImages, type UploadCheck } from "../storage/uploads.js";

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: "rate_limited" | "invalid_category" }
  | { ok: false; error: "invalid_images"; reason: Extract<UploadCheck, { ok: false }>["reason"] };

export async function createRequest(
  deps: { db: Db; storage: Storage; mailer: Mailer; appOrigin: string },
  input: CreateRequest,
  now = new Date(),
): Promise<CreateResult> {
  const { db } = deps;
  const nowIso = now.toISOString();

  // Counted from the database, so the limit survives restarts. Unverified spam counts too.
  const recent = db
    .select({ n: count() })
    .from(requests)
    .where(
      and(
        eq(requests.email, input.email),
        gt(requests.createdAt, new Date(now.getTime() - HOUR_MS).toISOString()),
      ),
    )
    .get();
  if ((recent?.n ?? 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR)
    return { ok: false, error: "rate_limited" };

  const categoryIds = [
    ...new Set(input.items.map((i) => i.categoryId).filter((id) => id !== undefined)),
  ];
  if (categoryIds.length > 0) {
    const found = db
      .select({ n: count() })
      .from(categories)
      .where(inArray(categories.id, categoryIds))
      .get();
    if ((found?.n ?? 0) !== categoryIds.length) return { ok: false, error: "invalid_category" };
  }

  const uploads = await checkUploadedImages(deps, input.imageKeys, now);
  if (!uploads.ok) return { ok: false, error: "invalid_images", reason: uploads.reason };

  const id = newId(now.getTime());
  const token = newToken();

  db.transaction((tx) => {
    tx.insert(requests)
      .values({
        id,
        status: "unverified",
        name: input.name,
        email: input.email,
        phone: input.phone,
        street: input.street,
        postcode: input.postcode,
        city: input.city,
        floor: input.floor ?? null,
        hasElevator: input.hasElevator ?? null,
        accessNotes: input.accessNotes ?? null,
        message: input.message ?? null,
        consentAt: nowIso,
        tokenHash: hashToken(token),
        tokenExpires: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS).toISOString(),
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
    tx.insert(items)
      .values(
        input.items.map((item) => ({
          id: newId(),
          requestId: id,
          title: item.title,
          categoryId: item.categoryId ?? null,
          description: item.description ?? null,
          condition: item.condition ?? null,
          quantity: item.quantity,
        })),
      )
      .run();
    tx.insert(images)
      .values(
        uploads.files.map((file, position) => ({
          id: newId(),
          requestId: id,
          s3Key: file.key,
          contentType: file.contentType,
          sizeBytes: file.size,
          position,
        })),
      )
      .run();
    tx.insert(timeWindows)
      .values(
        input.timeWindows.map((w) => ({
          id: newId(),
          requestId: id,
          date: w.date,
          part: w.part,
          fromTime: w.fromTime ?? null,
          toTime: w.toTime ?? null,
          note: w.note ?? null,
        })),
      )
      .run();
    // The uploads now belong to a request; the orphan cleanup must not see them again.
    tx.delete(pendingUploads)
      .where(
        inArray(
          pendingUploads.s3Key,
          uploads.files.map((f) => f.key),
        ),
      )
      .run();
  });

  try {
    await deps.mailer.send(
      verificationMail({ to: input.email, name: input.name, appOrigin: deps.appOrigin, token }),
    );
  } catch (err) {
    // The request is stored; without the mail it stays unverified and is purged after 7 days.
    console.error(`[requests] verification mail failed for ${id}`, err);
  }

  return { ok: true, id };
}

const findByToken = (db: Db, token: string) =>
  db
    .select()
    .from(requests)
    .where(eq(requests.tokenHash, hashToken(token)))
    .get();

type VerifyResult =
  | { ok: true; status: RequestStatus; alreadyVerified: boolean }
  | { ok: false; error: "not_found" | "expired" };

export function verifyRequest(
  deps: { db: Db; events: AppEventBus },
  token: string,
  now = new Date(),
): VerifyResult {
  const request = findByToken(deps.db, token);
  if (!request) return { ok: false, error: "not_found" };
  // Clicking the link again later just leads to the status page.
  if (request.status !== "unverified")
    return { ok: true, status: request.status, alreadyVerified: true };
  if (request.tokenExpires <= now.toISOString()) return { ok: false, error: "expired" };

  const nowIso = now.toISOString();
  const changed = deps.db.transaction((tx) => {
    const res = tx
      .update(requests)
      .set({ status: "new", verifiedAt: nowIso, updatedAt: nowIso })
      .where(and(eq(requests.id, request.id), eq(requests.status, "unverified")))
      .run();
    if (res.changes === 0) return false; // verified concurrently
    tx.insert(requestEvents)
      .values({
        id: newId(),
        requestId: request.id,
        type: "status_change",
        fromStatus: "unverified",
        toStatus: "new",
        note: "Bekräftad via e-post",
        createdAt: nowIso,
      })
      .run();
    return true;
  });
  if (changed) deps.events.emit("request.verified", { id: request.id });
  return { ok: true, status: "new", alreadyVerified: !changed };
}

const isCancellable = (s: RequestStatus) => (CANCELLABLE_STATUSES as readonly string[]).includes(s);

function buildView(db: Db, request: typeof requests.$inferSelect): RequestStatusView {
  const itemRows = db
    .select({ title: items.title, quantity: items.quantity })
    .from(items)
    .where(eq(items.requestId, request.id))
    .all();
  const windowRows = db
    .select({
      date: timeWindows.date,
      part: timeWindows.part,
      fromTime: timeWindows.fromTime,
      toTime: timeWindows.toTime,
    })
    .from(timeWindows)
    .where(eq(timeWindows.requestId, request.id))
    .orderBy(asc(timeWindows.date))
    .all();
  const imageCount =
    db.select({ n: count() }).from(images).where(eq(images.requestId, request.id)).get()?.n ?? 0;

  return {
    status: request.status,
    createdAt: request.createdAt,
    items: itemRows,
    timeWindows: windowRows,
    imageCount,
    confirmedStart: request.confirmedStart,
    confirmedEnd: request.confirmedEnd,
    staffMessage: request.staffMessage,
    deleteAfter: scheduledDeletion(request),
    canCancel: isCancellable(request.status),
  };
}

export function getStatusView(db: Db, token: string): RequestStatusView | null {
  const request = findByToken(db, token);
  return request ? buildView(db, request) : null;
}

type CancelResult =
  | { ok: true; view: RequestStatusView }
  | { ok: false; error: "not_found" | "not_cancellable" };

export function cancelRequest(db: Db, token: string, now = new Date()): CancelResult {
  const request = findByToken(db, token);
  if (!request) return { ok: false, error: "not_found" };
  if (!isCancellable(request.status)) return { ok: false, error: "not_cancellable" };

  const nowIso = now.toISOString();
  db.transaction((tx) => {
    tx.update(requests)
      .set({ status: "cancelled", closedAt: nowIso, updatedAt: nowIso })
      .where(eq(requests.id, request.id))
      .run();
    tx.insert(requestEvents)
      .values({
        id: newId(),
        requestId: request.id,
        type: "status_change",
        fromStatus: request.status,
        toStatus: "cancelled",
        note: "Avbokad av kunden",
        createdAt: nowIso,
      })
      .run();
  });
  const updated = findByToken(db, token);
  return { ok: true, view: buildView(db, updated as typeof requests.$inferSelect) };
}
