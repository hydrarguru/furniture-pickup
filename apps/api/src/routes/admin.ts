import {
  categoryCreateSchema,
  categoryUpdateSchema,
  compareSv,
  noteSchema,
  statusChangeSchema,
} from "@hamtning/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  addNote,
  changeStatus,
  deleteRequestNow,
  getRequestAddress,
  getRequestDetail,
  LIST_FILTERS,
  listCancellations,
  listRequests,
  notificationSummary,
} from "../admin/service.js";
import { type AuthedEnv, requireAdmin, requireEmployee } from "../auth/middleware.js";
import { SESSION_COOKIE, sessionAlive } from "../auth/sessions.js";
import { categories, requests } from "../db/schema.js";
import { onInvalid } from "./validation.js";

const listQuery = z.object({
  status: z.enum(LIST_FILTERS).default("all"),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
});
const idParam = z.object({ id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) });
const categoryIdParam = z.object({ id: z.coerce.number().int().positive() });

/** How often the notification stream sends a keep-alive (and re-checks the session). */
export const HEARTBEAT_MS = 25_000;

const isUniqueViolation = (err: unknown) =>
  err instanceof Error && "code" in err && String(err.code).startsWith("SQLITE_CONSTRAINT_UNIQUE");

export function adminRoutes() {
  return (
    new Hono<AuthedEnv>()
      .use(requireEmployee)

      // Requests
      .get("/requests", zValidator("query", listQuery, onInvalid), async (context) => {
        const { db, storage } = context.get("deps");
        const { status, q, cursor } = context.req.valid("query");
        return context.json(await listRequests({ db, storage }, { filter: status, q, cursor }));
      })
      .get("/requests/:id", zValidator("param", idParam, onInvalid), async (context) => {
        const detail = await getRequestDetail(context.get("deps"), context.req.valid("param").id, {
          markSeen: true,
        });
        return detail ? context.json(detail) : context.json({ error: "not_found" }, 404);
      })
      .patch(
        "/requests/:id/status",
        zValidator("param", idParam, onInvalid),
        zValidator("json", statusChangeSchema, onInvalid),
        async (context) => {
          const deps = context.get("deps");
          const { id } = context.req.valid("param");
          const result = await changeStatus(
            { ...deps, appOrigin: deps.env.APP_ORIGIN },
            id,
            context.get("employee"),
            context.req.valid("json"),
          );
          if (!result.ok) {
            const status =
              result.error === "not_found" ? 404 : result.error === "date_in_past" ? 400 : 409;
            return context.json({ error: result.error }, status);
          }
          return context.json(await getRequestDetail(deps, id, { markSeen: false }));
        },
      )
      .get("/requests/:id/location", zValidator("param", idParam, onInvalid), async (context) => {
        const { db, geocoder } = context.get("deps");
        const address = getRequestAddress(db, context.req.valid("param").id);
        if (!address) return context.json({ error: "not_found" }, 404);
        try {
          return context.json({ location: await geocoder.locate(address) });
        } catch (err) {
          console.error("Geocoding failed", err);
          return context.json({ error: "geocoder_unavailable" }, 502);
        }
      })
      .delete("/requests/:id", zValidator("param", idParam, onInvalid), async (context) => {
        const deleted = await deleteRequestNow(
          context.get("deps"),
          context.req.valid("param").id,
          context.get("employee"),
        );
        return deleted ? context.json({ ok: true }) : context.json({ error: "not_found" }, 404);
      })
      .post(
        "/requests/:id/notes",
        zValidator("param", idParam, onInvalid),
        zValidator("json", noteSchema, onInvalid),
        async (context) => {
          const deps = context.get("deps");
          const { id } = context.req.valid("param");
          if (!addNote(deps.db, id, context.get("employee"), context.req.valid("json").note))
            return context.json({ error: "not_found" }, 404);
          return context.json(await getRequestDetail(deps, id, { markSeen: false }), 201);
        },
      )

      .get("/cancellations", (context) =>
        context.json({ cancellations: listCancellations(context.get("deps").db) }),
      )

      // Notifications
      .get("/notifications/summary", (context) =>
        context.json(notificationSummary(context.get("deps").db)),
      )
      .get("/notifications/stream", (context) => {
        const { db, events } = context.get("deps");
        const token = getCookie(context, SESSION_COOKIE) as string; // requireEmployee checked it
        // Tell nginx not to buffer this response.
        context.header("X-Accel-Buffering", "no");
        return streamSSE(context, async (stream) => {
          let closed = false;
          const sendSummary = () =>
            stream.writeSSE({ event: "summary", data: JSON.stringify(notificationSummary(db)) });
          const onVerified = ({ id }: { id: string }) => {
            const r = db
              .select({ id: requests.id, name: requests.name, city: requests.city })
              .from(requests)
              .where(eq(requests.id, id))
              .get();
            if (r) void stream.writeSSE({ event: "verified", data: JSON.stringify(r) });
            void sendSummary();
          };
          const onChange = () => void sendSummary();
          const onCancelled = ({ id, visibleToStaff }: { id: string; visibleToStaff: boolean }) => {
            if (visibleToStaff)
              void stream.writeSSE({ event: "cancelled", data: JSON.stringify({ id }) });
            void sendSummary();
          };

          events.on("request.verified", onVerified);
          events.on("request.seen", onChange);
          events.on("request.changed", onChange);
          events.on("requests.purged", onChange);
          events.on("request.cancelled", onCancelled);

          let timer: ReturnType<typeof setTimeout> | undefined;
          let wake = () => {};
          // Runs on disconnect, so listeners are released immediately, not at the next heartbeat.
          const close = () => {
            if (closed) return;
            closed = true;
            events.off("request.verified", onVerified);
            events.off("request.seen", onChange);
            events.off("request.changed", onChange);
            events.off("requests.purged", onChange);
            events.off("request.cancelled", onCancelled);
            clearTimeout(timer);
            wake();
          };
          stream.onAbort(close);
          try {
            await sendSummary();
            while (!closed) {
              await new Promise<void>((resolve) => {
                wake = resolve;
                timer = setTimeout(resolve, HEARTBEAT_MS);
              });
              // End the stream once the session is gone (logout, expiry); the client re-auths.
              if (closed || !sessionAlive(db, token)) break;
              await stream.write(": keep-alive\n\n");
            }
          } finally {
            close();
          }
        });
      })

      // Categories (admin only)
      .get("/categories", requireAdmin, (context) =>
        context.json({
          categories: context
            .get("deps")
            .db.select()
            .from(categories)
            .all()
            .sort((a, b) => compareSv(a.labelSv, b.labelSv)),
        }),
      )
      .post(
        "/categories",
        requireAdmin,
        zValidator("json", categoryCreateSchema, onInvalid),
        (context) => {
          try {
            const row = context
              .get("deps")
              .db.insert(categories)
              .values(context.req.valid("json"))
              .returning()
              .get();
            return context.json(row, 201);
          } catch (err) {
            if (isUniqueViolation(err)) return context.json({ error: "duplicate_label" }, 409);
            throw err;
          }
        },
      )
      .patch(
        "/categories/:id",
        requireAdmin,
        zValidator("param", categoryIdParam, onInvalid),
        zValidator("json", categoryUpdateSchema, onInvalid),
        (context) => {
          const patch = context.req.valid("json");
          if (Object.keys(patch).length === 0) return context.json({ error: "empty_update" }, 400);
          try {
            const row = context
              .get("deps")
              .db.update(categories)
              .set(patch)
              .where(eq(categories.id, context.req.valid("param").id))
              .returning()
              .get();
            return row ? context.json(row) : context.json({ error: "not_found" }, 404);
          } catch (err) {
            if (isUniqueViolation(err)) return context.json({ error: "duplicate_label" }, 409);
            throw err;
          }
        },
      )
  );
}
