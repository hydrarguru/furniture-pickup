import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A copy of the migrations folder containing only the first `count` migrations. */
function migrationsUpTo(count: number) {
  const dir = mkdtempSync(join(tmpdir(), "migrations-"));
  dirs.push(dir);
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("migrations", () => {
  it("keep every request's items, photos, windows and history when a migration rebuilds requests", () => {
    const { sqlite, db } = openDatabase(":memory:");
    // The schema as it was before the on_the_way status (migrations 0000 and 0001).
    migrate(db, { migrationsFolder: migrationsUpTo(2) });
    const now = new Date().toISOString();
    sqlite.exec(`
      INSERT INTO requests (id,status,name,email,phone,street,postcode,city,consent_at,token_hash,token_expires,created_at,updated_at)
        VALUES ('r1','accepted','A','a@b.se','+4670','S 1','41250','G','${now}','h','${now}','${now}','${now}');
      INSERT INTO items (id,request_id,title,quantity) VALUES ('i1','r1','Soffa',1);
      INSERT INTO images (id,request_id,s3_key,content_type,size_bytes) VALUES ('p1','r1','uploads/x.jpg','image/jpeg',1);
      INSERT INTO time_windows (id,request_id,date,part) VALUES ('w1','r1','2026-11-01','forenoon');
      INSERT INTO request_events (id,request_id,type,created_at) VALUES ('e1','r1','note','${now}');
    `);

    runMigrations(db);

    const count = (table: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(["requests", "items", "images", "time_windows", "request_events"].map(count)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    // The new status is accepted, foreign keys are back on, and nothing dangles.
    sqlite.prepare("UPDATE requests SET status = 'on_the_way' WHERE id = 'r1'").run();
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    // Cascades still work after the rebuild.
    sqlite.prepare("DELETE FROM requests WHERE id = 'r1'").run();
    expect(count("items")).toBe(0);
  });
});
