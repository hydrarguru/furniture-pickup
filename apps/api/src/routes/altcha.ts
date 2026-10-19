import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { RateLimiter, rateLimit } from "../security/rate-limit.js";

export function altchaRoutes() {
  const challengeLimit = new RateLimiter(60, 60 * 1000);

  return new Hono<AppEnv>().get("/challenge", rateLimit(challengeLimit), async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await c.get("deps").botCheck.challenge());
  });
}
