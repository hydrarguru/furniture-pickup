import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client.js";

/** `../../drizzle` from src/db (dev, tests); `../drizzle` from the bundled dist/index.js. */
const migrationsFolder = ["../../drizzle", "../drizzle"]
  .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
  .find((p) => existsSync(p));

export function runMigrations(db: Db) {
  if (!migrationsFolder) throw new Error("Migrations folder not found");
  migrate(db, { migrationsFolder });
}
