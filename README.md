# Hämtning av second hand

A pickup request system for a second-hand store. Customers use a public form to ask the store to
collect furniture and other items. Employees process the requests in an admin panel.

## Parts

- `apps/web`: the web app (React and Vite)
- `apps/api`: the API (Hono on Node, SQLite with Drizzle)
- `packages/shared`: Zod schemas and functions that the web app and the API both use

## Start

1. Install Garage one time. It keeps the photos on your computer:

   ```bash
   brew install garage
   ```

2. Install the dependencies:

   ```bash
   pnpm install
   ```

3. Start Garage, the API and the web app:

   ```bash
   pnpm dev
   ```

4. Open <http://localhost:5173>.

For all details, refer to [docs/development.md](docs/development.md).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

WARNING: Each push to `main` deploys to production automatically.

## Documentation

The documentation is in [docs/](docs/README.md). It uses ASD-STE100 Simplified Technical English.
[SPEC.md](SPEC.md) is the original design specification.
