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
  cancellations,
  categories,
  images,
  items,
  pendingUploads,
  requestEvents,
  requestLinks,
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
  | { ok: true; id: string; statusToken: string }
  | { ok: false; error: "rate_limited" | "invalid_category" }
  | { ok: false; error: "invalid_images"; reason: Extract<UploadCheck, { ok: false }>["reason"] };

export async function createRequest(
  deps: {
    db: Db;
    storage: Storage;
    mailer: Mailer;
    events: AppEventBus;
    appOrigin: string;
    /** Off only in load tests. */
    emailLimit?: boolean;
  },
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
  if (deps.emailLimit !== false && (recent?.n ?? 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR)
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
  // Shown to the requester right after submitting. It is separate from the emailed token so that
  // it cannot be used to verify the email address.
  const statusToken = newToken();

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
    tx.insert(requestLinks)
      .values({ tokenHash: hashToken(statusToken), requestId: id, createdAt: nowIso })
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
  deps.events.emit("request.submitted", { id });

  try {
    await deps.mailer.send(
      verificationMail({ to: input.email, name: input.name, appOrigin: deps.appOrigin, token }),
    );
  } catch (err) {
    // The request is stored; without the mail it stays unverified and is purged after 7 days.
    console.error(`[requests] verification mail failed for ${id}`, err);
  }

  return { ok: true, id, statusToken };
}

/** The token from the verification email, or one from a later status email. */
function findByToken(db: Db, token: string) {
  const hash = hashToken(token);
  const own = db.select().from(requests).where(eq(requests.tokenHash, hash)).get();
  if (own) return own;
  return db
    .select({ request: requests })
    .from(requestLinks)
    .innerJoin(requests, eq(requests.id, requestLinks.requestId))
    .where(eq(requestLinks.tokenHash, hash))
    .get()?.request;
}

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
  // A status link is not proof of owning the email address.
  if (request.status === "unverified" && request.tokenHash !== hashToken(token))
    return { ok: false, error: "not_found" };
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
        note: "verifierad via e-post",
        createdAt: nowIso,
      })
      .run();
    return true;
  });
  if (changed) deps.events.emit("request.verified", { id: request.id });
  return { ok: true, status: "new", alreadyVerified: !changed };
}

export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_VERIFICATION_RESENDS = 3;
const RESENT_NOTE = "Bekräftelselänk (skickad igen)";

type ResendResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "already_verified" | "too_soon" | "resend_limit" | "mail_failed";
    };

/**
 * Mails a fresh verification link to the stored address. Any token for the request may ask,
 * since the link only ever goes to that address. The new token replaces the old one (only its
 * hash is stored) and gets a full 24 h, so this also rescues a request whose link expired.
 */
export async function resendVerification(
  deps: { db: Db; mailer: Mailer; appOrigin: string },
  token: string,
  now = new Date(),
): Promise<ResendResult> {
  const { db } = deps;
  const request = findByToken(db, token);
  if (!request) return { ok: false, error: "not_found" };
  if (request.status !== "unverified") return { ok: false, error: "already_verified" };

  // Every link is issued with a full TTL, so the expiry tells when the last one was sent.
  const lastSent = new Date(request.tokenExpires).getTime() - VERIFY_TOKEN_TTL_MS;
  if (now.getTime() - lastSent < RESEND_COOLDOWN_MS) return { ok: false, error: "too_soon" };
  const resent =
    db
      .select({ n: count() })
      .from(requestEvents)
      .where(and(eq(requestEvents.requestId, request.id), eq(requestEvents.type, "email_sent")))
      .get()?.n ?? 0;
  if (resent >= MAX_VERIFICATION_RESENDS) return { ok: false, error: "resend_limit" };

  const fresh = newToken();
  const nowIso = now.toISOString();
  // Claim the swap first, guarded on the old token, so two clicks at once send only one mail.
  const claimed = db
    .update(requests)
    .set({
      tokenHash: hashToken(fresh),
      tokenExpires: new Date(now.getTime() + VERIFY_TOKEN_TTL_MS).toISOString(),
    })
    .where(
      and(
        eq(requests.id, request.id),
        eq(requests.status, "unverified"),
        eq(requests.tokenHash, request.tokenHash),
      ),
    )
    .run();
  if (claimed.changes === 0) return { ok: false, error: "too_soon" };

  try {
    await deps.mailer.send(
      verificationMail({
        to: request.email,
        name: request.name,
        appOrigin: deps.appOrigin,
        token: fresh,
        resent: true,
      }),
    );
  } catch (err) {
    console.error(`[requests] verification resend failed for ${request.id}`, err);
    // Put the old link back, so the first mail still works and the requester can try again.
    db.update(requests)
      .set({ tokenHash: request.tokenHash, tokenExpires: request.tokenExpires })
      .where(and(eq(requests.id, request.id), eq(requests.tokenHash, hashToken(fresh))))
      .run();
    return { ok: false, error: "mail_failed" };
  }

  db.insert(requestEvents)
    .values({
      id: newId(now.getTime()),
      requestId: request.id,
      type: "email_sent",
      note: RESENT_NOTE,
      createdAt: nowIso,
    })
    .run();
  return { ok: true };
}

