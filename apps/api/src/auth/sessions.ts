import type { Me } from "@hamtning/shared";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client.js";
import { employees, sessions } from "../db/schema.js";
import { hashToken, newToken } from "../security/tokens.js";

export const SESSION_COOKIE = "sid";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function writeCookie(context: Context, token: string, production: boolean) {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: "Lax",
    path: "/api",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function startSession(context: Context, db: Db, employeeId: string, production: boolean) {
  const token = newToken();
  db.insert(sessions)
    .values({
      idHash: hashToken(token),
      employeeId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .run();
  // Opportunistic cleanup; there are only a handful of employees.
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
  writeCookie(context, token, production);
}

/**
 * Resolves the session cookie to an employee. Sessions slide: once less than half the
 * lifetime remains, the expiry is pushed out again so active staff stay logged in.
 */
export function readSession(context: Context, db: Db, production: boolean): Me | null {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return null;
  const now = Date.now();
  const row = db
    .select({
      idHash: sessions.idHash,
      expiresAt: sessions.expiresAt,
      id: employees.id,
      username: employees.username,
      name: employees.name,
      role: employees.role,
    })
    .from(sessions)
    .innerJoin(employees, eq(employees.id, sessions.employeeId))
    .where(
      and(
        eq(sessions.idHash, hashToken(token)),
        gt(sessions.expiresAt, new Date(now).toISOString()),
      ),
    )
    .get();
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() - now < SESSION_TTL_MS / 2) {
    db.update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS).toISOString() })
      .where(eq(sessions.idHash, row.idHash))
      .run();
    writeCookie(context, token, production);
  }
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

export function endSession(context: Context, db: Db) {
  const token = getCookie(context, SESSION_COOKIE);
  if (token)
    db.delete(sessions)
      .where(eq(sessions.idHash, hashToken(token)))
      .run();
  deleteCookie(context, SESSION_COOKIE, { path: "/api" });
}

/** True while the session behind this token still exists (used by long-lived streams). */
export function sessionAlive(db: Db, token: string) {
  return Boolean(
    db
      .select({ id: sessions.idHash })
      .from(sessions)
      .where(
        and(
          eq(sessions.idHash, hashToken(token)),
          gt(sessions.expiresAt, new Date().toISOString()),
        ),
      )
      .get(),
  );
}
