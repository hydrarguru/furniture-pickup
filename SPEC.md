# Hämtning av second hand-möbler: Project Spec (v0.2)

Changes from v0.1: photo required, categories managed in the DB (list TBD), service areas removed, 30-day retention for closed requests, staff notifications happen in the admin panel instead of email.

## 1. Scope

A public Swedish-language form where anyone can request pickup of used furniture and other items for a second-hand store. Store employees review requests in an admin view and mark them accepted, declined or in progress. No end-user accounts.

**Out of scope for v1:** user accounts, payments, route planning, SMS, multi-store support, service-area logic, staff email notifications.

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, React Hook Form, Zod, React Router, TanStack Query (admin) |
| Backend | Node 22 LTS, Hono (`@hono/node-server`), Zod via `@hono/zod-validator` |
| DB | SQLite (`better-sqlite3`, WAL), Drizzle ORM + drizzle-kit migrations |
| Storage | Garage (S3 API), `@aws-sdk/client-s3` + `s3-request-presigner` |
| Edge | Nginx (TLS, static SPA, `/api` proxy, rate limiting) |
| Email | Transactional provider (Resend/Postmark/SES), behind a `Mailer` interface |
| Bot protection | Cloudflare Turnstile |
| Backup | Litestream (SQLite), restic/rclone (Garage) to off-site storage |

Repo: pnpm monorepo: `apps/web`, `apps/api`, `packages/shared` (Zod schemas, types, postcode util, Swedish strings).

## 3. Verification (no accounts)

Recommendation: **email verification as the gate, phone as a contact field only.**

Flow:
1. User submits the form, and the request is stored with status `unverified`.
2. API emails a link (`/bekrafta/<token>`). The token is random, 32 bytes, and only its SHA-256 hash is stored. It must be used within 24 h. (The 6-digit code fallback was dropped in milestone 4: the link works on any device, and a 6-digit code would need its own brute-force protection.) The link page verifies with a POST, so mail scanners that prefetch links cannot verify a request.
3. Clicking the link sets status to `new` and raises an admin-panel notification (see section 9).
4. Unverified requests are invisible to staff and are purged after 7 days (images included).

The same token gives the user a private status page (`/arende/<token>`) to see the status and cancel.

**Dependency:** the domain and sender address are not set up yet, so no real email can be sent. Until then the API uses a `ConsoleMailer` in development (logs the link) and the provider-backed mailer is swapped in via env config once the domain has SPF/DKIM/DMARC. **Email verification cannot go live before that**, so it is a launch blocker, not a build blocker. If you need to demo or soft-launch earlier, a temporary option is a staff-side "mark as verified" action, but that removes the spam gate, so I'd only use it in a private test.

## 4. Statuses and retention

`unverified` → `new` → `in_progress` → `accepted` | `declined`, plus `cancelled` (user-cancelled).

- Staff can move freely between `new`, `in_progress`, `accepted` and `declined`, with an audit trail.
- `declined` takes an optional message to the user; `accepted` takes a confirmed time chosen from the user's windows (or a custom one). Both are emailed once email is available; until then the message is only shown on the user's status page.
- **Closed** = `accepted`, `declined` or `cancelled`. When a request enters a closed state, `closed_at` is set. If it is reopened, `closed_at` is cleared.
- **30 days after `closed_at`, the request is hard-deleted** with all rows, images in Garage, and its events. The user sees a notice about this on the privacy page and on the status page.
- Staff can also delete any request manually at once ("radera ärende"), to honour erasure requests.

## 5. Postcode handling

Format validation only: strip spaces, require 5 digits (`/^\d{3}\s?\d{2}$/`), store as `12345`. There is no service-area table, badge, filter or form note. Anything outside the store's area is handled by the employee when they review it.

## 6. Time windows

The user proposes **1–3 windows**. Each has:
- date (today + 2 to today + 60 days, configurable),
- a part of day: `forenoon` (08–12), `afternoon` (12–17), `evening` (17–20), or a custom from/to time,
- an optional note.

Stored in `time_windows`. Staff pick one on acceptance (`requests.confirmed_start/end`).

## 7. Data model (SQLite)

