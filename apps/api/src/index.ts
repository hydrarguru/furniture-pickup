import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { AppEventBus } from "./events.js";
import { startJobs } from "./jobs/index.js";
import { createMailer } from "./mailer/index.js";
import { CloudflareTurnstile } from "./security/turnstile.js";
import { S3Storage } from "./storage/s3.js";

const env = loadEnv();
const { db } = openDatabase(env.DATABASE_PATH);
runMigrations(db);

const storage = new S3Storage({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

if (env.NODE_ENV === "production" && env.MAILER === "console") {
  // Verification links (which grant access to a request) would end up in the logs.
  console.warn("WARNING: MAILER=console in production; verification emails are only logged.");
}

const app = createApp({
  env,
  db,
  mailer: createMailer(env),
  storage,
  turnstile: new CloudflareTurnstile(env.TURNSTILE_SECRET),
  events: new AppEventBus(),
});
startJobs({ db, storage });
serve({ fetch: app.fetch, port: env.PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`API listening on http://127.0.0.1:${info.port}`);
});
