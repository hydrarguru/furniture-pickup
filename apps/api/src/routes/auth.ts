import { loginSchema } from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthedEnv, requireEmployee } from "../auth/middleware.js";
import { DUMMY_HASH, verifyPassword } from "../auth/passwords.js";
import { endSession, startSession } from "../auth/sessions.js";
import { employees } from "../db/schema.js";
import { clientIp } from "../security/client-ip.js";
import { RateLimiter, rateLimit } from "../security/rate-limit.js";
import { onInvalid } from "./validation.js";

export function authRoutes() {
  const loginIpLimit = new RateLimiter(20, 15 * 60 * 1000);
  // Failed attempts per account: stops password guessing spread across many IPs.
  const failuresPerEmail = new RateLimiter(5, 15 * 60 * 1000);

  return new Hono<AuthedEnv>()
    .post(
      "/login",
      rateLimit(loginIpLimit),
      zValidator("json", loginSchema, onInvalid),
      async (context) => {
        const { db, env } = context.get("deps");
        const { email, password } = context.req.valid("json");

        const retryAfter = env.LOAD_TEST ? 0 : failuresPerEmail.blockedFor(email);
        if (retryAfter > 0) {
          context.header("Retry-After", String(retryAfter));
          return context.json({ error: "rate_limited" }, 429);
        }

        const employee = db.select().from(employees).where(eq(employees.email, email)).get();
        // Always run the slow hash so unknown emails take as long as wrong passwords.
        const ok = await verifyPassword(password, employee?.passwordHash ?? DUMMY_HASH);
        if (!employee || !ok) {
          failuresPerEmail.hit(email);
          console.warn(`[auth] failed login from ${clientIp(context) ?? "unknown"}`);
          return context.json({ error: "invalid_credentials" }, 401);
        }

        startSession(context, db, employee.id, env.NODE_ENV === "production");
        return context.json({
          id: employee.id,
          email: employee.email,
          name: employee.name,
          role: employee.role,
        });
      },
    )
    .post("/logout", (context) => {
      endSession(context, context.get("deps").db);
      return context.json({ ok: true });
    })
    .get("/me", requireEmployee, (context) => context.json(context.get("employee")));
}
