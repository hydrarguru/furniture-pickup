import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { categories } from "../db/schema.js";

export const categoryRoutes = new Hono<AppEnv>().get("/", (c) => {
  const { db } = c.get("deps");
  const rows = db
    .select({ id: categories.id, label: categories.labelSv })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.labelSv))
    .all();
  // Changes rarely; let browsers reuse it for a few minutes.
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ categories: rows });
});
