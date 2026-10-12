import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { images, pendingUploads, requests } from "../db/schema.js";
import { loadEnv } from "../env.js";
import { ConsoleMailer } from "../mailer/index.js";
import { MemoryStorage } from "./memory.js";
import { S3Storage } from "./s3.js";
import { checkUploadedImages, cleanupExpiredUploads, createUploadSlots } from "./uploads.js";

let db: ReturnType<typeof openDatabase>["db"];
let storage: MemoryStorage;

beforeEach(() => {
  ({ db } = openDatabase(":memory:"));
  runMigrations(db);
  storage = new MemoryStorage();
});

const jpeg = (size = 1000) => ({ contentType: "image/jpeg", size });

describe("POST /api/uploads/presign", () => {
  const post = (body: unknown) => {
    const app = createApp({
      env: loadEnv({ NODE_ENV: "test" }),
      db,
      mailer: new ConsoleMailer(),
      storage,
    });
    return app.request("/api/uploads/presign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(body),
    });
  };

  it("issues one signed slot per file and records them as pending", async () => {
    const res = await post({ files: [jpeg(), { contentType: "image/png", size: 5 }] });
    expect(res.status).toBe(200);
    const { uploads } = (await res.json()) as { uploads: { key: string; url: string }[] };
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.key).toMatch(/^uploads\/[0-9A-Z]{26}\.jpg$/);
    expect(uploads[1]?.key).toMatch(/\.png$/);
    expect(db.select().from(pendingUploads).all()).toHaveLength(2);
    // The client IP is stored hashed, never raw.
    expect(db.select().from(pendingUploads).get()?.ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ["no files", { files: [] }],
    ["too many files", { files: Array.from({ length: 9 }, () => jpeg()) }],
    ["oversized file", { files: [jpeg(10 * 1024 * 1024 + 1)] }],
    ["gif", { files: [{ contentType: "image/gif", size: 10 }] }],
    ["svg", { files: [{ contentType: "image/svg+xml", size: 10 }] }],
  ])("rejects %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(db.select().from(pendingUploads).all()).toHaveLength(0);
  });
});

describe("checkUploadedImages", () => {
  it("accepts issued keys that exist with a valid type and size", async () => {
    const [slot] = await createUploadSlots({ db, storage }, [jpeg()], null);
    storage.put(slot?.key as string, 1000);
    const r = await checkUploadedImages({ db, storage }, [slot?.key as string]);
    expect(r).toEqual({
      ok: true,
      files: [{ key: slot?.key, contentType: "image/jpeg", size: 1000 }],
    });
  });

  it("rejects keys we never issued", async () => {
    const key = "uploads/01ARZ3NDEKTSV4RRFFQ69G5FAV.jpg";
    storage.put(key, 10);
    expect(await checkUploadedImages({ db, storage }, [key])).toMatchObject({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("rejects path-traversal style keys", async () => {
    expect(await checkUploadedImages({ db, storage }, ["../etc/passwd"])).toMatchObject({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("rejects issued keys that were never uploaded", async () => {
    const [slot] = await createUploadSlots({ db, storage }, [jpeg()], null);
    expect(await checkUploadedImages({ db, storage }, [slot?.key as string])).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects wrong content type and oversized objects as stored", async () => {
    const [a, b] = await createUploadSlots({ db, storage }, [jpeg(), jpeg()], null);
    storage.put(a?.key as string, 10, "text/html");
    storage.put(b?.key as string, 11 * 1024 * 1024);
    expect(await checkUploadedImages({ db, storage }, [a?.key as string])).toMatchObject({
      reason: "bad_type",
    });
    expect(await checkUploadedImages({ db, storage }, [b?.key as string])).toMatchObject({
      reason: "too_large",
    });
  });

  it("rejects expired slots", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const [slot] = await createUploadSlots({ db, storage }, [jpeg()], null, past);
    storage.put(slot?.key as string, 10);
    expect(await checkUploadedImages({ db, storage }, [slot?.key as string])).toMatchObject({
      reason: "unknown_key",
    });
  });
});

describe("cleanupExpiredUploads", () => {
  it("removes expired orphans from storage and the table, keeps fresh ones", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const [old] = await createUploadSlots({ db, storage }, [jpeg()], null, past);
    const [fresh] = await createUploadSlots({ db, storage }, [jpeg()], null);
    storage.put(old?.key as string, 10);
    storage.put(fresh?.key as string, 10);

    expect(await cleanupExpiredUploads({ db, storage })).toEqual({ removed: 1 });
    expect(storage.objects.has(old?.key as string)).toBe(false);
    expect(storage.objects.has(fresh?.key as string)).toBe(true);
    expect(
      db
        .select()
        .from(pendingUploads)
        .all()
        .map((r) => r.s3Key),
    ).toEqual([fresh?.key]);
  });

  it("never deletes an object that is attached to a request", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const [slot] = await createUploadSlots({ db, storage }, [jpeg()], null, past);
    const key = slot?.key as string;
    storage.put(key, 10);
    const now = new Date().toISOString();
    db.insert(requests)
      .values({
        id: "r1",
        name: "A",
        email: "a@b.se",
        phone: "+46701",
        street: "S",
        postcode: "41250",
        city: "G",
        consentAt: now,
        tokenHash: "h",
        tokenExpires: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(images)
      .values({ id: "i1", requestId: "r1", s3Key: key, contentType: "image/jpeg", sizeBytes: 10 })
      .run();

    expect(await cleanupExpiredUploads({ db, storage })).toEqual({ removed: 0 });
    expect(storage.objects.has(key)).toBe(true);
    expect(db.select().from(pendingUploads).all()).toHaveLength(0);
  });

  it("keeps the rows for a retry when storage deletion fails", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await createUploadSlots({ db, storage }, [jpeg()], null, past);
    storage.delete = async () => {
      throw new Error("garage down");
    };
    await expect(cleanupExpiredUploads({ db, storage })).rejects.toThrow("garage down");
    expect(db.select().from(pendingUploads).all()).toHaveLength(1);
  });
});

describe("S3Storage presigning", () => {
  it("signs against the public endpoint and binds content-type and length", async () => {
    const s3 = new S3Storage({
      endpoint: "http://127.0.0.1:3900",
      publicEndpoint: "https://s3.example.se",
      region: "garage",
      bucket: "pickup-images",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    const url = new URL(
      await s3.presignUpload({ key: "uploads/x.jpg", contentType: "image/jpeg", size: 1234 }, 900),
    );
    expect(url.origin).toBe("https://s3.example.se");
    expect(url.pathname).toBe("/pickup-images/uploads/x.jpg");
    const signed = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed).toContain("content-type");
    expect(signed).toContain("content-length");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});
