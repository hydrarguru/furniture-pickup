import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  MAILER: z.enum(["console"]).default("console"),
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
  return env;
}
