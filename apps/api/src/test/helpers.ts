import { createApp } from "../app.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { loadEnv } from "../env.js";
import { AppEventBus } from "../events.js";
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
    events: new AppEventBus(),
  };
  return { ...deps, sqlite, app: createApp(deps) };
}
