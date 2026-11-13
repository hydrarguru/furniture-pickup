# Architecture

This document describes the parts of the system, how data moves between them, and the reasons for
the design.

## Parts of the system

```text
                        Internet
                           |
                 +---------+----------+
                 |       nginx        |  TLS, security headers, rate limits
                 +--+------+------+---+
                    |      |      |
       static files |      | /api | s3.<domain>
                    v      v      v
            +-------+-+  +-+---------------+  +-----------------+
            | web app |  | API (Node, Hono)|->| Storage (Garage)|
            | (React) |  | 127.0.0.1:3000  |  | 127.0.0.1:3900  |
            +---------+  +--+---------+----+  +-----------------+
                            |         |
                   +--------+--+   +--+-------------------+
                   | SQLite    |   | Email (Resend, SMTP, |
                   | app.db    |   | or the log)          |
                   +-----------+   +----------------------+
```

| Part | Technology | Location in the repository |
| --- | --- | --- |
| Web app | React 19, Vite, TypeScript, React Router, React Hook Form, TanStack Query (admin panel only), Leaflet (map) | `apps/web` |
| API | Node 26, Hono, Zod, Drizzle ORM | `apps/api` |
| Shared code | Zod schemas, statuses, retention rules, date and postcode functions | `packages/shared` |
| Database | SQLite (`better-sqlite3`) in WAL mode | `apps/api/src/db`, migrations in `apps/api/drizzle` |
| Storage | Garage 2.x with an S3-compatible API | `deploy/garage` |
| Web server | nginx | `deploy/nginx` |
| Email | Resend API, SMTP (`nodemailer`), or the console | `apps/api/src/mailer` |
| Bot protection | Altcha proof-of-work, self-hosted | `apps/api/src/security/altcha.ts`, `apps/web/src/form/Altcha.tsx` |
| Backup | restic to an S3-compatible bucket at a different provider | `deploy/backup` |
| Map positions | OpenStreetMap Nominatim | `apps/api/src/geo` |

The project is a pnpm monorepo. The workspaces are `apps/*` and `packages/*`
([pnpm-workspace.yaml](../pnpm-workspace.yaml)).

## Repository layout

| Folder | Contents |
| --- | --- |
| `apps/web/src/pages` | Public pages: home, form, thanks, verification, status page, privacy, not found |
| `apps/web/src/form` | The request form, its 4 steps, and the photo uploader |
| `apps/web/src/admin` | The admin panel: login, request list, request detail, categories |
| `apps/web/src/lib` | API client, form draft, photo processing, color theme |
| `apps/api/src/routes` | HTTP routes. Each file is one group of endpoints. |
| `apps/api/src/requests` | Customer actions: send, verify, cancel, status page |
| `apps/api/src/admin` | Employee actions: list, detail, status change, notes, delete |
| `apps/api/src/retention` | Automatic deletion and the sweep of photos without a request |
| `apps/api/src/jobs` | The timer that runs the hourly jobs |
| `apps/api/src/security` | Rate limits, tokens, Altcha, client IP, the access log |
| `apps/api/src/auth` | Passwords, sessions, and the login middleware |
| `apps/api/scripts` | Command-line tools: employee accounts, demo data, photo report, restore check |
| `deploy` | Server files: nginx, systemd, backup, Garage, the deploy script |
| `loadtest` | k6 load test |
| `scripts` | Scripts for local development |

## Data flow

### Send a request

1. The browser processes each photo on the device. It decreases the long edge to 1600 px,
   changes HEIC to JPEG, and removes the EXIF data (for example the GPS position).
2. The browser sends `POST /api/uploads/presign`. The API records each photo key in
   `pending_uploads` and returns presigned upload URLs.
3. The browser uploads each photo directly to storage with the presigned URL. The photos do not go
   through the API.
4. The browser sends `POST /api/requests` with the form data, the photo keys, and the Altcha
   solution.
5. The API examines the Altcha solution, the form data, and the size and type of each photo in
   storage.
6. The API writes the request, items, photos and times in one database transaction.
7. The API sends the verification email. The request has the status `unverified`.

### Verify a request

1. The customer opens the link `/bekrafta/<token>` from the email.
2. The page sends `POST /api/requests/verify`. Some email scanners open links automatically. Thus,
   the page load alone does not verify the request.
3. The API changes the status to `new` and sends a live update to the admin panel.

