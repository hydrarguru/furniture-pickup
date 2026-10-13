# Hämtning av second hand

Pickup-request form for a second-hand store. See [SPEC.md](SPEC.md).

## Layout

- `apps/web`: React + Vite frontend
- `apps/api`: Hono API (Node), SQLite via Drizzle
- `packages/shared`: Zod schemas and helpers used by both

## Develop

```bash
brew install garage   # once; local S3 storage for photos
pnpm install
pnpm dev              # Garage + API + web in one terminal; Ctrl+C stops all three
```

Open http://localhost:5173. The first `pnpm dev` also sets up Garage (bucket, dev key in
`apps/api/.env`, CORS), and the API applies database migrations on start.

### Admin

Staff log in at http://localhost:5173/admin. Accounts are created from the command line (there is no
sign-up page); the password is generated and shown once:

```bash
pnpm --filter @hamtning/api employee add you@example.se "Your Name" --admin
```

Other commands: `employee list`, `employee reset-password <email>`, `employee remove <email>`.
Admins can also edit categories; staff can handle requests.

To run the services separately instead: `pnpm storage:dev`, `pnpm dev:api` and `pnpm dev:web`.

### Storage (Garage)

Photos are uploaded straight from the browser to Garage via presigned URLs, so Garage must be
running for uploads to work. `pnpm dev` handles this. Run separately, it is
`pnpm storage:dev` (Garage on 127.0.0.1:3900, data in `.garage-dev/`, gitignored) and, once while
it runs, `pnpm storage:init` (bucket, dev key in `apps/api/.env`, CORS for localhost:5173);
restart the API afterwards. `/api/health` reports `"storage": false` while Garage is
unreachable; in the browser that shows up as a failed upload ("CORS request did not succeed").
If the web app runs on another origin, re-run init with `APP_ORIGIN=http://... pnpm storage:init`.

`deploy/garage/` holds the Docker setup intended for servers; it has not been run yet.

### Bot protection (Turnstile)

Development uses Cloudflare's test keys, which always pass, so no setup is needed. For production set
`TURNSTILE_SECRET` (API) and `VITE_TURNSTILE_SITE_KEY` (web build); the API refuses to start in
production with a test secret.

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

After editing `apps/api/src/db/schema.ts`, run `pnpm --filter @hamtning/api db:generate` and commit the migration.
