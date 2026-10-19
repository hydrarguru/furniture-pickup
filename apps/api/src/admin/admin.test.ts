import type {
  AdminCancellation,
  AdminCategory,
  AdminRequestDetail,
  AdminRequestPage,
  NotificationSummary,
  RequestStatusView,
} from "@hamtning/shared";
import { addDays, stockholmToday } from "@hamtning/shared";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../auth/passwords.js";
import {
  cancellations,
  categories,
  employees,
  images,
  requestEvents,
  requestLinks,
  requests,
  sessions,
} from "../db/schema.js";
import { purgeExpired } from "../retention/purge.js";
import { createTestApp, seedRequest as seed } from "../test/helpers.js";

let t: ReturnType<typeof createTestApp>;
let ip = 0;

beforeEach(() => {
  t = createTestApp();
});

async function addEmployee(role: "staff" | "admin" = "staff", username = `${role}-user`) {
  const id = ulid();
  t.db
    .insert(employees)
    .values({
      id,
      username,
      name: role === "admin" ? "Ada Admin" : "Sam Staff",
      role,
      passwordHash: await hashPassword("rätt-lösen"),
      createdAt: new Date().toISOString(),
    })
    .run();
  return id;
}

const send = (
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; csrf?: boolean } = {},
) =>
  t.app.request(path, {
    method: init.method ?? "GET",
    headers: {
      "x-real-ip": `10.0.0.${++ip % 250}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.csrf === false ? {} : { "x-requested-with": "fetch" }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function login(username = "staff-user", password = "rätt-lösen") {
  const res = await send("/api/auth/login", { method: "POST", body: { username, password } });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { res, cookie };
}

async function staffCookie(role: "staff" | "admin" = "staff") {
  await addEmployee(role);
  return (await login(`${role}-user`)).cookie;
}

const seedRequest = (o: Parameters<typeof seed>[1] = {}) => seed(t, o);

describe("auth", () => {
  it("logs in with a secure session cookie and returns the employee", async () => {
    await addEmployee("staff");
    const { res, cookie } = await login("STAFF-User");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "staff-user", role: "staff" });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api/);
    expect((await send("/api/auth/me", { cookie })).status).toBe(200);
    // Only the hash of the session id is stored.
    const stored = t.db.select().from(sessions).get();
    expect(cookie).not.toContain(stored?.idHash ?? "");
  });

  it("gives the same answer for a wrong password and an unknown username", async () => {
    await addEmployee("staff");
    const wrong = await login("staff-user", "fel");
    const unknown = await login("nobody", "fel");
    expect([wrong.res.status, unknown.res.status]).toEqual([401, 401]);
    expect(await wrong.res.json()).toEqual(await unknown.res.json());
  });

  it("locks an account after 5 failed attempts, even from different IPs", async () => {
    await addEmployee("staff");
    for (let i = 0; i < 5; i++) expect((await login("staff-user", "fel")).res.status).toBe(401);
    const locked = await login("staff-user", "rätt-lösen");
    expect(locked.res.status).toBe(429);
  });

  it("logs out and invalidates the session server-side", async () => {
    const cookie = await staffCookie();
    expect((await send("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await send("/api/auth/me", { cookie })).status).toBe(401);
    expect(t.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("rejects state-changing requests without the CSRF header", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const res = await send(`/api/admin/requests/${id}/notes`, {
      method: "POST",
      cookie,
      csrf: false,
      body: { note: "x" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_header_missing" });
    expect(
      (
        await send("/api/auth/login", {
          method: "POST",
          csrf: false,
          body: { username: "a.b", password: "x" },
        })
      ).status,
    ).toBe(403);
  });

  it("requires a session for admin routes", async () => {
    expect((await send("/api/admin/requests")).status).toBe(401);
    expect((await send("/api/admin/requests", { cookie: "sid=forged" })).status).toBe(401);
  });

  it("expires sessions", async () => {
    const cookie = await staffCookie();
    t.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .run();
    expect((await send("/api/auth/me", { cookie })).status).toBe(401);
  });
});

describe("request list", () => {
  it("lists unverified requests under new and filters by status", async () => {
    const cookie = await staffCookie();
    seedRequest({ status: "unverified", verifiedAt: null, name: "Spam" });
    seedRequest({ status: "new", name: "Ny Person" });
    seedRequest({ status: "accepted", name: "Klar Person" });

    const all = (await (await send("/api/admin/requests", { cookie })).json()) as AdminRequestPage;
    expect(all.requests.map((r) => r.name).sort()).toEqual(["Klar Person", "Ny Person", "Spam"]);
    const fresh = (await (
      await send("/api/admin/requests?status=new", { cookie })
    ).json()) as AdminRequestPage;
    expect(fresh.requests.map((r) => r.name).sort()).toEqual(["Ny Person", "Spam"]);
    const accepted = (await (
      await send("/api/admin/requests?status=accepted", { cookie })
    ).json()) as AdminRequestPage;
    expect(accepted.requests.map((r) => r.name)).toEqual(["Klar Person"]);
    const first = all.requests.find((r) => r.name === "Klar Person");
    expect(first).toMatchObject({ itemSummary: "Soffa", imageCount: 1, seen: false });
    expect(first?.thumbnailUrl).toMatch(/^https:\/\/s3\.test\/uploads\//);
  });

  it("searches contact fields and item titles, treating % literally", async () => {
    const cookie = await staffCookie();
    seedRequest({ name: "Bo Bergman", city: "Mölndal" });
    seedRequest({ name: "Cia Ek", itemTitle: "Ekbord 100%" });
    const search = async (q: string) =>
      (
        (await (
          await send(`/api/admin/requests?q=${encodeURIComponent(q)}`, { cookie })
        ).json()) as AdminRequestPage
      ).requests.map((r) => r.name);
    expect(await search("mölndal")).toEqual(["Bo Bergman"]);
    expect(await search("ekbord")).toEqual(["Cia Ek"]);
    expect(await search("100%")).toEqual(["Cia Ek"]);
    expect(await search("%")).toEqual(["Cia Ek"]);
  });

  it("pages newest first with a cursor", async () => {
    const cookie = await staffCookie();
    for (let i = 0; i < 30; i++)
      seedRequest({
        name: `P${String(i).padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        photos: 0,
      });
    const p1 = (await (await send("/api/admin/requests", { cookie })).json()) as AdminRequestPage;
    expect(p1.requests).toHaveLength(25);
    expect(p1.requests[0]?.name).toBe("P29");
    const p2 = (await (
      await send(`/api/admin/requests?cursor=${p1.nextCursor}`, { cookie })
    ).json()) as AdminRequestPage;
    expect(p2.requests.map((r) => r.name)).toEqual(["P04", "P03", "P02", "P01", "P00"]);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("request detail", () => {
  it("returns everything staff need and marks the request seen once", async () => {
    const cookie = await staffCookie();
    const id = seedRequest({ photos: 2 });
    const seen: string[] = [];
    t.events.on("request.seen", (e) => seen.push(e.id));

    const res = await send(`/api/admin/requests/${id}`, { cookie });
    const detail = (await res.json()) as AdminRequestDetail;
    expect(detail).toMatchObject({
      email: "anna@example.se",
      phone: "+46701234567",
      street: "Storgatan 1",
    });
    expect(detail.images).toHaveLength(2);
    expect(detail.timeWindows).toHaveLength(1);
    await send(`/api/admin/requests/${id}`, { cookie });
    expect(seen).toEqual([id]);
    const summary = (await (
      await send("/api/admin/notifications/summary", { cookie })
    ).json()) as NotificationSummary;
    expect(summary.unseenCount).toBe(0);
  });

  it("shows unverified requests without marking them seen", async () => {
    const cookie = await staffCookie();
    const id = seedRequest({ status: "unverified", verifiedAt: null });
    const res = await send(`/api/admin/requests/${id}`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unverified", verifiedAt: null });
    expect(t.db.select().from(requests).where(eq(requests.id, id)).get()?.seenAt).toBeNull();
  });
});

describe("request location", () => {
  it("geocodes the pickup address", async () => {
    const cookie = await staffCookie();
    const id = seedRequest({ street: "Kungsgatan 5", postcode: "41119", city: "Göteborg" });
    const res = await send(`/api/admin/requests/${id}/location`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      location: { lat: 57.7, lon: 11.97, precision: "address" },
    });
    expect(t.geocoder.calls).toEqual([
      { street: "Kungsgatan 5", postcode: "41119", city: "Göteborg" },
    ]);
  });

  it("returns null when the address can't be found", async () => {
    const cookie = await staffCookie();
    t.geocoder.result = null;
    const res = await send(`/api/admin/requests/${seedRequest()}/location`, { cookie });
    expect(await res.json()).toEqual({ location: null });
  });

  it("answers 502 when the geocoder is down", async () => {
    const cookie = await staffCookie();
    t.geocoder.fail = true;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(`/api/admin/requests/${seedRequest()}/location`, { cookie });
    quiet.mockRestore();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "geocoder_unavailable" });
  });

  it("requires a session", async () => {
    expect((await send(`/api/admin/requests/${seedRequest()}/location`)).status).toBe(401);
    expect(t.geocoder.calls).toEqual([]);
  });
});

