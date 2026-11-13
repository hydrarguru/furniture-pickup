# API reference

All endpoints start with `/api`. The API listens on `127.0.0.1:3000`. In production, nginx sends
`/api/` to the API. The routes are in [apps/api/src/routes](../apps/api/src/routes).

## General rules

- The API accepts and returns JSON.
- An error response has the form `{ "error": "<code>" }`. Some errors add more fields.
- The maximum body size is 1 MB. A larger body gives `413 payload_too_large`.
- An incorrect input gives `400`. The validation is in [validation.ts](../apps/api/src/routes/validation.ts).
- An unknown route gives `404 not_found`. An unexpected error gives `500 internal_error`.

## Public endpoints

These endpoints use no cookies.

| Method and path | Purpose | Errors |
| --- | --- | --- |
| `GET /api/health` | Examines the database and storage. Returns `200` with `status: "ok"`, or `503` with `status: "degraded"`. | |
| `GET /api/categories` | Returns the active categories in Swedish alphabetical order | |
| `GET /api/altcha/challenge` | Returns a signed Altcha challenge for the form | `429` |
| `POST /api/uploads/presign` | Body: `{ files: [{ contentType, size }] }`. Returns a presigned upload URL and a key for each photo. | `400`, `429` |
| `POST /api/requests` | Sends a request. The body contains the form data, `imageKeys`, and `altchaPayload`. Returns `201` with `statusToken`. | `400 bot_check_failed`, `400 invalid_images`, `429 rate_limited` |
| `POST /api/requests/verify` | Body: `{ token }`. Changes `unverified` to `new`. A second call gives the same result. | `404 not_found`, `410 expired` |
| `GET /api/requests/by-token/:token` | Returns the data for the status page. It contains no notes and no employee names. | `404` |
| `POST /api/requests/by-token/:token/resend-verification` | Sends a new verification link | `404`, `409 already_verified`, `429 too_soon`, `429 resend_limit`, `502 mail_failed` |
| `POST /api/requests/by-token/:token/cancel` | Body: `{ reason }`. Deletes the request. | `404`, `409` when the status is not `unverified` or `new` |

## Employee endpoints

These endpoints use the session cookie `sid`. Each method other than `GET` and `HEAD` must have
the header `X-Requested-With: fetch`. Without it, the API returns `403 csrf_header_missing`.

### Login

| Method and path | Purpose | Errors |
| --- | --- | --- |
| `POST /api/auth/login` | Body: `{ username, password }`. Starts a session. | `401 invalid_credentials`, `429 rate_limited` |
| `POST /api/auth/logout` | Stops the session | |
| `GET /api/auth/me` | Returns the employee of the session | `401 unauthenticated` |

A session is valid for 7 days. If less than half of this time remains, the API extends the session
to 7 days again.

### Requests

All these endpoints return `401 unauthenticated` without a valid session.

| Method and path | Purpose | Errors |
| --- | --- | --- |
| `GET /api/admin/requests?status=&q=&cursor=` | Returns a page of requests. `status` is `all`, `new`, `in_progress`, `accepted`, `on_the_way`, `completed`, `declined` or `cancelled`. `q` is a search text. `cursor` comes from `nextCursor`. | `400` |
| `GET /api/admin/requests/:id` | Returns all data of a request, with presigned photo URLs. Marks the request as seen. | `404` |
| `PATCH /api/admin/requests/:id/status` | Body: `{ status, message?, confirmed? }`. Changes the status. Refer to [request-lifecycle.md](request-lifecycle.md#status-changes). | `400 date_in_past`, `404`, `409` with a code that gives the reason |
| `POST /api/admin/requests/:id/notes` | Body: `{ note }`. Adds a note to the history. | `404` |
| `DELETE /api/admin/requests/:id` | Deletes the request and its photos immediately | `404` |
| `GET /api/admin/requests/:id/location` | Returns the map position of the address from Nominatim | `404`, `502 geocoder_unavailable` |
| `GET /api/admin/requests/:id/customer-view` | Returns the status page data of the request, without a cancel link | `404` |
| `GET /api/admin/cancellations` | Returns the customer cancellation reasons of the last 30 days | |
| `GET /api/admin/notifications/summary` | Returns the count of unseen requests, the counts for each status, and the latest unseen requests | |
| `GET /api/admin/notifications/stream` | SSE stream of live updates. Refer to [architecture.md](architecture.md#live-updates-in-the-admin-panel). | |

The `409` codes of a status change are `unverified`, `cancelled_by_requester`, `declined`,
`completed`, `unchanged`, `not_accepted` and `not_on_the_way`.

### Categories (role `admin` only)

An employee with the role `staff` receives `403 forbidden`.

| Method and path | Purpose | Errors |
| --- | --- | --- |
| `GET /api/admin/categories` | Returns all categories, also the inactive categories | |
| `POST /api/admin/categories` | Body: `{ labelSv }`. Adds a category. | `409 duplicate_label` |
| `PATCH /api/admin/categories/:id` | Body: `{ labelSv?, active? }`. Changes a category. | `400 empty_update`, `404`, `409 duplicate_label` |
| `DELETE /api/admin/categories/:id` | Deletes a category | `404`, `409 in_use` |

A category that an item uses cannot be deleted. Set `active: false` to remove it from the form.

## Rate limits

The API counts the calls for each client IP address in memory. The counters start at zero when the
API starts again. The API reads the client IP address from the `X-Real-IP` header that nginx sets.

| Endpoint | Limit in the API |
| --- | --- |
| `POST /api/requests` | 5 in 1 hour for each IP address, and 3 in 1 hour for each email address (counted in the database) |
| `POST /api/uploads/presign` | 30 in 10 minutes |
| Token endpoints (`verify`, `by-token`, `cancel`) | 60 in 1 minute |
| `resend-verification` | 5 in 1 hour |
| `GET /api/altcha/challenge` | 60 in 1 minute |
| `POST /api/auth/login` | 20 in 15 minutes for each IP address, and 5 incorrect passwords in 15 minutes for each username |

nginx has more limits in front of the API ([hamtning.conf](../deploy/nginx/hamtning.conf)):

| Zone | Rate | Burst |
| --- | --- | --- |
| All of `/api/` | 10 each second | 40 |
| Form submission | 6 each minute | 5 |
| Login | 6 each minute | 5 |
| Presign | 30 each minute | 16 |

When an employee types an unknown username, the API uses the same time as for an incorrect
password. Thus, an attacker cannot find valid usernames from the response time.
