#!/usr/bin/env bash
# Docker version of deploy/deploy.sh. Runs as a user in the docker group:
#   /opt/hamtning/app/deploy/docker/deploy.sh <commit-or-ref>
# 1. Checks out the commit and builds the web app and the API image (the site is untouched).
# 2. Takes a safety copy of the database inside the data volume, keeping the last five.
# 3. Switches the web app over in one step and recreates the API container, then waits for health.
# Rolling back: run it again with the previous commit. The database is not rolled back.
set -euo pipefail
REF="${1:?usage: deploy.sh <commit-or-ref>}"
APP_DIR="${APP_DIR:-/opt/hamtning/app}"
WEB_DIR="${WEB_DIR:-/var/www/hamtning}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

cd "$APP_DIR"
git fetch --quiet origin
git checkout --quiet --detach "$REF"
SHA="$(git rev-parse --short=12 HEAD)"
echo "Deploying $SHA"

release="$WEB_DIR/releases/$SHA"
rm -rf "$release"
mkdir -p "$release"
docker build --target web-dist \
  --build-arg "WEB_UID=$(id -u)" --build-arg "WEB_GID=$(id -g)" \
  --output "type=local,dest=$release" .
TAG="$SHA" docker compose build api

# Safety copy of the database (the new version may migrate it on start).
if docker compose ps --status running --services | grep -qx api; then
  docker compose exec -T api node -e "
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH, { readonly: true });
    db.backup('/data/pre-deploy-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-$SHA.db')
      .then(() => db.close());"
  docker compose exec -T api sh -c 'ls -1t /data/pre-deploy-*.db | tail -n +6 | xargs -r rm -f'
fi

# Previous release's assets are carried over so open pages can still load their lazy chunks.
[[ -d "$WEB_DIR/current/assets" ]] && cp -R "$WEB_DIR/current/assets" "$release/"
ln -sfn "$release" "$WEB_DIR/current.tmp"
mv -T "$WEB_DIR/current.tmp" "$WEB_DIR/current"
ls -1dt "$WEB_DIR"/releases/*/ | tail -n +6 | while read -r old; do rm -rf "$old"; done

TAG="$SHA" docker compose up -d --no-build api garage
for _ in $(seq 30); do
  if curl -fsS -o /dev/null "$HEALTH_URL"; then
    echo "Deployed $SHA: healthy"
    exit 0
  fi
  sleep 1
done
echo "The API is not healthy after the restart. Recent log:" >&2
docker compose logs --tail 40 api >&2 || true
exit 1