describe("cancellations", () => {
  it("lists the reasons customers gave, newest first, to signed-in staff", async () => {
    const add = (id: string, reason: string, cancelledAt: string) =>
      t.db
        .insert(cancellations)
        .values({
          id,
          requestId: id,
          reason,
          items: "Soffa",
          requestCreatedAt: cancelledAt,
          cancelledAt,
        })
        .run();
    add("a", "Har sålt den själv.", "2026-10-10T08:00:00.000Z");
    add("b", "Flyttar inte ändå.", "2026-10-12T08:00:00.000Z");

    expect((await send("/api/admin/cancellations")).status).toBe(401);
    const res = await send("/api/admin/cancellations", { cookie: await staffCookie() });
    const body = (await res.json()) as { cancellations: AdminCancellation[] };
    expect(body.cancellations.map((c) => c.reason)).toEqual([
      "Flyttar inte ändå.",
      "Har sålt den själv.",
    ]);
    expect(body.cancellations[0]).toEqual({
      id: "b",
      reason: "Flyttar inte ändå.",
      items: "Soffa",
      requestCreatedAt: "2026-10-12T08:00:00.000Z",
      cancelledAt: "2026-10-12T08:00:00.000Z",
    });
  });
});

describe("status changes", () => {
  const patch = (id: string, cookie: string, body: unknown) =>
    send(`/api/admin/requests/${id}/status`, { method: "PATCH", cookie, body });
  const pickupDate = () => addDays(stockholmToday(), 10);

  it("accepts with a pickup time, mails the requester and starts retention after the pickup", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const changed: string[] = [];
    t.events.on("request.changed", (e) => changed.push(e.id));

    const res = await patch(id, cookie, {
      status: "accepted",
      message: "Vi ringer innan.",
      confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminRequestDetail;
    expect(detail.status).toBe("accepted");
    expect(detail.staffMessage).toBe("Vi ringer innan.");
    expect(detail.confirmedEnd).not.toBeNull();
    // 30 days counted from the end of the pickup, not from now.
    const days =
      (new Date(detail.deleteAfter ?? 0).getTime() - new Date(detail.confirmedEnd ?? 0).getTime()) /
      864e5;
    expect(days).toBe(30);

    expect(t.mailer.sent.at(-1)).toMatchObject({
      to: "anna@example.se",
      subject: "Vi hämtar dina saker",
    });
    expect(t.mailer.sent.at(-1)?.text).toContain("09:00–11:00");
    expect(t.mailer.sent.at(-1)?.text).toContain("Vi ringer innan.");
    expect(detail.events.map((e) => e.type)).toEqual(["email_sent", "status_change"]);
    expect(detail.events[1]).toMatchObject({
      fromStatus: "new",
      toStatus: "accepted",
      employeeName: "Sam Staff",
    });
    expect(changed).toEqual([id]);
  });

  it("declines with a message", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const res = await patch(id, cookie, {
      status: "declined",
      message: "Vi har inte plats just nu.",
    });
    expect(res.status).toBe(200);
    expect(t.mailer.sent.at(-1)?.subject).toBe("Angående din förfrågan om hämtning");
    expect(t.mailer.sent.at(-1)?.text).toContain("Vi har inte plats just nu.");
  });

  it("reopening an accepted request clears the decision", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    await patch(id, cookie, {
      status: "accepted",
      message: "Vi ringer innan.",
      confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
    });
    const reopened = (await (
      await patch(id, cookie, { status: "in_progress" })
    ).json()) as AdminRequestDetail;
    expect(reopened).toMatchObject({ status: "in_progress", staffMessage: null });
    // Back to waiting for staff: the 7-day inactivity clock applies again, not the 30-day one.
    const days = (new Date(reopened.deleteAfter ?? 0).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect(t.mailer.sent).toHaveLength(1); // no mail for internal statuses
  });

  it("includes a working status page link in every status email", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const linkIn = (text = "") => {
      const match = text.match(/https:\/\/hamta\.test\/arende\/([\w-]{43})\n/);
      expect(match).not.toBeNull();
      return match?.[1] as string;
    };
    const view = async (token: string) =>
      (await (await send(`/api/requests/by-token/${token}`)).json()) as RequestStatusView;

    await patch(id, cookie, {
      status: "accepted",
      confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
    });
    const first = linkIn(t.mailer.sent.at(-1)?.text);
    expect((await view(first)).status).toBe("accepted");

    await patch(id, cookie, { status: "on_the_way" });
    const second = linkIn(t.mailer.sent.at(-1)?.text);
    expect(second).not.toBe(first);
    // Older emails keep working and show the current status.
    expect((await view(first)).status).toBe("on_the_way");
    expect((await view(second)).status).toBe("on_the_way");

    // Purging the request takes its links with it.
    t.db.delete(requests).where(eq(requests.id, id)).run();
    expect((await send(`/api/requests/by-token/${first}`)).status).toBe(404);
    expect(t.db.select().from(requestLinks).all()).toHaveLength(0);
  });

  it("refuses accepting without a time, in the past, and invalid transitions", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    expect((await patch(id, cookie, { status: "accepted" })).status).toBe(400);
    const past = await patch(id, cookie, {
      status: "accepted",
      confirmed: { date: addDays(stockholmToday(), -1), fromTime: "09:00", toTime: "10:00" },
    });
    expect(past.status).toBe(400);
    expect((await patch(id, cookie, { status: "new" })).status).toBe(409); // unchanged
    expect((await patch(id, cookie, { status: "cancelled" })).status).toBe(400);

    const cancelled = seedRequest({ status: "cancelled" });
    expect((await patch(cancelled, cookie, { status: "in_progress" })).status).toBe(409);
    const unverified = seedRequest({ status: "unverified" });
    const refused = await patch(unverified, cookie, { status: "in_progress" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "unverified" });
  });

  it("allows rescheduling an accepted pickup", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const confirmed = { date: pickupDate(), fromTime: "09:00", toTime: "11:00" };
    await patch(id, cookie, { status: "accepted", confirmed });
    const res = await patch(id, cookie, {
      status: "accepted",
      confirmed: { ...confirmed, fromTime: "13:00", toTime: "15:00" },
    });
    expect(res.status).toBe(200);
    expect(t.mailer.sent).toHaveLength(2);
  });

  it("marks an accepted pickup as on the way, mails the customer and keeps the time", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const accepted = (await (
      await patch(id, cookie, {
        status: "accepted",
        message: "Vi ringer innan.",
        confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
      })
    ).json()) as AdminRequestDetail;

    const res = await patch(id, cookie, { status: "on_the_way" });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminRequestDetail;
    expect(detail).toMatchObject({
      status: "on_the_way",
      confirmedStart: accepted.confirmedStart,
      confirmedEnd: accepted.confirmedEnd,
      deleteAfter: accepted.deleteAfter, // still 30 days after the pickup
      staffMessage: "Vi ringer innan.", // kept when no new message is given
    });
    const mail = t.mailer.sent.at(-1);
    expect(mail).toMatchObject({ to: "anna@example.se", subject: "Vi är på väg till dig" });
    expect(mail?.text).toContain("09:00–11:00");
    expect(mail?.text).toContain("Ring oss på 031-123 45 67");
    expect(detail.events[0]).toMatchObject({
      type: "email_sent",
      note: "Besked om att vi är på väg",
    });
    expect(detail.events[1]).toMatchObject({ fromStatus: "accepted", toStatus: "on_the_way" });
  });

  it("replaces the customer message when one is given with on the way", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    await patch(id, cookie, {
      status: "accepted",
      message: "Vi ringer innan.",
      confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
    });
    const detail = (await (
      await patch(id, cookie, { status: "on_the_way", message: "Framme om ca 20 minuter." })
    ).json()) as AdminRequestDetail;
    expect(detail.staffMessage).toBe("Framme om ca 20 minuter.");
    expect(t.mailer.sent.at(-1)?.text).toContain("Framme om ca 20 minuter.");
  });

  it("treats a decline as final: no accepting and no reopening", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    await patch(id, cookie, { status: "declined", message: "Vi tar inte emot madrasser." });
    const attempts = [
      { status: "accepted", confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" } },
      { status: "new" },
      { status: "in_progress" },
      { status: "on_the_way" },
      { status: "declined", message: "Igen." },
    ];
    for (const body of attempts) {
      const res = await patch(id, cookie, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "declined" });
    }
    const detail = (await (
      await send(`/api/admin/requests/${id}`, { cookie })
    ).json()) as AdminRequestDetail;
    expect(detail).toMatchObject({
      status: "declined",
      staffMessage: "Vi tar inte emot madrasser.",
    });
    expect(t.mailer.sent).toHaveLength(1); // only the decline
  });

  it("only allows on the way for accepted pickups", async () => {
    const cookie = await staffCookie();
    for (const status of ["new", "in_progress"] as const) {
      const id = seedRequest({ status });
      const res = await patch(id, cookie, { status: "on_the_way" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_accepted" });
    }
    const id = seedRequest();
    await patch(id, cookie, {
      status: "accepted",
      confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
    });
    await patch(id, cookie, { status: "on_the_way" });
    expect((await patch(id, cookie, { status: "on_the_way" })).status).toBe(409); // unchanged
    // Rescheduling from on the way goes back through accepted.
    const back = await patch(id, cookie, {
      status: "accepted",
      confirmed: { date: pickupDate(), fromTime: "13:00", toTime: "15:00" },
    });
    expect(back.status).toBe(200);
  });

  it("keeps history in order when events share a millisecond", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    // Freeze the clock so the status change and its email get identical timestamps.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    try {
      for (let i = 0; i < 20; i++) {
        const body =
          i % 2 === 0
            ? {
                status: "accepted",
                confirmed: { date: pickupDate(), fromTime: "09:00", toTime: "11:00" },
              }
            : { status: "in_progress" };
        const detail = (await (await patch(id, cookie, body)).json()) as AdminRequestDetail;
        if (body.status === "accepted")
          expect(detail.events.slice(0, 2).map((e) => e.type)).toEqual([
            "email_sent",
            "status_change",
          ]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the status change when the mail fails", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    t.mailer.fail = true;
    const res = await patch(id, cookie, { status: "declined" });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as AdminRequestDetail;
    expect(detail.status).toBe("declined");
    expect(detail.events.map((e) => e.type)).toEqual(["status_change"]);
  });
});

describe("notes", () => {
  it("adds an internal note to the history", async () => {
    const cookie = await staffCookie();
    const id = seedRequest();
    const res = await send(`/api/admin/requests/${id}/notes`, {
      method: "POST",
      cookie,
      body: { note: "Ringde, inget svar." },
    });
    expect(res.status).toBe(201);
    const detail = (await res.json()) as AdminRequestDetail;
    expect(detail.events[0]).toMatchObject({
      type: "note",
      note: "Ringde, inget svar.",
      employeeName: "Sam Staff",
    });
    // Internal notes never reach the requester's status page.
    const row = t.db.select().from(requests).where(eq(requests.id, id)).get();
    expect(row?.staffMessage).toBeNull();
    expect(t.db.select().from(requestEvents).all()).toHaveLength(1);
  });
});

describe("inactivity clock", () => {
  const eightDaysAgo = () => new Date(Date.now() - 8 * 864e5).toISOString();

  it("restarts when staff add a note, but not when they only open the request", async () => {
    const cookie = await staffCookie();
    const opened = seedRequest({ updatedAt: eightDaysAgo() });
    const noted = seedRequest({ updatedAt: eightDaysAgo() });

    await send(`/api/admin/requests/${opened}`, { cookie });
    await send(`/api/admin/requests/${noted}/notes`, {
      method: "POST",
      cookie,
      body: { note: "Ringer imorgon." },
    });

    expect(await purgeExpired(t)).toMatchObject({ inactive: 1 });
    expect(t.db.select().from(requests).where(eq(requests.id, opened)).get()).toBeUndefined();
    expect(t.db.select().from(requests).where(eq(requests.id, noted)).get()).toBeDefined();
  });

  it("shows the deletion date in the list so staff can act in time", async () => {
    const cookie = await staffCookie();
    const updatedAt = new Date(Date.now() - 5 * 864e5).toISOString();
    seedRequest({ updatedAt });
    const page = (await (await send("/api/admin/requests", { cookie })).json()) as AdminRequestPage;
    expect(page.requests[0]?.deleteAfter).toBe(
      new Date(new Date(updatedAt).getTime() + 7 * 864e5).toISOString(),
    );
  });
});

describe("categories", () => {
  it("is admin-only", async () => {
    const cookie = await staffCookie("staff");
    expect((await send("/api/admin/categories", { cookie })).status).toBe(403);
    expect(
      (await send("/api/admin/categories", { method: "POST", cookie, body: { labelSv: "Soffor" } }))
        .status,
    ).toBe(403);
  });

  it("creates, renames and deactivates", async () => {
    const cookie = await staffCookie("admin");
    t.db.delete(categories).run();
    const created = (await (
      await send("/api/admin/categories", {
        method: "POST",
        cookie,
        body: { labelSv: "Soffor" },
      })
    ).json()) as AdminCategory;
    expect(created).toEqual({ id: created.id, labelSv: "Soffor", active: true });
    expect(
      (await send("/api/admin/categories", { method: "POST", cookie, body: { labelSv: "Soffor" } }))
        .status,
    ).toBe(409);

    const updated = await send(`/api/admin/categories/${created.id}`, {
      method: "PATCH",
      cookie,
      body: { labelSv: "Soffor & fåtöljer", active: false },
    });
    expect(await updated.json()).toMatchObject({ labelSv: "Soffor & fåtöljer", active: false });
    // Inactive categories disappear from the public form.
    expect(await (await send("/api/categories")).json()).toEqual({ categories: [] });
    expect(
      (await send("/api/admin/categories/999", { method: "PATCH", cookie, body: { active: true } }))
        .status,
    ).toBe(404);
  });
});

describe("notifications", () => {
  it("counts by status and lists unseen requests", async () => {
    const cookie = await staffCookie();
    seedRequest({ status: "new", name: "Ny 1" });
    seedRequest({ status: "new", name: "Ny 2", seenAt: new Date().toISOString() });
    seedRequest({ status: "accepted" });
    seedRequest({ status: "unverified" });
    const summary = (await (
      await send("/api/admin/notifications/summary", { cookie })
    ).json()) as NotificationSummary;
    expect(summary.counts).toEqual({
      new: 3, // includes the unverified one, listed under "new"
      in_progress: 0,
      accepted: 1,
      on_the_way: 0,
      declined: 0,
      cancelled: 0,
    });
    expect(summary.unseenCount).toBe(1);
    expect(summary.latestUnseen.map((r) => r.name)).toEqual(["Ny 1"]);
  });

  it("streams the summary, then pushes verified requests as they happen", async () => {
    const cookie = await staffCookie();
    const res = await send("/api/admin/notifications/stream", { cookie });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (needle: string) => {
      while (!buffer.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${needle}`);
        buffer += decoder.decode(value);
      }
    };

    await readUntil("event: summary");
    expect(buffer).toContain('"unseenCount":0');

    // A fresh submission is announced (for the lists) but not as a new, unseen request.
    const pending = seedRequest({ status: "unverified", verifiedAt: null });
    t.events.emit("request.submitted", { id: pending });
    await readUntil("event: submitted");
    await readUntil('"new":1');
    expect(buffer).toContain(`"id":"${pending}"`);
    expect(buffer).not.toContain('"unseenCount":1');

    const id = seedRequest({ name: "Live Person" });
    t.events.emit("request.verified", { id });
    await readUntil("event: verified");
    await readUntil('"unseenCount":1');
    expect(buffer).toContain('"name":"Live Person"');

    await reader.cancel();
    // Listeners are removed when the client disconnects.
    await new Promise((r) => setTimeout(r, 10));
    expect(t.events.listenerCount("request.verified")).toBe(0);
    expect(t.events.listenerCount("request.submitted")).toBe(0);
  });
});

describe("manual delete", () => {
  it("erases the request, its photos and history at once and updates the counts", async () => {
    const cookie = await staffCookie();
    const id = seedRequest({ photos: 2 });
    const keys = t.db
      .select()
      .from(images)
      .where(eq(images.requestId, id))
      .all()
      .map((i) => i.s3Key);
    await send(`/api/admin/requests/${id}/notes`, { method: "POST", cookie, body: { note: "x" } });
    const changed: string[] = [];
    t.events.on("request.changed", (e) => changed.push(e.id));

    const res = await send(`/api/admin/requests/${id}`, { method: "DELETE", cookie });
    expect(res.status).toBe(200);
    expect(t.db.select().from(requests).where(eq(requests.id, id)).get()).toBeUndefined();
    expect(t.db.select().from(requestEvents).all()).toHaveLength(0);
    for (const key of keys) expect(t.storage.objects.has(key)).toBe(false);
    expect(changed).toEqual([id]);

    expect((await send(`/api/admin/requests/${id}`, { method: "DELETE", cookie })).status).toBe(
      404,
    );
    const summary = (await (
      await send("/api/admin/notifications/summary", { cookie })
    ).json()) as NotificationSummary;
    expect(summary.counts.new).toBe(0);
  });

  it("requires a session and the CSRF header, and can delete unverified requests", async () => {
    const id = seedRequest();
    expect((await send(`/api/admin/requests/${id}`, { method: "DELETE" })).status).toBe(401);
    const cookie = await staffCookie();
    expect(
      (await send(`/api/admin/requests/${id}`, { method: "DELETE", cookie, csrf: false })).status,
    ).toBe(403);
    const spam = seedRequest({ status: "unverified" });
    expect((await send(`/api/admin/requests/${spam}`, { method: "DELETE", cookie })).status).toBe(
      200,
    );
    expect(t.db.select().from(requests).all()).toHaveLength(1);
  });
});
