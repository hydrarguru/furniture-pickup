# Development

This document tells you how to install the project on your computer, run it, and do the tests.

## Requirements

- macOS. The script `scripts/dev.sh` uses Homebrew and the macOS command `ipconfig`.
- Node.js 26. The version is in [.nvmrc](../.nvmrc).
- pnpm 12.6.0. The version is in the `packageManager` field of [package.json](../package.json).
- Garage, for the photo storage: `brew install garage`.

## Start the system

1. Install the dependencies:

   ```bash
   pnpm install
   ```

2. Start storage, the API and the web app in one terminal:

   ```bash
   pnpm dev
   ```

3. Open <http://localhost:5173> in a browser.
4. To stop all three services, push Ctrl+C.

The first time, `pnpm dev` prepares Garage. It makes the bucket, writes a storage key to
`apps/api/.env`, and sets the CORS rule. The API applies the database migrations when it starts.

| Service | Address |
| --- | --- |
| Web app (Vite) | `http://localhost:5173`. Vite sends `/api` to the API. |
| API | `http://127.0.0.1:3000` |
| Storage (Garage S3 API) | `http://127.0.0.1:3900`. The data is in `.garage-dev/`. Git ignores it. |

If port 3000 or 5173 is in use, `pnpm dev` stops and shows the process that uses the port.

### Run the services one at a time

1. Start storage: `pnpm storage:dev`.
2. While storage runs, prepare it one time: `pnpm storage:init`.
3. Start the API: `pnpm dev:api`.
4. Start the web app: `pnpm dev:web`.

If the web app uses a different origin, run `APP_ORIGIN=http://... pnpm storage:init` again.

### Open the web app on a phone

Run `pnpm dev --host`. The web app and storage then listen on the local network. The links in
emails and the photo URLs use the network address of your computer. The API stays on
`127.0.0.1`.

## Employee accounts

The system has no sign-up page. Make accounts with the command-line tool. The tool shows the
password one time only.

```bash
pnpm --filter @hamtning/api employee add yourname "Your Name" --admin
```

| Command | Result |
| --- | --- |
| `employee add <username> <name> [--admin]` | Makes an account. Without `--admin`, the role is `staff`. |
| `employee list` | Shows all accounts |
| `employee rename <username> <new-username>` | Changes the username |
| `employee reset-password <username>` | Makes a new password |
| `employee remove <username>` | Deletes the account |

A username has 3 to 32 characters: letters, digits, `.`, `_` or `-`. If the database file does not
exist, the tool stops. This prevents a new, empty database at an incorrect path. To make a new
database, add `--create-db`.

Log in at <http://localhost:5173/admin>. An employee with the role `staff` can process requests.
An employee with the role `admin` can also change the categories.

## Demo data

```bash
pnpm seed:demo
```

This command adds 100 requests in all statuses. Each request has photos, history, and notes. The
demo requests use email addresses that end in `@exempel.test`. The dates are relative to today.
The command shows links to status pages. Storage must run (`pnpm dev`).

To remove only the demo data:

```bash
pnpm seed:demo --remove
```

## Email in development

With `MAILER=console`, the API writes each email to its log (the `[api]` lines). The API also
verifies each new request immediately. Thus, new requests show in the admin panel without the
email link.

To do a test of the real verification link, set `DEV_AUTO_VERIFY=false` in `apps/api/.env`.
Refer to [configuration.md](configuration.md).

## Checks

Run all checks before you push. CI runs the same checks
([ci.yml](../.github/workflows/ci.yml)):

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

| Command | Tool | Result |
| --- | --- | --- |
| `pnpm lint` | Biome | Finds style and code problems |
| `pnpm format` | Biome | Corrects the format of all files |
| `pnpm typecheck` | TypeScript | Finds type errors in all workspaces |
| `pnpm test` | Vitest | Runs the unit and integration tests in all workspaces |
| `pnpm build` | TypeScript, Vite, esbuild | Builds the web app and the API |

The test files are next to the source files. Their names end in `.test.ts` or `.test.tsx`.

WARNING: Each push to `main` deploys to production automatically. Push to `main` only when all
checks pass. Refer to [operations.md](operations.md#deploys).

## Change the database schema

1. Change [schema.ts](../apps/api/src/db/schema.ts).
2. Make the migration file:

   ```bash
   pnpm --filter @hamtning/api db:generate
   ```

3. Examine the new SQL file in `apps/api/drizzle`.
4. Commit the schema change and the migration file together.

The API applies new migrations when it starts. Do not change a migration file after it is on
`main`, because the server applied it already. Make a new migration.

## Where to put code

| Code | Location |
| --- | --- |
| A rule that the web app and the API both use (validation, statuses, dates, retention) | `packages/shared/src` |
| Swedish text of the form | `apps/web/src/form/labels.ts` |
| Swedish text of the admin panel | `apps/web/src/admin/labels.tsx` |
| Swedish names of statuses | `STATUS_LABELS_SV` in `packages/shared/src/statuses.ts` |
| Store phone number and email address | `packages/shared/src/store.ts` |
| Email text | `apps/api/src/mailer/templates.ts` |

## Retention in development

The hourly jobs also run on your computer. To see the photos in storage that no request uses:

```bash
pnpm --filter @hamtning/api orphaned-photos
```

To delete the photos that are older than 24 hours, add `--delete`. To use a different minimum age,
add `--min-age-hours=N`.

## Tests of the server configuration

Two scripts run the production configuration on a Mac:

```bash
brew install nginx restic
```

```bash
pnpm build && deploy/nginx/test-local.sh
```

```bash
deploy/backup/test-local.sh
```

- `deploy/nginx/test-local.sh` does approximately 20 tests of the nginx configuration: headers,
  rate limits, SSE, uploads, and log redaction. Storage must run.
- `deploy/backup/test-local.sh` makes a backup, deletes all data, restores the backup, and
  examines the result.

For load tests, refer to [load-testing.md](load-testing.md).
