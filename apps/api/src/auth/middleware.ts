import type { Me } from "@hamtning/shared";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { readSession } from "./sessions.js";

export type AuthedEnv = AppEnv & { Variables: AppEnv["Variables"] & { employee: Me } };

/**
 * CSRF protection for cookie-authenticated routes. Browsers only send custom headers on
 * cross-site requests after a CORS preflight, which this API never grants, so requiring
 * one on every state-changing request blocks forged form posts. SameSite=Lax is the second layer.
 */
export const requireCsrfHeader: MiddlewareHandler = async (context, next) => {
  const safe = context.req.method === "GET" || context.req.method === "HEAD";
  if (!safe && context.req.header("x-requested-with") !== "fetch")
    return context.json({ error: "csrf_header_missing" }, 403);
  await next();
};

export const requireEmployee: MiddlewareHandler<AuthedEnv> = async (context, next) => {
  const { db, env } = context.get("deps");
  const employee = readSession(context, db, env.NODE_ENV === "production");
  if (!employee) return context.json({ error: "unauthenticated" }, 401);
  context.set("employee", employee);
  await next();
};

export const requireAdmin: MiddlewareHandler<AuthedEnv> = async (context, next) => {
  if (context.get("employee").role !== "admin") return context.json({ error: "forbidden" }, 403);
  await next();
};
