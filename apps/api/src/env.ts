import { z } from "zod";
import { TURNSTILE_TEST_SECRET } from "./security/turnstile.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  MAILER: z.enum(["console"]).default("console"),
  S3_ENDPOINT: z.url().default("http://127.0.0.1:3900"),
  /** Browser-facing S3 endpoint (e.g. https://s3.example.se). Defaults to S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("garage"),
  S3_BUCKET: z.string().default("pickup-images"),
  S3_ACCESS_KEY_ID: z.string().default("dev-access-key"),
  S3_SECRET_ACCESS_KEY: z.string().default("dev-secret-key"),
  /** Defaults to Cloudflare's always-pass test secret; production requires a real one. */
  TURNSTILE_SECRET: z.string().default(TURNSTILE_TEST_SECRET),
  SESSION_SECRET: z.string().min(32).default("dev-only-secret-change-me-in-production!!"),
});

export type Env = z.infer<typeof envSchema>;

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
  // Cloudflare test secrets start with 1x/2x/3x followed by zeros.
  if (env.NODE_ENV === "production" && /^[123]x0{10,}/.test(env.TURNSTILE_SECRET)) {
    throw new Error("TURNSTILE_SECRET must be a real secret in production");
  }
  return env;
}
