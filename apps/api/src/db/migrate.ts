import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client.js";

/** `../../drizzle` from src/db (dev, tests); `../drizzle` from the bundled dist/index.js. */
const migrationsFolder = ["../../drizzle", "../drizzle"]
  .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
  .find((p) => existsSync(p));

/**
 * Applies pending migrations with foreign-key enforcement switched off, as SQLite requires for
 * schema changes that rebuild a table. The `PRAGMA foreign_keys=OFF` that drizzle-kit writes into
 * such migrations does nothing, because the migrator runs inside a transaction. With enforcement
 * left on, dropping the old `requests` table would cascade and delete every item, photo and
 * history row. Afterwards all references are checked before enforcement is turned back on.
 */
export function runMigrations(db: Db) {
  if (!migrationsFolder) throw new Error("Migrations folder not found");
  const sqlite = db.$client;
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
    const broken = sqlite.pragma("foreign_key_check") as unknown[];
    if (broken.length > 0)
      throw new Error(`Migration left ${broken.length} broken foreign key reference(s)`);
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
