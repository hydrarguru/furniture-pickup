import { cancelRequestSchema, createRequestSchema, requestTokenSchema } from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { autoVerifies } from "../env.js";
import {
  cancelRequest,
  createRequest,
  getStatusView,
  resendVerification,
  verifyRequest,
} from "../requests/service.js";
import { RateLimiter, rateLimit } from "../security/rate-limit.js";
import { onInvalid } from "./validation.js";

const tokenParam = z.object({ token: requestTokenSchema });

export function requestRoutes() {
  // Per-app instances so tests (and multiple apps in one process) don't share counters.
  const submitLimit = new RateLimiter(5, 60 * 60 * 1000);
  const tokenLimit = new RateLimiter(60, 60 * 1000);
  // Each hit sends a mail, so this is kept close to the submit limit.
  const resendLimit = new RateLimiter(5, 60 * 60 * 1000);

  return new Hono<AppEnv>()
    .post(
      "/",
      rateLimit(submitLimit),
      zValidator("json", createRequestSchema, onInvalid),
      async (context) => {
        const { db, storage, mailer, events, env, botCheck } = context.get("deps");
        const input = context.req.valid("json");

        if (!(await botCheck.verify(input.altchaPayload)))
          return context.json({ error: "bot_check_failed" }, 400);

        const result = await createRequest(
          {
            db,
            storage,
            mailer,
            events,
            appOrigin: env.APP_ORIGIN,
            emailLimit: !env.LOAD_TEST,
            autoVerify: autoVerifies(env),
          },
          input,
        );
        if (result.ok) return context.json({ ok: true, statusToken: result.statusToken }, 201);
        if (result.error === "rate_limited") return context.json({ error: "rate_limited" }, 429);
        if (result.error === "invalid_images")
          return context.json({ error: "invalid_images", reason: result.reason }, 400);
        return context.json({ error: result.error }, 400);
      },
    )
    .post(
      "/verify",
      rateLimit(tokenLimit),
      zValidator("json", tokenParam, onInvalid),
      (context) => {
        const { db, events } = context.get("deps");
        const result = verifyRequest({ db, events }, context.req.valid("json").token);
        if (result.ok) return context.json({ status: result.status });
        return context.json({ error: result.error }, result.error === "expired" ? 410 : 404);
      },
    )
    .get(
      "/by-token/:token",
      rateLimit(tokenLimit),
      zValidator("param", tokenParam, onInvalid),
      (context) => {
        const view = getStatusView(context.get("deps").db, context.req.valid("param").token);
        context.header("Cache-Control", "no-store");
        return view ? context.json(view) : context.json({ error: "not_found" }, 404);
      },
    )
    .post(
      "/by-token/:token/resend-verification",
      rateLimit(resendLimit),
      zValidator("param", tokenParam, onInvalid),
      async (context) => {
        const { db, mailer, env } = context.get("deps");
        const result = await resendVerification(
          { db, mailer, appOrigin: env.APP_ORIGIN },
          context.req.valid("param").token,
        );
        if (result.ok) return context.json({ ok: true });
        const status = {
          not_found: 404,
          already_verified: 409,
          too_soon: 429,
          resend_limit: 429,
          mail_failed: 502,
        } as const;
        return context.json({ error: result.error }, status[result.error]);
      },
    )
    .post(
      "/by-token/:token/cancel",
      rateLimit(tokenLimit),
      zValidator("param", tokenParam, onInvalid),
      zValidator("json", cancelRequestSchema, onInvalid),
      async (context) => {
        const result = await cancelRequest(
          context.get("deps"),
          context.req.valid("param").token,
          context.req.valid("json").reason,
        );
        if (result.ok) return context.json({ ok: true });
        return context.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
      },
    );
}
