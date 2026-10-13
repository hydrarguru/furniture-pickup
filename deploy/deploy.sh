#!/usr/bin/env bash
# Deploys a commit on the VPS. Runs as the hamtning user (GitHub Actions calls it over SSH):
#   /opt/hamtning/app/deploy/deploy.sh <commit-or-ref>
# 1. Checks out the commit and builds it (the running site is untouched while this happens).
# 2. Takes a safety copy of the database, since the new API version may migrate it on start.
# 3. Switches the web app over in one step and restarts the API, then waits until it is healthy.
# Rolling back: run it again with the previous commit. The database is not rolled back; if a
# migration has to be undone, restore the copy from step 2 (see deploy/README.md).
set -euo pipefail
REF="${1:?usage: deploy.sh <commit-or-ref>}"
APP_DIR="${APP_DIR:-/opt/hamtning/app}"
WEB_DIR="${WEB_DIR:-/var/www/hamtning}"
DB="${DATABASE_PATH:-/var/lib/hamtning/app.db}"
WEB_ENV="${WEB_ENV:-/etc/hamtning/web.env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

cd "$APP_DIR"
git fetch --quiet origin
git checkout --quiet --detach "$REF"
SHA="$(git rev-parse --short=12 HEAD)"
echo "Deploying $SHA"

# The Turnstile site key is public, but it is baked into the web build.
[[ -f "$WEB_ENV" ]] && { set -a; . "$WEB_ENV"; set +a; }
[[ -n "${VITE_TURNSTILE_SITE_KEY:-}" ]] || echo "WARNING: VITE_TURNSTILE_SITE_KEY not set; the form uses Cloudflare's test key"
pnpm install --frozen-lockfile --reporter=silent
pnpm build

# Safety copy of the database, keeping the last five.
if [[ -f "$DB" ]]; then
  copy="$(dirname "$DB")/pre-deploy-$(date +%Y%m%d-%H%M%S)-$SHA.db"
  sqlite3 "$DB" ".backup '$copy'"
  ls -1t "$(dirname "$DB")"/pre-deploy-*.db | tail -n +6 | while read -r old; do rm -f "$old"; done
fi

# New web release. The previous release's assets are carried over, so visitors who still have the
# old page open can load the parts they haven't fetched yet (e.g. the admin) after the switch.
release="$WEB_DIR/releases/$SHA"
rm -rf "$release"
mkdir -p "$release"
[[ -d "$WEB_DIR/current/assets" ]] && cp -R "$WEB_DIR/current/assets" "$release/"
cp -R apps/web/dist/. "$release/"
ln -sfn "$release" "$WEB_DIR/current.tmp"
# Renaming a symlink over another is atomic: nginx sees either the old or the new release.
if mv --version >/dev/null 2>&1; then mv -T "$WEB_DIR/current.tmp" "$WEB_DIR/current"
else mv -fh "$WEB_DIR/current.tmp" "$WEB_DIR/current"; fi # macOS, for the local test
ls -1dt "$WEB_DIR"/releases/*/ | tail -n +6 | while read -r old; do rm -rf "$old"; done

sudo /usr/bin/systemctl restart hamtning-api
for _ in $(seq 30); do
  if curl -fsS -o /dev/null "$HEALTH_URL"; then
    echo "Deployed $SHA: healthy"
    exit 0
  fi
  sleep 1
done
echo "The API is not healthy after the restart. Recent log:" >&2
journalctl -u hamtning-api -n 40 --no-pager >&2 || true
exit 1
