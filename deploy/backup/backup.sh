#!/usr/bin/env bash
# Hourly backup of the database and the photos to the off-site restic repository.
# Run by hamtning-backup.timer with /etc/hamtning/backup.env; by hand: sudo systemctl start hamtning-backup
#
# Kept for at most 30 days, like the data itself (GDPR): every hourly backup for 2 days, then
# one a day. A request deleted today is gone from the backups within 30 days.
set -euo pipefail
: "${RESTIC_REPOSITORY:?}" "${DATABASE_PATH:?}" "${GARAGE_CONFIG:?}" "${STAGE_DIR:?}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

toml() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$GARAGE_CONFIG"; }
META="$(toml metadata_dir)"
DATA="$(toml data_dir)"
[[ -d "$META" && -d "$DATA" ]] || { echo "Garage directories not found via $GARAGE_CONFIG" >&2; exit 1; }

umask 077
mkdir -p "$STAGE_DIR"

# 1. Database. SQLite's online backup gives a consistent copy while the API keeps running.
sqlite3 "$DATABASE_PATH" ".backup '$STAGE_DIR/app.db'"
check="$(sqlite3 "$STAGE_DIR/app.db" 'PRAGMA integrity_check')"
[[ "$check" == "ok" ]] || { echo "Database copy failed its integrity check: $check" >&2; exit 1; }

# 2. Photos. A fresh, consistent copy of Garage's metadata (which photo is stored where),
#    taken after the database copy so that every photo the database refers to is included.
#    The photo files themselves never change once written, so copying them live is safe.
# GARAGE_CMD is set in backup.env when Garage runs in Docker (deploy/docker/README.md).
${GARAGE_CMD:-garage -c "$GARAGE_CONFIG"} meta snapshot >/dev/null
# Garage keeps adding snapshots; the newest two are enough (the backup has the history).
find "$META/snapshots" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +3 |
  while read -r old; do rm -rf "$old"; done

# 3. Upload (encrypted, and only what changed since last time).
restic cat config >/dev/null 2>&1 || restic init
restic backup --quiet --host hamtning --tag hamtning \
  --exclude "$META/db.sqlite" --exclude "$META/db.sqlite-wal" --exclude "$META/db.sqlite-shm" \
  --exclude "$META/db.lmdb" \
  "$STAGE_DIR/app.db" "$META" "$DATA"

# 4. Retention, max 30 days. Pruning (freeing the space) once a day is enough.
prune=()
[[ "$(date +%H)" == "03" || "${FORCE_PRUNE:-}" == 1 ]] && prune=(--prune)
restic forget --quiet --host hamtning --tag hamtning \
  --keep-within-hourly 48h --keep-within-daily 30d ${prune[@]+"${prune[@]}"}

rm -f "$STAGE_DIR/app.db"
[[ -n "${HEARTBEAT_URL:-}" ]] && curl -fsS -m 10 -o /dev/null "$HEARTBEAT_URL" || true
echo "Backup done: $(restic snapshots --host hamtning --tag hamtning --latest 1 --compact | sed -n 3p)"
