import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { requireCsrfHeader } from "./auth/middleware.js";
import type { Db } from "./db/client.js";
import type { Env } from "./env.js";
import type { AppEventBus } from "./events.js";
import type { Mailer } from "./mailer/index.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { categoryRoutes } from "./routes/categories.js";
import { requestRoutes } from "./routes/requests.js";
import { uploadRoutes } from "./routes/uploads.js";
import { requestLog } from "./security/request-log.js";
import type { TurnstileVerifier } from "./security/turnstile.js";
import type { Storage } from "./storage/index.js";

export interface AppDeps {
  env: Env;
  db: Db;
  mailer: Mailer;
  storage: Storage;
  turnstile: TurnstileVerifier;
  events: AppEventBus;
}

export type AppEnv = { Variables: { deps: AppDeps } };

export const MAX_BODY_BYTES = 1024 * 1024;

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");

  // Not hono/logger: it would write status-page tokens from the URL to the logs.
  if (deps.env.NODE_ENV !== "test") app.use(requestLog());
  app.use(secureHeaders());
  // Photos go straight to storage, so no API request needs more than this. (Nginx enforces it too.)
  app.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.get("/health", async (c) => {
    const row = deps.db.get<{ ok: number }>(sql`SELECT 1 AS ok`);
    const database = row?.ok === 1;
    const storage = await deps.storage.ping();
    return c.json(
      { status: database && storage ? "ok" : "degraded", database, storage },
      database && storage ? 200 : 503,
    );
  });

  // Cookie-authenticated routes need CSRF protection; the public routes use no cookies.
  app.use("/auth/*", requireCsrfHeader);
  app.use("/admin/*", requireCsrfHeader);
  app.route("/auth", authRoutes());
  app.route("/admin", adminRoutes());
  app.route("/categories", categoryRoutes);
  app.route("/requests", requestRoutes());
  app.route("/uploads", uploadRoutes());

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type AppType = ReturnType<typeof createApp>;