```sql
CREATE TABLE requests (
  id              TEXT PRIMARY KEY,            -- ULID
  status          TEXT NOT NULL DEFAULT 'unverified'
                  CHECK (status IN ('unverified','new','in_progress','accepted','declined','cancelled')),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,               -- normalized E.164 (+46...)
  street          TEXT NOT NULL,
  postcode        TEXT NOT NULL,               -- 5 digits
  city            TEXT NOT NULL,
  access_notes    TEXT,                        -- våning, hiss, parkering
  has_elevator    INTEGER,                     -- 0/1/null
  floor           INTEGER,
  message         TEXT,
  consent_at      TEXT NOT NULL,               -- GDPR consent timestamp
  verified_at     TEXT,
  seen_at         TEXT,                        -- first opened by any employee
  token_hash      TEXT NOT NULL,               -- verify + status page
  token_expires   TEXT NOT NULL,
  confirmed_start TEXT,
  confirmed_end   TEXT,
  staff_message   TEXT,                        -- shown to user on accept/decline
  assigned_to     TEXT REFERENCES employees(id),
  closed_at       TEXT,                        -- set when status becomes closed; purge at +30 days
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_requests_status_created ON requests(status, created_at DESC);
CREATE INDEX idx_requests_closed_at ON requests(closed_at) WHERE closed_at IS NOT NULL;

CREATE TABLE categories (                      -- list supplied later; editable by admin
  id         INTEGER PRIMARY KEY,
  label_sv   TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id), -- nullable until the list exists
  description TEXT,
  condition   TEXT CHECK (condition IN ('good','ok','worn')),
  quantity    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE images (                          -- >= 1 per request, enforced in API
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  item_id      TEXT REFERENCES items(id) ON DELETE SET NULL,
  s3_key       TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE time_windows (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,                    -- YYYY-MM-DD
  part       TEXT NOT NULL CHECK (part IN ('forenoon','afternoon','evening','custom')),
  from_time  TEXT, to_time TEXT, note TEXT
);

CREATE TABLE pending_uploads (                 -- for orphan cleanup
  s3_key     TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  ip_hash    TEXT
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL,                 -- argon2id
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','admin')),
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE request_events (                  -- audit trail; deleted with the request
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(id),
  type TEXT NOT NULL,                          -- status_change, note, email_sent
  from_status TEXT, to_status TEXT, note TEXT, created_at TEXT NOT NULL
);
```

Set `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`. Timestamps are ISO 8601 UTC; display in `Europe/Stockholm`.

Note on Litestream: deleted rows remain in backup history until the replica's retention window passes. Set the Litestream retention to ≤ 30 days (and restic snapshot retention similarly) so the GDPR deletion is effective in backups too.

## 8. API

**Public**
- `GET /api/categories`: active categories for the form.
- `POST /api/uploads/presign`: body `{ files: [{ contentType, size }] }` (max 8 files, ≤ 10 MB each, jpeg/png/webp). Returns `[{ key, url }]` and records `pending_uploads`.
- `POST /api/requests`: full form JSON with image keys (**1–8 required**, at least one image or the request is rejected). Validates, `HeadObject`-checks the keys, inserts in one transaction, sends the verification email. Turnstile token required.
- `POST /api/requests/verify`: `{ token }`. Idempotent; 410 when the 24 h window has passed.
- `GET /api/requests/by-token/:token`: status page data (no staff notes).
- `POST /api/requests/by-token/:token/cancel`

**Staff** (session cookie, `SameSite=Lax`, `HttpOnly`, `Secure`, CSRF-safe via a custom header check)
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/admin/requests?status=&q=&cursor=`
- `GET /api/admin/requests/:id` (includes signed image GET URLs, 15 min expiry; sets `seen_at` if empty)
- `PATCH /api/admin/requests/:id/status`: `{ status, message?, confirmedWindowId? | confirmedStart/End }`
- `POST /api/admin/requests/:id/notes`
- `DELETE /api/admin/requests/:id`: immediate hard delete
- `GET /api/admin/notifications/summary`: `{ newCount, unseenCount, latest: [...] }`
- `GET /api/admin/notifications/stream`: Server-Sent Events (Hono `streamSSE`); emits `request.verified` when a request becomes `new`
- `GET/PUT /api/admin/categories` (admin role)
- `GET/POST /api/admin/employees` (admin role)

Images are private: staff view them through short-lived presigned GET URLs, and the bucket is not public.

## 9. Frontend

**Public form** (Swedish, mobile-first, one page with sections or a 4-step wizard):
1. Dina uppgifter: name, email, phone, address, postcode (format check only).
2. Föremål: repeatable item rows (title, category, condition, description) plus a photo uploader (camera or gallery, client-side resize to 1600 px, HEIC → JPEG, EXIF stripped, previews, progress, retry). **At least one photo is required**; the form cannot proceed without it, and the API enforces the same rule. Category is a dropdown fed from `/api/categories`; if the list is empty it is hidden.
3. Hämtning: access notes (floor, lift, parking), 1–3 time windows.
4. Granska & skicka: consent checkbox + link to privacy text (including the 30-day retention), Turnstile.

After submit: "Kolla din e-post för att bekräfta".

Implementation notes (milestone 3):
- Photos belong to the request as a whole, not to individual items (`images.item_id` stays null for now). Simpler for users; can be revisited.
- Pickup dates must be 2–60 days ahead in Stockholm time (`PICKUP_MIN_LEAD_DAYS` / `PICKUP_MAX_LEAD_DAYS` in `@hamtning/shared`), enforced by the shared schema on both client and server.
- Photos are processed one at a time on the device (memory on phones) and uploaded in parallel. HEIC is decoded natively where possible (Safari); other browsers lazy-load `heic-to/csp` (~750 kB gzipped, CSP-safe build).
- Typed details are kept in `sessionStorage` (not photos or consent) so a mobile browser reloading the tab after the camera opens doesn't lose the form. Cleared on successful submit and when the tab closes.

**Other public pages:** `/bekrafta/:token`, `/arende/:token`, `/integritet`.

**Admin (`/admin`):** login, a list with status tabs and search, a detail view (items, image gallery with lightbox, windows, contact details with `tel:` and `mailto:` links, status buttons, note field, event history, a "raderas automatiskt om X dagar" line for closed requests).

**Notifications in the admin panel** (replaces staff email):
- A bell/inbox badge in the header shows the number of unseen new requests, loaded from `/notifications/summary`.
- A single SSE connection (`EventSource`) pushes `request.verified` events; the list refreshes through TanStack Query invalidation, a toast appears, and the badge increments. If SSE drops, it falls back to polling every 30 s.
- The browser tab title shows the count, e.g. `(2) Ärenden`. Optional: Web Notifications and a sound, opt-in per employee on the device.
- Notifications are shared across employees (one shop inbox). A request stops counting as unseen once any employee opens it.
- Limitation: employees only get notified while the admin page is open. If they need alerts when it is closed, add staff email or web push later; the notification code is isolated so a second channel is easy to add.
- Nginx must not buffer the SSE route (`proxy_buffering off`, long `proxy_read_timeout`).

Strings live in one Swedish module from the start, so adding English later is cheap.

## 10. Nginx

- `/` serves `apps/web/dist` with SPA fallback and long cache on hashed assets.
- `/api/` proxies to `127.0.0.1:3000`; the SSE route has buffering disabled.
- `limit_req_zone`: stricter on `POST /api/requests`, `/api/uploads/presign` and `/api/auth/login`.
- **Must** set `proxy_set_header X-Real-IP $remote_addr;` on `/api/`: the API's rate limits and IP hashing trust that header.
- `client_max_body_size 1m` on `/api` (images go straight to Garage, not through Hono).
- Garage S3 endpoint exposed on `s3.<domain>` (TLS, CORS allowing PUT from the app origin only), since the browser uploads directly.
- Security headers: CSP with `script-src 'self' https://challenges.cloudflare.com`, `frame-src https://challenges.cloudflare.com`, `connect-src 'self' <S3 public host>`, `img-src 'self' blob: <S3 public host>`; HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (status URLs contain the access token).

