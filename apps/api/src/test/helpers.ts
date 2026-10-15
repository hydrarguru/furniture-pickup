import { addDays, type GeoLocation, stockholmToday } from "@hamtning/shared";
import { ulid } from "ulid";
import { createApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { images, items, requests, timeWindows } from "../db/schema.js";
import { loadEnv } from "../env.js";
import { AppEventBus } from "../events.js";
import type { Address, Geocoder } from "../geo/geocoder.js";
import type { Mail, Mailer } from "../mailer/index.js";
import type { TurnstileVerifier } from "../security/turnstile.js";
import { MemoryStorage } from "../storage/memory.js";

export class RecordingMailer implements Mailer {
  readonly sent: Mail[] = [];
  fail = false;
  async send(mail: Mail) {
    if (this.fail) throw new Error("mail provider down");
    this.sent.push(mail);
  }
}

export class FakeTurnstile implements TurnstileVerifier {
  pass = true;
  async verify() {
    return this.pass;
  }
}

export class FakeGeocoder implements Geocoder {
  result: GeoLocation | null = { lat: 57.7, lon: 11.97, precision: "address" };
  fail = false;
  readonly calls: Address[] = [];
  async locate(address: Address) {
    this.calls.push(address);
    if (this.fail) throw new Error("geocoder down");
    return this.result;
  }
}

/** A fully wired app on an in-memory database with fakes for every external service. */
export function createTestApp() {
  const env = loadEnv({ NODE_ENV: "test", APP_ORIGIN: "https://hamta.test" });
  const { sqlite, db } = openDatabase(":memory:");
  runMigrations(db);
  const deps = {
    env,
    db,
    storage: new MemoryStorage(),
    mailer: new RecordingMailer(),
    turnstile: new FakeTurnstile(),
    geocoder: new FakeGeocoder(),
    events: new AppEventBus(),
  };
  return { ...deps, sqlite, app: createApp(deps) };
}

export type TestApp = ReturnType<typeof createTestApp>;

/** Inserts a request directly, with one item, `photos` uploaded photos and one time window. */
export function seedRequest(
  t: { db: TestApp["db"]; storage: MemoryStorage },
  o: Partial<typeof requests.$inferInsert> & { photos?: number; itemTitle?: string } = {},
) {
  const id = o.id ?? ulid();
  const now = o.createdAt ?? new Date().toISOString();
  const { photos = 1, itemTitle = "Soffa", ...fields } = o;
  t.db
    .insert(requests)
    .values({
      id,
      status: "new",
      name: "Anna Andersson",
      email: "anna@example.se",
      phone: "+46701234567",
      street: "Storgatan 1",
      postcode: "41250",
      city: "Göteborg",
      consentAt: now,
      tokenHash: ulid(),
      tokenExpires: now,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
      ...fields,
    })
    .run();
  t.db.insert(items).values({ id: ulid(), requestId: id, title: itemTitle, quantity: 1 }).run();
  for (let i = 0; i < photos; i++) {
    const key = `uploads/${ulid()}.jpg`;
    t.storage.put(key, 100);
    t.db
      .insert(images)
      .values({
        id: ulid(),
        requestId: id,
        s3Key: key,
        contentType: "image/jpeg",
        sizeBytes: 100,
        position: i,
      })
      .run();
  }
  t.db
    .insert(timeWindows)
    .values({ id: ulid(), requestId: id, date: addDays(stockholmToday(), 7), part: "forenoon" })
    .run();
  return id;
}
