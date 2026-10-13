#!/usr/bin/env bash
# Restores a backup into TARGET (a new, empty directory), without touching the running system:
#   sudo bash -c 'set -a; . /etc/hamtning/backup.env; set +a; deploy/backup/restore.sh /var/tmp/restore [snapshot-id]'
# The snapshot defaults to the latest; list them with: restic snapshots
# Afterwards TARGET holds the same paths as the server (TARGET/var/lib/hamtning/..., TARGET/var/lib/garage/...),
# ready to be moved into place. deploy/README.md ("Restore") has the full steps.
set -euo pipefail
TARGET="${1:?usage: restore.sh TARGET [snapshot]}"
SNAPSHOT="${2:-latest}"
: "${RESTIC_REPOSITORY:?}" "${GARAGE_CONFIG:?}" "${STAGE_DIR:?}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

toml() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$GARAGE_CONFIG"; }
META="$(toml metadata_dir)"
DATA="$(toml data_dir)"

mkdir -p "$TARGET"
[[ -z "$(ls -A "$TARGET")" ]] || { echo "$TARGET is not empty" >&2; exit 1; }
restic restore "$SNAPSHOT" --host hamtning --tag hamtning --target "$TARGET" --quiet

# Garage starts from its newest metadata snapshot.
newest="$(find "$TARGET$META/snapshots" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
[[ -n "$newest" ]] || { echo "No Garage metadata snapshot in the backup" >&2; exit 1; }
for f in "$newest"/*; do cp "$f" "$TARGET$META/"; done

echo "Restored $SNAPSHOT into $TARGET:"
echo "  database:            $TARGET$STAGE_DIR/app.db"
echo "  Garage metadata:     $TARGET$META (from snapshot $(basename "$newest"))"
echo "  Garage photo files:  $TARGET$DATA"
