import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { loadEnv } from "./env.js";
import { createMailer } from "./mailer/index.js";

const env = loadEnv();
const { db } = openDatabase(env.DATABASE_PATH);
runMigrations(db);

const app = createApp({ env, db, mailer: createMailer(env) });
serve({ fetch: app.fetch, port: env.PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`API listening on http://127.0.0.1:${info.port}`);
});