const isCancellable = (s: RequestStatus) => (CANCELLABLE_STATUSES as readonly string[]).includes(s);

/**
 * Turns the status history into the steps leading to the current status. Going back to an
 * earlier step (staff reopening, or re-accepting to reschedule) drops the later steps and
 * keeps the latest time, so the requester sees one clean path, e.g. Mottagen → Godkänd.
 */
export function statusTimeline(
  changes: { toStatus: RequestStatus; at: string }[],
): RequestStatusView["timeline"] {
  const path: RequestStatusView["timeline"] = [];
  for (const change of changes) {
    if (change.toStatus === "unverified") continue;
    const earlier = path.findIndex((step) => step.status === change.toStatus);
    if (earlier >= 0) path.splice(earlier);
    path.push({ status: change.toStatus, at: change.at });
  }
  return path;
}

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
    timeline: statusTimeline(
      db
        .select({ toStatus: requestEvents.toStatus, at: requestEvents.createdAt })
        .from(requestEvents)
        .where(
          and(eq(requestEvents.requestId, request.id), eq(requestEvents.type, "status_change")),
        )
        .orderBy(asc(requestEvents.createdAt), asc(requestEvents.id))
        .all()
        .filter((e): e is { toStatus: RequestStatus; at: string } => e.toStatus !== null),
    ),
  };
}

export function getStatusView(db: Db, token: string): RequestStatusView | null {
  const request = findByToken(db, token);
  return request ? buildView(db, request) : null;
}

type CancelResult = { ok: true } | { ok: false; error: "not_found" | "not_cancellable" };

/**
 * The requester cancels before staff have started on the request. The request is deleted at
 * once; if staff could already see it, the reason is kept (without personal data) for them.
 */
export async function cancelRequest(
  deps: { db: Db; storage: Storage; events: AppEventBus },
  token: string,
  reason: string,
  now = new Date(),
): Promise<CancelResult> {
  const { db } = deps;
  const request = findByToken(db, token);
  if (!request) return { ok: false, error: "not_found" };
  if (!isCancellable(request.status)) return { ok: false, error: "not_cancellable" };

  const keys = db
    .select({ key: images.s3Key })
    .from(images)
    .where(eq(images.requestId, request.id))
    .all()
    .map((r) => r.key);
  const itemList = itemSummary(
    db
      .select({ title: items.title, quantity: items.quantity })
      .from(items)
      .where(eq(items.requestId, request.id))
      .all(),
  );

  const deleted = db.transaction((tx) => {
    // Only if staff haven't picked it up in the meantime.
    const res = tx
      .delete(requests)
      .where(and(eq(requests.id, request.id), inArray(requests.status, CANCELLABLE_STATUSES)))
      .run();
    if (res.changes === 0) return false;
    // Logged for unverified requests too, since staff can see those in the "Nya" tab.
    tx.insert(cancellations)
      .values({
        id: newId(now.getTime()),
        requestId: request.id,
        reason,
        items: itemList,
        requestCreatedAt: request.createdAt,
        cancelledAt: now.toISOString(),
      })
      .run();
    return true;
  });
  if (!deleted) return { ok: false, error: "not_cancellable" };

  // After the rows: if storage fails, the orphan sweep removes the photos within a day.
  try {
    if (keys.length > 0) await deps.storage.delete(keys);
  } catch (err) {
    console.error(`[requests] photo cleanup failed for cancelled ${request.id}`, err);
  }
  deps.events.emit("request.cancelled", { id: request.id });
  return { ok: true };
}

const itemSummary = (rows: { title: string; quantity: number }[]) =>
  rows.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.title}` : i.title)).join(", ");
