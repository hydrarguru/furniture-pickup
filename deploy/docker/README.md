# Running the API and Garage in Docker

An alternative to the systemd services in [../README.md](../README.md). The API and Garage run as
containers (`docker-compose.yml`); nginx, certbot, the web app files and backups stay on the host
exactly as described there, so steps 1 (also install Docker, `docker compose` v2), 2 (skip the
`garage` user), 5 onward apply unchanged except where noted below.

| What | Where |
|---|---|
| Database | `/var/lib/hamtning/app.db` (bind-mounted at `/data` in the container) |
| Photos | `/var/lib/garage/{meta,data}` (bind-mounted) |
| Settings | `/etc/hamtning/{api,web}.env`, `/etc/garage.toml` (same files as the native setup) |
| API log | `docker compose logs -f api` |

The API and Garage are published on `127.0.0.1:3000` and `127.0.0.1:3900` only, which is where
nginx already expects them.

## First setup

```sh
cd /opt/hamtning/app
install -d -o hamtning -g hamtning /var/lib/hamtning /var/lib/garage/meta /var/lib/garage/data
printf 'API_UID=%s\nAPI_GID=%s\n' "$(id -u hamtning)" "$(id -g hamtning)" > .env   # API runs as that user
cp deploy/env/api.env.example /etc/hamtning/api.env   # fill in as in the main guide
cp deploy/env/web.env.example /etc/hamtning/web.env
deploy/docker/init.sh        # Garage config + bucket + storage key + CORS (replaces deploy/garage/init.sh)
deploy/docker/deploy.sh main # builds the web app and API image, starts everything
```

`S3_ENDPOINT` in `api.env` is ignored: compose points it at the Garage container. Keep
`S3_PUBLIC_ENDPOINT` as the public https name.

## Deploys

`deploy/docker/deploy.sh <ref>` replaces `deploy/deploy.sh`. It also takes a database copy
(`/data/pre-deploy-*.db` in `/var/lib/hamtning`, last five kept). Update `deploy.yml` to call it, and add the
deploy user to the `docker` group (note that group is root-equivalent).

## Admin commands

```sh
docker compose exec api tsx scripts/employee.ts add yourname "Your Name" --admin
docker compose exec api tsx scripts/employee.ts list
docker compose exec api tsx scripts/orphaned-photos.ts [--delete]
```

## Backups

Unchanged: `deploy/backup/*.sh` and their timers work as in the main guide, because the data lives
in the same host folders. The only addition is in `/etc/hamtning/backup.env`, so the hourly
backup can ask Garage for its metadata snapshot inside the container:

```sh
GARAGE_CMD="docker compose -f /opt/hamtning/app/docker-compose.yml exec -T garage /garage -c /etc/garage.toml"
```

The restore test and `restore.sh` start a temporary Garage on the host and need the `garage` binary
installed there (step 3 of the main guide, binary only; no `garage` service or user). To restore for
real, stop the stack (`docker compose down`), restore into the same folders and run `deploy.sh`.
