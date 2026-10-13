import { describe, expect, it } from "vitest";
import { categories } from "./db/schema.js";
import { loadEnv } from "./env.js";
import { createTestApp as setup } from "./test/helpers.js";

describe("env", () => {
  it("treats empty values as unset", () => {
    expect(loadEnv({ NODE_ENV: "development", SESSION_SECRET: "" }).PORT).toBe(3000);
  });
  it("requires a real secret in production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow();
  });
});

describe("api skeleton", () => {
  it("reports health", async () => {
    const { app } = setup();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: true, storage: true });
  });

  it("reports degraded when storage is down", async () => {
    const { app, storage } = setup();
    storage.healthy = false;
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", storage: false });
  });

  it("lists only active categories in Swedish alphabetical order", async () => {
    const { app, db } = setup();
    db.delete(categories).run();
    db.insert(categories)
      .values([
        { labelSv: "Ölglas" },
        { labelSv: "Stolar" },
        { labelSv: "Äppelträ" },
        { labelSv: "Åkdon" },
        { labelSv: "bord" },
        { labelSv: "Gammalt", active: false },
      ])
      .run();
    const res = await app.request("/api/categories");
    const body = (await res.json()) as { categories: { label: string }[] };
    expect(body.categories.map((c) => c.label)).toEqual([
      "bord",
      "Stolar",
      "Åkdon",
      "Äppelträ",
      "Ölglas",
    ]);
  });

  it("comes with default categories for a second-hand store", async () => {
    const { app } = setup();
    const body = (await (await app.request("/api/categories")).json()) as {
      categories: { label: string }[];
    };
    const labels = body.categories.map((c) => c.label);
    expect(labels).toHaveLength(25);
    expect(labels).toContain("Vitvaror");
    expect(labels).toContain("Soffor och fåtöljer");
    expect(labels[0]).toBe("Barn och baby");
    expect(labels.at(-1)).toBe("Övrigt");
  });

  it("rejects request bodies over 1 MB", async () => {
    const { app } = setup();
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("returns json 404", async () => {
    const { app } = setup();
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
  });

  it("applies migrations with foreign keys on", () => {
    const { sqlite } = setup();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "requests",
        "items",
        "images",
        "time_windows",
        "categories",
        "employees",
      ]),
    );
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("cascades request deletion to children", () => {
    const { sqlite } = setup();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO requests (id,status,name,email,phone,street,postcode,city,consent_at,token_hash,token_expires,created_at,updated_at)
         VALUES ('r1','new','A','a@b.se','+46701','S 1','41250','G',?,'h',?,?,?)`,
      )
      .run(now, now, now, now);
    sqlite
      .prepare(
        "INSERT INTO images (id,request_id,s3_key,content_type,size_bytes) VALUES ('i1','r1','k','image/jpeg',1)",
      )
      .run();
    sqlite.prepare("DELETE FROM requests WHERE id='r1'").run();
    expect(sqlite.prepare("SELECT count(*) c FROM images").get()).toEqual({ c: 0 });
  });

  it("rejects invalid status values", () => {
    const { sqlite } = setup();
    const now = new Date().toISOString();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO requests (id,status,name,email,phone,street,postcode,city,consent_at,token_hash,token_expires,created_at,updated_at)
           VALUES ('r2','bogus','A','a@b.se','+46701','S 1','41250','G',?,'h',?,?,?)`,
        )
        .run(now, now, now, now),
    ).toThrow();
  });
});