## 11. Background jobs (in-process `node-cron` or systemd timer)

- Hourly: delete `pending_uploads` past expiry (objects too).
- Daily: purge `unverified` requests older than 7 days.
- Daily: **purge requests where `closed_at` < now − 30 days**: delete the S3 objects first, then the DB rows (cascade). Log counts only, no PII.

## 12. Security & privacy checklist

- Zod validation on every input, with upload content-type and size enforced in the presign conditions.
- Re-check the real object size and content type via `HeadObject` on submit.
- Tokens are random and stored hashed; constant-time compare.
- Rate limits in the API (in addition to nginx): submit 5/hour/IP and 3/hour/email (counted in the DB), presign 30/10 min/IP, token routes 60/min/IP. The IP counters are in memory and reset on restart.
- Argon2id for employee passwords; login throttling.
- No PII in logs; hash IPs if stored.
- Privacy page: what is collected, why, the retention rules (closed requests deleted after 30 days, unverified after 7), and how to ask for earlier deletion.
- Backups follow the same retention limit (see section 7).
- Strip EXIF (GPS) from images on the client.

## 13. Deployment

- Two systemd services: `api` (Node) and `garage`; Nginx as the front.
- Env config via `/etc/<app>/env`: `DATABASE_PATH`, `S3_*`, `MAILER` (`console` | `resend` | ...), `EMAIL_*`, `TURNSTILE_SECRET`, `APP_ORIGIN`, `SESSION_SECRET`.
- GitHub Actions: lint → typecheck → test → build web → rsync/ssh deploy → run migrations → restart.
- Litestream replicating `app.db` off-site (retention ≤ 30 days); weekly restic of the Garage data dir; a documented restore test.
- Health endpoint `GET /api/health` (checks the DB and S3), watched by Uptime Kuma.

## 14. Milestones

1. **Foundation:** monorepo, shared package, Hono skeleton, Drizzle schema and migrations, `Mailer` interface with console implementation, CI.
2. **Storage:** Garage on VPS/local Docker, presign + upload flow, orphan cleanup.
3. **Public form:** all sections, validation, time windows, uploader with the required-photo rule.
4. **Submit + verify:** transactional insert, verification flow (console mailer for now), status page, Turnstile, rate limits.
5. **Admin:** auth, list/detail, status changes, notes, categories editing, SSE notifications and badge.
6. **Retention jobs:** 30-day purge, unverified purge, manual delete.
7. **Hardening & launch:** Nginx config, backups and restore test, privacy page, monitoring, real mailer once the domain exists.

## 15. Open items

- Item category list (to be supplied; the form works without it until then).
- Domain, sender email address and email provider (blocks go-live of email verification).
- Store name and the exact privacy text (store owner to confirm).
- Whether staff also want alerts when the admin page is closed (email or web push) after launch.
