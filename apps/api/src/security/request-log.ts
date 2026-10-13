import type { MiddlewareHandler } from "hono";

/**
 * Status-page tokens grant access to a request (view, cancel), so they must never reach the
 * logs. Every route that carries one in its path goes through here.
 */
export const redactPath = (path: string) => path.replace(/(\/by-token\/)[^/?#]+/, "$1[token]");

/** One line per request: method, redacted path, status and duration. No query strings. */
export function requestLog(log: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    log(`${c.req.method} ${redactPath(c.req.path)} ${c.res.status} ${ms}ms`);
  };
}
