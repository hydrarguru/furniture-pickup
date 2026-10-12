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

Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

After editing `apps/api/src/db/schema.ts`, run `pnpm --filter @hamtning/api db:generate` and commit the migration.
