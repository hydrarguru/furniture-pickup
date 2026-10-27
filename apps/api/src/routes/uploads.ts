import { presignRequestSchema } from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { RateLimiter, rateLimit } from "../security/rate-limit.js";
import { createUploadSlots } from "../storage/uploads.js";
import { onInvalid } from "./validation.js";

export function uploadRoutes() {
  // A form needs at most 8 slots plus retries; 30 per 10 minutes leaves room for mistakes.
  const presignLimit = new RateLimiter(30, 10 * 60 * 1000);

  return new Hono<AppEnv>().post(
    "/presign",
    rateLimit(presignLimit),
    zValidator("json", presignRequestSchema, onInvalid),
    async (context) => {
      const { db, storage } = context.get("deps");
      const uploads = await createUploadSlots({ db, storage }, context.req.valid("json").files);
      return context.json({ uploads });
    },
  );
}
