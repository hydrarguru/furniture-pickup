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
const { sqlite, db } = openDatabase(env.DATABASE_PATH);
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

const mailer = createMailer(env);
// Don't block startup on the mail provider; a failure here only means mail will fail too.
mailer
  .verify?.()
  .then(() => console.log(`Mail: ${env.MAILER} ready`))
  .catch((err) => console.error(`Mail: cannot reach ${env.SMTP_HOST}`, err));

const events = new AppEventBus();
const app = createApp({
  env,
  db,
  mailer,
  storage,
  turnstile: new CloudflareTurnstile(env.TURNSTILE_SECRET),
  events,
});
const stopJobs = startJobs({ db, storage, events });
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`API listening on http://127.0.0.1:${info.port}`);
});

/**
 * On restart (systemd sends SIGTERM): stop taking requests, let running ones finish, then
 * close the database cleanly. Admin live-update streams never finish on their own, so they
 * are cut after a short grace period; the browser reconnects to the new process.
 */
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  stopJobs();
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
  setTimeout(() => {
    if ("closeAllConnections" in server) server.closeAllConnections();
  }, 3000).unref();
  setTimeout(() => {
    console.error("Shutdown timed out");
    process.exit(1);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
