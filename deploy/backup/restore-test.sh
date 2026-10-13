#!/usr/bin/env bash
# Proves the backups can be restored: restores the latest one to a temporary directory, starts a
# second, private Garage on it and checks that the database is intact and that every photo it
# refers to can be read back. Changes nothing on the running system. Runs monthly
# (hamtning-restore-test.timer); by hand: sudo systemctl start hamtning-restore-test
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${GARAGE_CONFIG:?}" "${STAGE_DIR:?}" "${API_ENV:?}" "${APP_DIR:?}"
S3_PORT="${RESTORE_TEST_S3_PORT:-3920}"
RPC_PORT="${RESTORE_TEST_RPC_PORT:-3921}"

TMP="$(mktemp -d "${RESTORE_TEST_DIR:-/var/tmp}/hamtning-restore-test.XXXXXX")"
GARAGE_PID=""
cleanup() {
  [[ -n "$GARAGE_PID" ]] && kill "$GARAGE_PID" 2>/dev/null && wait "$GARAGE_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"$HERE/restore.sh" "$TMP/root"

toml() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$GARAGE_CONFIG"; }
META="$TMP/root$(toml metadata_dir)"
DATA="$TMP/root$(toml data_dir)"
# The copy has the live node's identity. A different secret and no peer list keep it from
# ever talking to the live Garage.
rm -f "$META/peer_list"
cat >"$TMP/garage.toml" <<TOML
metadata_dir = "$META"
data_dir = "$DATA"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "127.0.0.1:$RPC_PORT"
rpc_public_addr = "127.0.0.1:$RPC_PORT"
rpc_secret = "$(openssl rand -hex 32)"
[s3_api]
s3_region = "garage"
api_bind_addr = "127.0.0.1:$S3_PORT"
TOML
RUST_LOG=garage=warn garage -c "$TMP/garage.toml" server >"$TMP/garage.log" 2>&1 &
GARAGE_PID=$!
for _ in $(seq 60); do curl -s -o /dev/null "http://127.0.0.1:$S3_PORT" && break; sleep 0.5; done

# Same keys and bucket as the live API (they're in the restored metadata), other endpoint.
(cd "$APP_DIR/apps/api" &&
  DATABASE_PATH="$TMP/root$STAGE_DIR/app.db" S3_ENDPOINT="http://127.0.0.1:$S3_PORT" \
    S3_PUBLIC_ENDPOINT="http://127.0.0.1:$S3_PORT" \
    node --env-file="$API_ENV" --import tsx scripts/verify-restore.ts)

[[ -n "${RESTORE_TEST_HEARTBEAT_URL:-}" ]] && curl -fsS -m 10 -o /dev/null "$RESTORE_TEST_HEARTBEAT_URL" || true
echo "Restore test passed."
