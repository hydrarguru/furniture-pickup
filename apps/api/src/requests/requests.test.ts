import { addDays, type RequestStatusView, stockholmToday } from "@hamtning/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../auth/passwords.js";
import {
  cancellations,
  categories,
  employees,
  images,
  items,
  pendingUploads,
  requestEvents,
  requests,
  timeWindows,
} from "../db/schema.js";
import { hashToken } from "../security/tokens.js";
import { createUploadSlots } from "../storage/uploads.js";
import { createTestApp } from "../test/helpers.js";
import { statusTimeline } from "./service.js";

let t: ReturnType<typeof createTestApp>;
let ipCounter = 0;

beforeEach(() => {
  t = createTestApp();
});

/** Presigns and "uploads" n photos, returning their keys. */
async function uploadedKeys(n = 1) {
  const slots = await createUploadSlots(
    t,
    Array.from({ length: n }, () => ({ contentType: "image/jpeg", size: 1000 })),
    null,
  );
  for (const s of slots) t.storage.put(s.key, 1000, "image/jpeg");
  return slots.map((s) => s.key);
}

async function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Anna Andersson",
    email: "anna@example.se",
    phone: "070-123 45 67",
    street: "Storgatan 1",
    postcode: "412 50",
    city: "Göteborg",
    items: [
      { title: "Soffa", quantity: 1 },
      { title: "Stolar", quantity: 4 },
    ],
    imageKeys: await uploadedKeys(2),
    timeWindows: [{ date: addDays(stockholmToday(), 7), part: "forenoon" }],
    consent: true,
    turnstileToken: "tok",
    ...overrides,
  };
}

const json = (body: unknown, ip = `198.51.100.${++ipCounter % 250}`) => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-real-ip": ip },
  body: JSON.stringify(body),
});

const submit = async (body: unknown, ip?: string) => t.app.request("/api/requests", json(body, ip));

/** The token only ever leaves the server inside the verification email. */
function tokenFromMail(index = -1) {
  const mail = t.mailer.sent.at(index);
  const match = mail?.text.match(/\/bekrafta\/([A-Za-z0-9_-]{43})/);
  if (!match?.[1]) throw new Error("no token in mail");
  return match[1];
}

const verify = (token: string) => t.app.request("/api/requests/verify", json({ token }));
const status = (token: string) => t.app.request(`/api/requests/by-token/${token}`);
const cancel = (token: string, reason = "Har sålt soffan själv.") =>
  t.app.request(`/api/requests/by-token/${token}/cancel`, json({ reason }));

