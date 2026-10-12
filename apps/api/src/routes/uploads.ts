import { presignRequestSchema } from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { createUploadSlots, hashIp } from "../storage/uploads.js";

export const uploadRoutes = new Hono<AppEnv>().post(
  "/presign",
  zValidator("json", presignRequestSchema, (result, context) => {
    if (!result.success)
      return context.json({ error: "invalid_request", issues: result.error.issues }, 400);
  }),
  async (context) => {
    const { db, storage, env } = context.get("deps");
    const { files } = context.req.valid("json");
    // nginx sets X-Forwarded-For; the API only listens on loopback.
    const ip = context.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const uploads = await createUploadSlots(
      { db, storage },
      files,
      ip ? hashIp(ip, env.SESSION_SECRET) : null,
    );
    return context.json({ uploads });
  },
);
