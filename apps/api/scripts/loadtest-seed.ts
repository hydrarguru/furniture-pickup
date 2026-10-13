// Fills a database for a load test (loadtest/run-local.sh): requests in every status, each with a
// status-page token, plus one admin. Writes the tokens and the admin login to a JSON file for k6.
//   DATABASE_PATH=/tmp/x.db tsx scripts/loadtest-seed.ts <out.json> [requests=500]
// Refuses to run on a database that already has requests, so it can't touch real data.
import { writeFileSync } from "node:fs";
import { addDays, stockholmToday } from "@hamtning/shared";
import { count } from "drizzle-orm";
import { hashPassword } from "../src/auth/passwords.js";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { employees, items, requests, timeWindows } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { newId } from "../src/ids.js";
import { hashToken, newToken } from "../src/security/tokens.js";

const [out, total = "500"] = process.argv.slice(2);
if (!out) throw new Error("usage: loadtest-seed.ts <out.json> [requests]");
const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("Not on a production database");
const { sqlite, db } = openDatabase(env.DATABASE_PATH);
runMigrations(db);
if ((db.select({ n: count() }).from(requests).get()?.n ?? 0) > 0)
  throw new Error(`${env.DATABASE_PATH} already has requests; use an empty database`);

const STATUSES = ["new", "new", "in_progress", "accepted", "declined"] as const;
const now = new Date().toISOString();
const tokens: string[] = [];
const ids: string[] = [];

db.transaction((tx) => {
  for (let i = 0; i < Number(total); i++) {
    const id = newId();
    const token = newToken();
    tx.insert(requests)
      .values({
        id,
        status: STATUSES[i % STATUSES.length],
        name: `Lasttest ${i}`,
        email: `lasttest${i}@example.se`,
        phone: "+46701234567",
        street: `Testgatan ${i}`,
        postcode: "41250",
        city: "Göteborg",
        consentAt: now,
        verifiedAt: now,
        tokenHash: hashToken(token),
        tokenExpires: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(items).values({ id: newId(), requestId: id, title: "Soffa", quantity: 1 }).run();
    tx.insert(timeWindows)
      .values({ id: newId(), requestId: id, date: addDays(stockholmToday(), 10), part: "forenoon" })
      .run();
    tokens.push(token);
    ids.push(id);
  }
});

const admin = { email: "lasttest-admin@example.se", password: newToken() };
db.insert(employees)
  .values({
    id: newId(),
    email: admin.email,
    name: "Lasttest Admin",
    role: "admin",
    passwordHash: await hashPassword(admin.password),
    createdAt: now,
  })
  .run();
sqlite.close();

writeFileSync(out, JSON.stringify({ tokens, requestIds: ids, admin }));
console.log(`Seeded ${tokens.length} requests and an admin into ${env.DATABASE_PATH}`);
