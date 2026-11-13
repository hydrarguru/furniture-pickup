# Configuration

This document describes all environment variables and settings files. The API reads its variables
in [env.ts](../apps/api/src/env.ts). An empty value has the same effect as no value.

## Settings files

| File | Used by | Template |
| --- | --- | --- |
| `apps/api/.env` | The API on a development computer | [apps/api/.env.example](../apps/api/.env.example) |
| `/etc/hamtning/api.env` | The API on the server | [deploy/env/api.env.example](../deploy/env/api.env.example) |
| `/etc/hamtning/backup.env` | The backup and restore scripts on the server | [deploy/env/backup.env.example](../deploy/env/backup.env.example) |
| `/etc/hamtning/restic-password` | restic, to encrypt the backups | None. Make it with `openssl rand -base64 48`. |
| `/etc/garage.toml` | Garage on the server | [deploy/garage/garage.toml](../deploy/garage/garage.toml) |

WARNING: Do not commit a settings file with real values. These files contain secrets.

## API variables

### General

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | The port of the API. The API listens on `127.0.0.1` only. |
| `DATABASE_PATH` | `./data/app.db` | The path of the SQLite file. On the server: `/var/lib/hamtning/app.db`. |
| `APP_ORIGIN` | `http://localhost:5173` | The address of the site, as visitors see it. The API uses it in email links. |
| `SESSION_SECRET` | A development value | A random text of a minimum of 32 characters. The API also makes the Altcha keys from it. |

### Email

| Variable | Default | Description |
| --- | --- | --- |
| `MAILER` | `console` | `console` writes emails to the log. `resend` sends them through Resend. `smtp` sends them through an SMTP server. |
| `MAIL_FROM` | None | The sender, for example `Butiken <noreply@hamta.example.se>`. The domain must have SPF, DKIM and DMARC. |
| `RESEND_API_KEY` | None | A Resend key with "Sending access" |
| `SMTP_HOST` | None | The SMTP server |
| `SMTP_PORT` | `587` | `587` with STARTTLS, or `465` with `SMTP_SECURE=true` |
| `SMTP_SECURE` | `false` | `true` for TLS from the start of the connection |
| `SMTP_USER` | None | The SMTP username |
| `SMTP_PASSWORD` | None | The SMTP password |
| `DEV_AUTO_VERIFY` | `true` | In development with `MAILER=console`, the API verifies new requests immediately. Set `false` to do a test of the email link. |

### Storage

| Variable | Default | Description |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://127.0.0.1:3900` | The S3 address that the API uses |
| `S3_PUBLIC_ENDPOINT` | The value of `S3_ENDPOINT` | The S3 address that the browser uses. On the server: `https://s3.<domain>`. |
| `S3_REGION` | `garage` | The S3 region |
| `S3_BUCKET` | `pickup-images` | The bucket for the photos |
| `S3_ACCESS_KEY_ID` | A development value | The storage key. `deploy/garage/init.sh` writes it on the server. |
| `S3_SECRET_ACCESS_KEY` | A development value | The secret of the storage key |

### Other

| Variable | Default | Description |
| --- | --- | --- |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | The geocoding server for the map in the admin panel |
| `LOAD_TEST` | `false` | `true` stops the rate limits and the Altcha check. Use it only for load tests. |

### Start-up checks

The API does not start in these conditions:

- `NODE_ENV=production` and `SESSION_SECRET` has the development value
- `NODE_ENV=production` and `S3_ACCESS_KEY_ID` has the development value
- `NODE_ENV=production` and `LOAD_TEST=true`
- `MAILER=smtp` without `SMTP_HOST` or `MAIL_FROM`
- `MAILER=resend` without `RESEND_API_KEY` or `MAIL_FROM`

With `NODE_ENV=production` and `MAILER=console`, the API starts, but it writes a warning to the
log. In this condition, customers receive no email and the verification links go to the log.

## Backup variables

These variables are in `/etc/hamtning/backup.env`.

| Variable | Description |
| --- | --- |
| `RESTIC_REPOSITORY` | The backup bucket, for example `s3:https://s3.eu-central-003.backblazeb2.com/hamtning-backup` |
| `RESTIC_PASSWORD_FILE` | The path of the encryption password. Default: `/etc/hamtning/restic-password`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | The key of the backup bucket |
| `DATABASE_PATH` | The live database |
| `GARAGE_CONFIG` | The Garage configuration file |
| `STAGE_DIR` | The folder for the copies before the upload. Default: `/var/backups/hamtning`. |
| `API_ENV` | The path of `api.env` |
| `APP_DIR` | The path of the application |
| `HEARTBEAT_URL` | Optional. The script calls this URL after each successful backup. |
| `RESTORE_TEST_HEARTBEAT_URL` | Optional. The script calls this URL after each successful restore test. |

## nginx variables

The script `deploy/nginx/render.sh` uses these variables to make the nginx configuration:

| Variable | Description |
| --- | --- |
| `APP_DOMAIN` | The host name of the site, for example `hamta.example.se` |
| `S3_DOMAIN` | The host name of storage, for example `s3.hamta.example.se` |
| `CERT_DIR` | Optional. The certificate folder. Default: `/etc/letsencrypt/live/$APP_DOMAIN`. |
| `RATE_LIMITS` | `off` removes the nginx rate limits. Use it only for load tests. |

## Development variables

`scripts/dev.sh` sets these variables when you use `pnpm dev --host`:

| Variable | Description |
| --- | --- |
| `GARAGE_S3_HOST` | The address where the development Garage listens |
| `CORS_EXTRA_ORIGINS` | More origins for the CORS rule of the development bucket |

## Store details

The store phone number and email address are in
[store.ts](../packages/shared/src/store.ts). The web app shows them. The status emails show the
phone number. Change them there if the store details change.
