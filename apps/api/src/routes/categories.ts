import { compareSv } from "@hamtning/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { categories } from "../db/schema.js";

export const categoryRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { db } = c.get("deps");
  const rows = db
    .select({ id: categories.id, label: categories.labelSv })
    .from(categories)
    .where(eq(categories.active, true))
    .all()
    // Sorted here, not in SQL: SQLite's ordering puts Ä before Å.
    .sort((a, b) => compareSv(a.label, b.label));
  // Changes rarely; let browsers reuse it for a few minutes.
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ categories: rows });
});
