import {
  type AdminRequestDetail,
  type AdminRequestListItem,
  type AdminRequestPage,
  type Me,
  type NotificationSummary,
  RETENTION_DAYS_CLOSED,
  type RequestStatus,
  type StatusChange,
  type StatusCounts,
  stockholmToday,
  stockholmToUtcIso,
} from "@hamtning/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  type like,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "../db/client.js";
import {
  categories,
  employees,
  images,
  items,
  requestEvents,
  requests,
  timeWindows,
} from "../db/schema.js";
import type { AppEventBus } from "../events.js";
import type { Mailer } from "../mailer/index.js";
import { statusMail } from "../mailer/templates.js";
import { deleteRequests } from "../retention/purge.js";
import type { Storage } from "../storage/index.js";

export const PAGE_SIZE = 25;
const IMAGE_URL_TTL_SECONDS = 15 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export const LIST_FILTERS = [
  "all",
  "new",
  "in_progress",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

/** Requests staff can see at all. Unverified ones are possible spam and stay hidden. */
const visible = ne(requests.status, "unverified");

const encodeCursor = (createdAt: string, id: string) =>
  Buffer.from(`${createdAt}|${id}`).toString("base64url");

function decodeCursor(cursor: string): [string, string] | null {
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
  return createdAt && id ? [createdAt, id] : null;
}

/** LIKE pattern with user input escaped, so "%" and "_" match literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listRequests(
  deps: { db: Db; storage: Storage },
  opts: { filter: ListFilter; q?: string; cursor?: string },
): Promise<AdminRequestPage> {
  const { db } = deps;
  const conditions: (SQL | undefined)[] = [visible];
  if (opts.filter !== "all") conditions.push(eq(requests.status, opts.filter));

  const q = opts.q?.trim();
  if (q) {
    const pattern = likePattern(q);
    const match = (col: Parameters<typeof like>[0]) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;
    conditions.push(
      or(
        match(requests.name),
        match(requests.email),
        match(requests.phone),
        match(requests.street),
        match(requests.city),
        match(requests.postcode),
        exists(
          db
            .select({ one: sql`1` })
            .from(items)
            .where(and(eq(items.requestId, requests.id), match(items.title))),
        ),
      ),
    );
  }

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cursor) {
    const [createdAt, id] = cursor;
    conditions.push(
      or(
        lt(requests.createdAt, createdAt),
        and(eq(requests.createdAt, createdAt), lt(requests.id, id)),
      ),
    );
  }

  const rows = db
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(PAGE_SIZE + 1)
    .all();
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.id);

  const itemRows = ids.length
    ? db.select().from(items).where(inArray(items.requestId, ids)).all()
    : [];
  const imageRows = ids.length
    ? db
        .select()
        .from(images)
        .where(inArray(images.requestId, ids))
        .orderBy(asc(images.position))
        .all()
    : [];

  const list: AdminRequestListItem[] = await Promise.all(
    page.map(async (r) => {
      const its = itemRows.filter((i) => i.requestId === r.id);
      const imgs = imageRows.filter((i) => i.requestId === r.id);
      const titles = its.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.title}` : i.title));
      return {
        id: r.id,
        status: r.status,
        name: r.name,
        city: r.city,
        postcode: r.postcode,
        createdAt: r.createdAt,
        verifiedAt: r.verifiedAt,
        seen: r.seenAt !== null,
        itemSummary:
          titles.slice(0, 3).join(", ") + (titles.length > 3 ? ` +${titles.length - 3}` : ""),
        itemCount: its.length,
        imageCount: imgs.length,
        thumbnailUrl: imgs[0]
          ? await deps.storage.presignDownload(imgs[0].s3Key, IMAGE_URL_TTL_SECONDS)
          : null,
      };
    }),
  );

  const last = page.at(-1);
  return {
    requests: list,
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export const deleteAfter = (closedAt: string | null) =>
  closedAt
    ? new Date(new Date(closedAt).getTime() + RETENTION_DAYS_CLOSED * DAY_MS).toISOString()
    : null;

/** Returns null for unknown ids and for unverified requests (invisible to staff). */
export async function getRequestDetail(
  deps: { db: Db; storage: Storage; events: AppEventBus },
  id: string,
  opts: { markSeen: boolean },
): Promise<AdminRequestDetail | null> {
  const { db } = deps;
  const r = db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), visible))
    .get();
  if (!r) return null;

  if (opts.markSeen && r.seenAt === null) {
    const res = db
      .update(requests)
      .set({ seenAt: new Date().toISOString() })
      .where(and(eq(requests.id, id), isNull(requests.seenAt)))
      .run();
    if (res.changes > 0) deps.events.emit("request.seen", { id });
  }

  const itemRows = db
    .select({
      id: items.id,
      title: items.title,
      category: categories.labelSv,
      condition: items.condition,
      quantity: items.quantity,
      description: items.description,
    })
    .from(items)
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(eq(items.requestId, id))
    .all();
  const imageRows = db
    .select()
    .from(images)
    .where(eq(images.requestId, id))
    .orderBy(asc(images.position))
    .all();
  const windowRows = db
    .select({
      id: timeWindows.id,
      date: timeWindows.date,
      part: timeWindows.part,
      fromTime: timeWindows.fromTime,
      toTime: timeWindows.toTime,
      note: timeWindows.note,
    })
    .from(timeWindows)
    .where(eq(timeWindows.requestId, id))
    .orderBy(asc(timeWindows.date))
    .all();
  const eventRows = db
    .select({
      id: requestEvents.id,
      type: requestEvents.type,
      fromStatus: requestEvents.fromStatus,
      toStatus: requestEvents.toStatus,
      note: requestEvents.note,
      employeeName: employees.name,
      createdAt: requestEvents.createdAt,
    })
    .from(requestEvents)
    .leftJoin(employees, eq(employees.id, requestEvents.employeeId))
    .where(eq(requestEvents.requestId, id))
    .orderBy(desc(requestEvents.createdAt), desc(requestEvents.id))
    .all();

  return {
    id: r.id,
    status: r.status,
    name: r.name,
    email: r.email,
    phone: r.phone,
    street: r.street,
    postcode: r.postcode,
    city: r.city,
    floor: r.floor,
    hasElevator: r.hasElevator,
    accessNotes: r.accessNotes,
    message: r.message,
    createdAt: r.createdAt,
    verifiedAt: r.verifiedAt,
    confirmedStart: r.confirmedStart,
    confirmedEnd: r.confirmedEnd,
    staffMessage: r.staffMessage,
    deleteAfter: deleteAfter(r.closedAt),
    items: itemRows,
    images: await Promise.all(
      imageRows.map(async (i) => ({
        id: i.id,
        url: await deps.storage.presignDownload(i.s3Key, IMAGE_URL_TTL_SECONDS),
      })),
    ),
    timeWindows: windowRows,
    events: eventRows.map((e) => ({
      ...e,
      fromStatus: e.fromStatus as RequestStatus | null,
      toStatus: e.toStatus as RequestStatus | null,
    })),
  };
}

type ChangeResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "cancelled_by_requester" | "unchanged" | "date_in_past" };

export async function changeStatus(
  deps: { db: Db; mailer: Mailer; events: AppEventBus },
  id: string,
  employee: Me,
  change: StatusChange,
  now = new Date(),
): Promise<ChangeResult> {
  const { db } = deps;
  const r = db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), visible))
    .get();
  if (!r) return { ok: false, error: "not_found" };
  // The requester withdrew; staff shouldn't re-open it behind their back.
  if (r.status === "cancelled") return { ok: false, error: "cancelled_by_requester" };
  // Re-accepting is allowed: that is how a pickup gets rescheduled.
  if (r.status === change.status && change.status !== "accepted")
    return { ok: false, error: "unchanged" };

  let confirmedStart: string | null = null;
  let confirmedEnd: string | null = null;
  if (change.status === "accepted" && change.confirmed) {
    if (change.confirmed.date < stockholmToday(now)) return { ok: false, error: "date_in_past" };
    confirmedStart = stockholmToUtcIso(change.confirmed.date, change.confirmed.fromTime);
    confirmedEnd = stockholmToUtcIso(change.confirmed.date, change.confirmed.toTime);
  }

  const nowIso = now.toISOString();
  // Retention runs from when the request is finished. For an accepted request that is the
  // pickup itself, which can be weeks away, not the moment it was accepted.
  const closedAt =
    change.status === "declined"
      ? nowIso
      : change.status === "accepted" && confirmedEnd
        ? confirmedEnd > nowIso
          ? confirmedEnd
          : nowIso
        : null;
  const decided = change.status === "accepted" || change.status === "declined";
  const message = change.message || null;

  db.transaction((tx) => {
    tx.update(requests)
      .set({
        status: change.status,
        confirmedStart,
        confirmedEnd,
        closedAt,
        staffMessage: decided ? message : null,
        seenAt: r.seenAt ?? nowIso,
        updatedAt: nowIso,
      })
      .where(eq(requests.id, id))
      .run();
    tx.insert(requestEvents)
      .values({
        id: ulid(),
        requestId: id,
        employeeId: employee.id,
        type: "status_change",
        fromStatus: r.status,
        toStatus: change.status,
        note: message,
        createdAt: nowIso,
      })
      .run();
  });

  if (decided) {
    try {
      await deps.mailer.send(
        statusMail({
          to: r.email,
          name: r.name,
          status: change.status as "accepted" | "declined",
          confirmedStart,
          confirmedEnd,
          message,
        }),
      );
      db.insert(requestEvents)
        .values({
          id: ulid(),
          requestId: id,
          employeeId: employee.id,
          type: "email_sent",
          note: change.status === "accepted" ? "Bekräftelse av hämtning" : "Besked om avslag",
          createdAt: new Date().toISOString(),
        })
        .run();
    } catch (err) {
      // The status change stands; the missing email_sent event shows staff the mail didn't go out.
      console.error(`[admin] status mail failed for ${id}`, err);
    }
  }

  deps.events.emit("request.changed", { id });
  return { ok: true };
}

