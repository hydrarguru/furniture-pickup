# Hämtning av second hand

Pickup-request form for a second-hand store. See [SPEC.md](SPEC.md).

## Layout

- `apps/web`: React + Vite frontend
- `apps/api`: Hono API (Node), SQLite via Drizzle
- `packages/shared`: Zod schemas and helpers used by both

## Develop

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev:api   # http://127.0.0.1:3000/api/health (applies migrations on start)
pnpm dev:web   # http://localhost:5173, proxies /api to the API
```

### Storage (Garage)

Photos are uploaded straight from the browser to Garage via presigned URLs.

```bash
cd deploy/garage
cp garage.toml.example garage.toml   # then set rpc_secret and admin_token
docker compose -f docker-compose.dev.yml up -d
./init.sh                            # layout, bucket, API key, CORS instructions
```

Put the printed key into `apps/api/.env`. `/api/health` returns 503 until the bucket is reachable.
The Garage files are untested against a real node; the API logic is covered by tests using an in-memory fake.

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

After editing `apps/api/src/db/schema.ts`, run `pnpm --filter @hamtning/api db:generate` and commit the migration.