describe("POST /api/requests", () => {
  it("stores the request, its items, photos and windows, and mails a verification link", async () => {
    const body = await validBody();
    const res = await submit(body);
    expect(res.status).toBe(201);
    const resBody = await res.json();
    expect(resBody).toEqual({ ok: true }); // no id or token in the response

    const [req] = t.db.select().from(requests).all();
    expect(req).toMatchObject({
      status: "unverified",
      email: "anna@example.se",
      phone: "+46701234567",
      postcode: "41250",
      floor: null,
      hasElevator: null,
    });
    expect(
      t.db
        .select()
        .from(items)
        .all()
        .map((i) => [i.title, i.quantity]),
    ).toEqual([
      ["Soffa", 1],
      ["Stolar", 4],
    ]);
    const imgs = t.db.select().from(images).all();
    expect(imgs.map((i) => [i.s3Key, i.position])).toEqual([
      [body.imageKeys[0], 0],
      [body.imageKeys[1], 1],
    ]);
    expect(t.db.select().from(timeWindows).all()).toHaveLength(1);
    // Attached uploads are no longer "pending", so the orphan cleanup leaves them alone.
    expect(t.db.select().from(pendingUploads).all()).toHaveLength(0);

    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]?.to).toBe("anna@example.se");
    expect(t.mailer.sent[0]?.subject).toBe("Bekräfta din förfrågan om hämtning");
    const token = tokenFromMail();
    expect(t.mailer.sent[0]?.text).toContain(`https://hamta.test/bekrafta/${token}`);
    // Only the hash is stored.
    expect(req?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(req)).not.toContain(token);
  });

  it("still stores the request when the mail provider fails", async () => {
    t.mailer.fail = true;
    const res = await submit(await validBody());
    expect(res.status).toBe(201);
    expect(t.db.select().from(requests).all()).toHaveLength(1);
  });

  it("rejects a failed Turnstile check without storing anything", async () => {
    t.turnstile.pass = false;
    const res = await submit(await validBody());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "turnstile_failed" });
    expect(t.db.select().from(requests).all()).toHaveLength(0);
    expect(t.mailer.sent).toHaveLength(0);
  });

  it("rejects a request without photos", async () => {
    const res = await submit(await validBody({ imageKeys: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects photo keys that were not issued or not uploaded", async () => {
    const [issuedButMissing] = await createUploadSlots(
      t,
      [{ contentType: "image/jpeg", size: 1 }],
      null,
    );
    for (const [keys, reason] of [
      [["uploads/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg"], "unknown_key"],
      [[issuedButMissing?.key], "missing"],
    ] as const) {
      const res = await submit(await validBody({ imageKeys: keys }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_images", reason });
    }
    expect(t.db.select().from(requests).all()).toHaveLength(0);
  });

  it("does not let the same uploaded photo be attached to two requests", async () => {
    const keys = await uploadedKeys(1);
    expect((await submit(await validBody({ imageKeys: keys }))).status).toBe(201);
    const res = await submit(await validBody({ imageKeys: keys, email: "other@example.se" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_images", reason: "unknown_key" });
  });

  it("validates category ids against the database", async () => {
    t.db.insert(categories).values({ id: 1, labelSv: "Soffor" }).run();
    const ok = await submit(await validBody({ items: [{ title: "Soffa", categoryId: 1 }] }));
    expect(ok.status).toBe(201);
    const bad = await submit(
      await validBody({ items: [{ title: "Soffa", categoryId: 99 }], email: "b@example.se" }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_category" });
  });

  it("allows 3 requests per email per hour", async () => {
    for (let i = 0; i < 3; i++) expect((await submit(await validBody())).status).toBe(201);
    const res = await submit(await validBody());
    expect(res.status).toBe(429);
    expect(t.db.select().from(requests).all()).toHaveLength(3);
    // Another address is unaffected.
    expect((await submit(await validBody({ email: "b@example.se" }))).status).toBe(201);
  });

  it("limits submissions per IP address", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 5; i++) {
      const res = await submit(await validBody({ email: `p${i}@example.se` }), ip);
      expect(res.status).toBe(201);
    }
    const res = await submit(await validBody({ email: "p9@example.se" }), ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("verification", () => {
  it("verifies once, records the event and notifies listeners; repeats are harmless", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    const verified: string[] = [];
    t.events.on("request.verified", ({ id }) => verified.push(id));

    const res = await verify(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "new" });
    const [req] = t.db.select().from(requests).all();
    expect(req?.status).toBe("new");
    expect(req?.verifiedAt).not.toBeNull();
    expect(verified).toEqual([req?.id]);
    expect(t.db.select().from(requestEvents).all()).toMatchObject([
      { type: "status_change", fromStatus: "unverified", toStatus: "new" },
    ]);

    const again = await verify(token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "new" });
    expect(verified).toHaveLength(1);
    expect(t.db.select().from(requestEvents).all()).toHaveLength(1);
  });

  it("refuses an expired link", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    t.db
      .update(requests)
      .set({ tokenExpires: new Date(Date.now() - 1000).toISOString() })
      .run();
    const res = await verify(token);
    expect(res.status).toBe(410);
    expect(t.db.select().from(requests).get()?.status).toBe("unverified");
  });

  it("returns 404 for unknown tokens and 400 for malformed ones", async () => {
    expect((await verify("A".repeat(43))).status).toBe(404);
    expect((await verify("short")).status).toBe(400);
    expect((await status("not-a-token")).status).toBe(400);
  });
});

describe("status page", () => {
  it("shows the requester's view without personal or internal fields", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    await verify(token);
    const res = await status(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = (await res.json()) as RequestStatusView;
    expect(view).toMatchObject({
      status: "new",
      items: [
        { title: "Soffa", quantity: 1 },
        { title: "Stolar", quantity: 4 },
      ],
      imageCount: 2,
      timeWindows: [{ part: "forenoon", fromTime: null, toTime: null }],
      canCancel: true,
    });
    // Waiting for staff: deleted 7 days after the last activity (here: verification).
    const verifiedAt = t.db.select().from(requests).get()?.updatedAt as string;
    expect(
      (new Date(view.deleteAfter as string).getTime() - new Date(verifiedAt).getTime()) / 864e5,
    ).toBe(7);
    const raw = JSON.stringify(view);
    for (const secret of ["anna@example.se", "+46701234567", "Storgatan", "tokenHash", token])
      expect(raw).not.toContain(secret);
  });

  it("deletes the request with its photos and keeps only the reason for staff", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    await verify(token);
    const keys = t.db.select({ key: images.s3Key }).from(images).all();
    const cancelled: { id: string; visibleToStaff: boolean }[] = [];
    t.events.on("request.cancelled", (e) => cancelled.push(e));

    const res = await cancel(token, "  Har sålt soffan själv.  ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(t.db.select().from(requests).all()).toHaveLength(0);
    for (const table of [items, images, timeWindows, requestEvents])
      expect(t.db.select().from(table).all()).toHaveLength(0);
    for (const { key } of keys) expect(t.storage.objects.has(key)).toBe(false);

    const [log, ...rest] = t.db.select().from(cancellations).all();
    expect(rest).toHaveLength(0);
    expect(log).toMatchObject({ reason: "Har sålt soffan själv.", items: "Soffa, 4 × Stolar" });
    // No personal data in the log.
    for (const secret of ["Anna", "anna@example.se", "+46701234567", "Storgatan"])
      expect(JSON.stringify(log)).not.toContain(secret);
    expect(cancelled).toEqual([{ id: log?.requestId, visibleToStaff: true }]);

    expect((await status(token)).status).toBe(404);
    expect((await cancel(token)).status).toBe(404);
  });

  it("requires a reason", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    await verify(token);
    expect((await cancel(token, " ")).status).toBe(400);
    expect((await cancel(token, "x".repeat(501))).status).toBe(400);
    expect(t.db.select().from(requests).all()).toHaveLength(1);
  });

  it("deletes an unverified request without logging it, since staff never saw it", async () => {
    await submit(await validBody());
    expect((await cancel(tokenFromMail())).status).toBe(200);
    expect(t.db.select().from(requests).all()).toHaveLength(0);
    expect(t.db.select().from(cancellations).all()).toHaveLength(0);
  });

  it("refuses once staff have started on the request", async () => {
    for (const s of ["in_progress", "accepted", "on_the_way", "declined", "cancelled"] as const) {
      t = createTestApp();
      await submit(await validBody());
      const token = tokenFromMail();
      t.db.update(requests).set({ status: s }).run();
      const view = (await (await status(token)).json()) as RequestStatusView;
      expect(view.canCancel).toBe(false);
      expect((await cancel(token)).status).toBe(409);
      expect(t.db.select().from(requests).all()).toHaveLength(1);
    }
    expect((await cancel("B".repeat(43))).status).toBe(404);
  });

  it("shows on the way to the customer", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    await verify(token);
    t.db
      .update(requests)
      .set({
        status: "on_the_way",
        confirmedStart: "2026-10-20T07:00:00.000Z",
        confirmedEnd: "2026-10-20T09:00:00.000Z",
        closedAt: "2026-10-20T09:00:00.000Z",
      })
      .run();
    const view = (await (await status(token)).json()) as RequestStatusView;
    expect(view).toMatchObject({
      status: "on_the_way",
      confirmedStart: "2026-10-20T07:00:00.000Z",
      canCancel: false,
    });
  });
});

describe("status timeline", () => {
  const at = (n: number) => `2026-10-${String(10 + n).padStart(2, "0")}T08:00:00.000Z`;

  it("lists each step towards the current status", () => {
    expect(
      statusTimeline([
        { toStatus: "new", at: at(1) },
        { toStatus: "in_progress", at: at(2) },
        { toStatus: "accepted", at: at(3) },
      ]),
    ).toEqual([
      { status: "new", at: at(1) },
      { status: "in_progress", at: at(2) },
      { status: "accepted", at: at(3) },
    ]);
  });

  it("drops later steps when staff go back, and keeps the latest time", () => {
    expect(
      statusTimeline([
        { toStatus: "new", at: at(1) },
        { toStatus: "in_progress", at: at(2) },
        { toStatus: "accepted", at: at(3) },
        { toStatus: "in_progress", at: at(4) },
      ]),
    ).toEqual([
      { status: "new", at: at(1) },
      { status: "in_progress", at: at(4) },
    ]);
  });

  it("shows a rescheduled pickup once, at the time it was last confirmed", () => {
    expect(
      statusTimeline([
        { toStatus: "new", at: at(1) },
        { toStatus: "accepted", at: at(2) },
        { toStatus: "accepted", at: at(5) },
      ]),
    ).toEqual([
      { status: "new", at: at(1) },
      { status: "accepted", at: at(5) },
    ]);
  });

  it("is built from the real history without exposing staff notes or names", async () => {
    await submit(await validBody());
    const token = tokenFromMail();
    await verify(token);

    t.db
      .insert(employees)
      .values({
        id: "e1",
        email: "sam@butik.se",
        name: "Sam Staff",
        role: "staff",
        passwordHash: await hashPassword("pw"),
        createdAt: new Date().toISOString(),
      })
      .run();
    const login = await t.app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "fetch" },
      body: JSON.stringify({ email: "sam@butik.se", password: "pw" }),
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const id = t.db.select().from(requests).get()?.id as string;
    const staff = (path: string, method: string, body: unknown) =>
      t.app.request(path, {
        method,
        headers: { "content-type": "application/json", "x-requested-with": "fetch", cookie },
        body: JSON.stringify(body),
      });
    await staff(`/api/admin/requests/${id}/status`, "PATCH", { status: "in_progress" });
    await staff(`/api/admin/requests/${id}/notes`, "POST", { note: "Hemlig intern anteckning" });
    await staff(`/api/admin/requests/${id}/status`, "PATCH", {
      status: "accepted",
      confirmed: { date: addDays(stockholmToday(), 8), fromTime: "10:00", toTime: "12:00" },
    });

    const view = (await (await status(token)).json()) as RequestStatusView;
    expect(view.timeline.map((s) => s.status)).toEqual(["new", "in_progress", "accepted"]);
    for (const step of view.timeline) expect(Date.parse(step.at)).not.toBeNaN();
    expect(view.timeline[0]?.at).toBe(t.db.select().from(requests).get()?.verifiedAt);
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("Hemlig");
    expect(raw).not.toContain("Sam Staff");
  });

  it("is empty until the request is confirmed", async () => {
    await submit(await validBody());
    const view = (await (await status(tokenFromMail())).json()) as RequestStatusView;
    expect(view.timeline).toEqual([]);
  });
});
