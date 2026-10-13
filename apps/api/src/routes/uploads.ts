import { presignRequestSchema } from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { clientIp } from "../security/client-ip.js";
import { RateLimiter, rateLimit } from "../security/rate-limit.js";
import { createUploadSlots, hashIp } from "../storage/uploads.js";
import { onInvalid } from "./validation.js";

export function uploadRoutes() {
  // A form needs at most 8 slots plus retries; 30 per 10 minutes leaves room for mistakes.
  const presignLimit = new RateLimiter(30, 10 * 60 * 1000);

  return new Hono<AppEnv>().post(
    "/presign",
    rateLimit(presignLimit),
    zValidator("json", presignRequestSchema, onInvalid),
    async (context) => {
      const { db, storage, env } = context.get("deps");
      const { files } = context.req.valid("json");
      const ip = clientIp(context);
      const uploads = await createUploadSlots(
        { db, storage },
        files,
        ip ? hashIp(ip, env.SESSION_SECRET) : null,
      );
      return context.json({ uploads });
    },
  );
}
