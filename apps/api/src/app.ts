import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import type { Mailer } from "./mailer/index.js";

export interface AppDeps {
  env: Env;
  db: Db;
  mailer: Mailer;
}

export type AppEnv = { Variables: { deps: AppDeps } };

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  if (deps.env.NODE_ENV !== "test") app.use(logger());
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.get("/health", (c) => {
    // S3 reachability is added with the storage milestone.
    const row = deps.db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    return c.json({ status: row?.ok === 1 ? "ok" : "degraded" });
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
