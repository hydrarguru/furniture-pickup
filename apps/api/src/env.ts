import { z } from "zod";
import { NOMINATIM_DEFAULT_URL } from "./geo/geocoder.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  /**
   * `console` logs mail (development); `resend` sends it through Resend's API; `smtp` through any
   * provider's SMTP server.
   */
  MAILER: z.enum(["console", "resend", "smtp"]).default("console"),
  /** From resend.com → API Keys. A "Sending access" key for the sender's domain is enough. */
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  /** 587 with STARTTLS (required), or 465 with SMTP_SECURE=true for TLS from the start. */
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Sender, e.g. `Butiken <noreply@example.se>`. The domain needs SPF, DKIM and DMARC. */
  MAIL_FROM: z.string().optional(),
  S3_ENDPOINT: z.url().default("http://127.0.0.1:3900"),
  /** Browser-facing S3 endpoint (e.g. https://s3.example.se). Defaults to S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("garage"),
  S3_BUCKET: z.string().default("pickup-images"),
  S3_ACCESS_KEY_ID: z.string().default("dev-access-key"),
  S3_SECRET_ACCESS_KEY: z.string().default("dev-secret-key"),
  /** Geocoding for the admin map. The public server is fine at this volume; a self-hosted one works too. */
  NOMINATIM_URL: z.url().default(NOMINATIM_DEFAULT_URL),
  SESSION_SECRET: z.string().min(32).default("dev-only-secret-change-me-in-production!!"),
  /**
   * For load tests only (loadtest/): turns off rate limits and the bot check, so one
   * machine can play thousands of visitors. Refused in production.
   */
  LOAD_TEST: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Development with MAILER=console: submissions skip the email link. `false` to test the link. */
  DEV_AUTO_VERIFY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * New submissions are verified at once, without the emailed link. Only in development with mail
 * going to the console, never in production (the link is the spam gate) or in load tests (which
 * should measure the real flow).
 */
export const autoVerifies = (env: Env) =>
  env.NODE_ENV === "development" &&
  env.MAILER === "console" &&
  env.DEV_AUTO_VERIFY &&
  !env.LOAD_TEST;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty values (e.g. a blank line copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const env = envSchema.parse(cleaned);
  if (env.NODE_ENV === "production" && env.SESSION_SECRET.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  if (env.NODE_ENV === "production" && env.S3_ACCESS_KEY_ID === "dev-access-key") {
    throw new Error("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY must be set in production");
  }
  if (env.NODE_ENV === "production" && env.LOAD_TEST) {
    throw new Error("LOAD_TEST must not be used in production");
  }
  if (env.MAILER === "smtp" && (!env.SMTP_HOST || !env.MAIL_FROM)) {
    throw new Error("MAILER=smtp needs SMTP_HOST and MAIL_FROM");
  }
  if (env.MAILER === "resend" && (!env.RESEND_API_KEY || !env.MAIL_FROM)) {
    throw new Error("MAILER=resend needs RESEND_API_KEY and MAIL_FROM");
  }
  return env;
}