### Live updates in the admin panel

The admin panel keeps one Server-Sent Events (SSE) connection to
`GET /api/admin/notifications/stream`. The API sends these events:

| Event | When | Result in the admin panel |
| --- | --- | --- |
| `summary` | At connection, and after each change | The counts and the badge change |
| `submitted` | A customer sends a request | The list refreshes. No toast, because the request is not verified. |
| `verified` | A customer verifies a request | The list refreshes and a toast shows |
| `cancelled` | A customer cancels a request | The list refreshes and a toast shows |

If the SSE connection stops, the admin panel asks for the summary every 30 seconds
([queries.ts:45](../apps/web/src/admin/queries.ts)). nginx must not buffer this route.

The events go through an in-process event bus ([events.ts](../apps/api/src/events.ts)). Thus, live
updates work only with one API process.

### Status page

The status page asks the API for new data every 30 seconds while the browser tab is visible
([StatusPage.tsx:47](../apps/web/src/pages/StatusPage.tsx)). It shows the status, the times, and a
timeline of status changes. It never shows notes from employees or the names of employees.

### Photos for employees

The storage bucket is private. The API gives the admin panel presigned download URLs. A presigned
URL is valid for 15 minutes.

## Database tables

The schema is in [schema.ts](../apps/api/src/db/schema.ts). All timestamps are ISO 8601 in UTC. The
web app shows them in the `Europe/Stockholm` time zone.

| Table | Contents |
| --- | --- |
| `requests` | One row for each request: contact details, address, status, token hash, confirmed time |
| `items` | The items of a request |
| `images` | The photos of a request. Each row has the key of the photo in storage. |
| `time_windows` | The pickup times that the customer proposed |
| `categories` | Item categories. An admin can change them. |
| `request_events` | The history of a request: status changes, notes, and sent emails |
| `request_links` | Extra status-page tokens. Each status email has a new token. |
| `cancellations` | The reason for a customer cancellation, without personal data |
| `pending_uploads` | Photo keys that the API gave out, but that no request uses yet |
| `employees` | Employee accounts with a scrypt password hash and a role |
| `sessions` | Login sessions of employees. The table keeps only the hash of the session token. |

When the API deletes a request, SQLite also deletes the items, photo rows, times, events and links
(`ON DELETE CASCADE`).

## Background jobs

The API starts the jobs when it starts. Then it runs them each hour
([jobs/index.ts](../apps/api/src/jobs/index.ts)):

1. `cleanup-uploads` deletes the expired rows in `pending_uploads` and their photos.
2. `purge-retention` deletes the requests that are past their deletion date. Refer to
   [request-lifecycle.md](request-lifecycle.md#automatic-deletion).
3. `sweep-orphaned-photos` deletes photos older than 24 hours that no row refers to.

If a job is not successful, the API writes the error to the log. The next run tries again.

## Security

- The API validates each input with Zod. The web app and the API use the same schemas from
  `packages/shared`.
- The database keeps only SHA-256 hashes of tokens and session IDs.
- Employee passwords use scrypt, which is part of Node.
- The session cookie `sid` is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Its path is
  `/api`.
- Each API call to `/api/auth/*` or `/api/admin/*` that changes data must have the header
  `X-Requested-With: fetch`. This header gives protection against cross-site request forgery
  (CSRF).
- nginx and the API both have rate limits. Refer to [api.md](api.md#rate-limits).
- The access log replaces tokens in URLs with `[token]`. The log contains no personal data.
- The API accepts a body of a maximum of 1 MB.

## Design decisions

| Decision | Reason |
| --- | --- |
| The browser uploads photos directly to storage | The API does not keep large files in memory. The body limit of 1 MB stays small. |
| SQLite, not a database server | One store has a small quantity of data. One file is easy to back up and restore. |
| One API process | The live updates and the rate limit counters are in memory. One process has sufficient capacity for one store. Refer to [load-testing.md](load-testing.md). |
| Email verification, no customer accounts | The link proves that the customer has the email address. It stops most spam. |
| Employees receive notices only in the admin panel | The store has one shared inbox. Staff email notices are out of scope for version 1. |
| Altcha, self-hosted | It sends no data to a third party. |
| A customer cancellation deletes the request immediately | The store keeps no personal data that it does not use. Only the reason stays for 30 days. |
| Employee accounts come from a command-line tool | There is no sign-up page that an attacker can use. |
