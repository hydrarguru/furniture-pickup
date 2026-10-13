import type { MiddlewareHandler } from "hono";
import { clientIp } from "./client-ip.js";

/**
 * Fixed-window counter kept in memory. Good enough for a single API process;
 * nginx limit_req is the first line of defence.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit. Returns 0 when allowed, otherwise seconds until the window resets. */
  hit(key: string, now = Date.now()): number {
    if (this.hits.size > 10_000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    entry.count += 1;
    return entry.count > this.max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export function rateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (context, next) => {
    const retryAfter = limiter.hit(clientIp(context) ?? "unknown");
    if (retryAfter > 0) {
      context.header("Retry-After", String(retryAfter));
      return context.json({ error: "rate_limited" }, 429);
    }
    await next();
  };
}
