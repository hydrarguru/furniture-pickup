import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * The API listens on loopback only, behind nginx, which must set
 * `proxy_set_header X-Real-IP $remote_addr;` (overwriting anything the client sent).
 */
export function clientIp(context: Context): string | undefined {
  const real = context.req.header("x-real-ip")?.trim();
  if (real) return real;
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined; // e.g. app.request() in tests
  }
}
