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
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

# Files written as root can't be cleaned up by later deploys (which run as hamtning).
if [[ $EUID -eq 0 ]]; then
  echo "Run this as the hamtning user, not root: sudo -iu hamtning $0 $REF" >&2
  exit 1
fi

# Removes old releases or database copies, keeping the newest $1. Housekeeping only: a file it
# can't remove (e.g. left behind as root) is reported, but never stops the deploy.
prune() {
  local keep="$1"
  shift
  local old
  ls -1dt "$@" 2>/dev/null | tail -n +"$((keep + 1))" | while read -r old; do
    rm -rf "$old" 2>/dev/null ||
      echo "warning: could not remove $old (owner: $(stat -c %U "$old" 2>/dev/null || echo '?')); fix with: chown -R hamtning:hamtning $old" >&2
  done || true
}

# Migration files the API will apply on its next start, by drizzle's own rule: those newer than
# the last one recorded in the database. All of them when there is no database yet.
pending_migrations() {
  local last
  last="$(sqlite3 -readonly "$DB" "SELECT max(created_at) FROM __drizzle_migrations" 2>/dev/null || true)"
  node -e 'for (const e of require(process.argv[1]).entries)
    if (e.when > Number(process.argv[2] || 0)) console.log(`${e.tag}.sql`)' \
    "$APP_DIR/apps/api/drizzle/meta/_journal.json" "$last"
}

# After the restart: each migration that was pending is either recorded now, or it failed.
report_migrations() {
  [[ -z "$pending" ]] && { echo "Migrations: none to apply"; return; }
  local still m
  still="$(pending_migrations)"
  while read -r m; do
    if grep -qxF "$m" <<<"$still"; then echo "Migration $m: FAILED" >&2
    else echo "Migration $m: applied"; fi
  done <<<"$pending"
}

cd "$APP_DIR"
git fetch --quiet origin
git checkout --quiet --detach "$REF"
SHA="$(git rev-parse --short=12 HEAD)"
echo "Deploying $SHA"

pnpm install --frozen-lockfile --reporter=silent
pnpm build

# Safety copy of the database, keeping the last five.
if [[ -f "$DB" ]]; then
  copy="$(dirname "$DB")/pre-deploy-$(date +%Y%m%d-%H%M%S)-$SHA.db"
  sqlite3 "$DB" ".backup '$copy'"
  prune 5 "$(dirname "$DB")"/pre-deploy-*.db
fi

pending="$(pending_migrations)"
[[ -n "$pending" ]] && echo "Migrations to apply on restart:" && sed 's/^/  /' <<<"$pending"

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

# Straight after the switch, so the web app and the API never stay on different versions.
sudo /usr/bin/systemctl restart hamtning-api
for _ in $(seq 30); do
  if curl -fsS -o /dev/null "$HEALTH_URL"; then
    report_migrations
    echo "Deployed $SHA: healthy"
    prune 5 "$WEB_DIR"/releases/*/
    exit 0
  fi
  sleep 1
done
report_migrations
echo "The API is not healthy after the restart. Recent log:" >&2
journalctl -u hamtning-api -n 40 --no-pager >&2 || true
exit 1