export function addNote(db: Db, id: string, employee: Me, note: string): boolean {
  const r = db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.id, id), visible))
    .get();
  if (!r) return false;
  db.insert(requestEvents)
    .values({
      id: ulid(),
      requestId: id,
      employeeId: employee.id,
      type: "note",
      note,
      createdAt: new Date().toISOString(),
    })
    .run();
  return true;
}

export function notificationSummary(db: Db): NotificationSummary {
  const counts: StatusCounts = { new: 0, in_progress: 0, accepted: 0, declined: 0, cancelled: 0 };
  const grouped = db
    .select({ status: requests.status, n: count() })
    .from(requests)
    .where(visible)
    .groupBy(requests.status)
    .all();
  for (const g of grouped) if (g.status !== "unverified") counts[g.status] = g.n;

  const unseen = and(eq(requests.status, "new"), isNull(requests.seenAt));
  const unseenCount = db.select({ n: count() }).from(requests).where(unseen).get()?.n ?? 0;
  const latestUnseen = db
    .select({
      id: requests.id,
      name: requests.name,
      city: requests.city,
      verifiedAt: requests.verifiedAt,
    })
    .from(requests)
    .where(unseen)
    .orderBy(desc(requests.verifiedAt))
    .limit(5)
    .all()
    .map((r) => ({ ...r, verifiedAt: r.verifiedAt ?? "" }));

  return { unseenCount, counts, latestUnseen };
}

/** Manual erasure ("radera ärende"), e.g. when a requester asks to be forgotten. */
export async function deleteRequestNow(
  deps: { db: Db; storage: Storage; events: AppEventBus },
  id: string,
  employee: Me,
): Promise<boolean> {
  const r = deps.db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.id, id), visible))
    .get();
  if (!r) return false;
  await deleteRequests(deps, [id]);
  // The history went with the request, so this log line is the only trace: ids only, no personal data.
  console.log(`[admin] request ${id} deleted by employee ${employee.id}`);
  deps.events.emit("request.changed", { id });
  return true;
}
