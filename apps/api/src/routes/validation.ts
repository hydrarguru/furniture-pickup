import type { Context } from "hono";

/** zValidator hook: uniform 400 body for schema errors. */
export function onInvalid(
  result: { success: true } | { success: false; error: { issues: unknown } },
  context: Context,
) {
  if (!result.success)
    return context.json({ error: "invalid_request", issues: result.error.issues }, 400);
}
