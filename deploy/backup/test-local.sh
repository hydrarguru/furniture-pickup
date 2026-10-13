#!/usr/bin/env bash
# Runs the real backup, restore and restore-test scripts on this machine, end to end:
#   deploy/backup/test-local.sh
# Needs garage, restic and sqlite3. Uses its own Garage, database and backup repository in a
# temporary directory (removed afterwards); your dev setup is not touched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hamtning-backup-test.XXXXXX")"
GARAGE_PID=""
cleanup() {
  [[ -n "$GARAGE_PID" ]] && kill "$GARAGE_PID" 2>/dev/null && wait "$GARAGE_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT
for tool in garage restic sqlite3; do command -v $tool >/dev/null || { echo "$tool not found" >&2; exit 1; }; done

# --- A "live" system: Garage from the production config, a database with photos ----------
mkdir -p "$TMP/live/meta" "$TMP/live/data"
sed -e "s|/var/lib/garage/meta|$TMP/live/meta|" -e "s|/var/lib/garage/data|$TMP/live/data|" \
  -e "s|127.0.0.1:3900|127.0.0.1:3930|" -e "s|127.0.0.1:3901|127.0.0.1:3931|g" \
  -e "s|127.0.0.1:3903|127.0.0.1:3933|" -e "s|__RPC_SECRET__|$(openssl rand -hex 32)|" \
  -e "s|__ADMIN_TOKEN__|$(openssl rand -hex 16)|" -e "s|__METRICS_TOKEN__|$(openssl rand -hex 16)|" \
  "$ROOT/deploy/garage/garage.toml" >"$TMP/garage.toml"
RUST_LOG=garage=warn garage -c "$TMP/garage.toml" server >"$TMP/garage.log" 2>&1 &
GARAGE_PID=$!
G() { garage -c "$TMP/garage.toml" "$@"; }
for _ in $(seq 30); do G status >/dev/null 2>&1 && break; sleep 0.5; done
G layout assign -z dc1 -c 1G "$(G node id -q | cut -d@ -f1)" >/dev/null
G layout apply --version 1 >/dev/null
G bucket create pickup-images >/dev/null
KEY_ID="GK$(openssl rand -hex 12)"
KEY_SECRET="$(openssl rand -hex 32)"
G key import -n pickup-api --yes "$KEY_ID" "$KEY_SECRET" >/dev/null
G bucket allow --read --write --owner pickup-images --key pickup-api >/dev/null

cat >"$TMP/api.env" <<ENV
NODE_ENV=development
DATABASE_PATH=$TMP/live/app.db
S3_ENDPOINT=http://127.0.0.1:3930
S3_BUCKET=pickup-images
S3_ACCESS_KEY_ID=$KEY_ID
S3_SECRET_ACCESS_KEY=$KEY_SECRET
ENV
cd "$ROOT/apps/api"
node --env-file="$TMP/api.env" --import tsx src/db/migrate-cli.ts >/dev/null
# Three requests with photos, through the same storage code the API uses.
node --env-file="$TMP/api.env" --import tsx --input-type=module -e '
  import { loadEnv } from "./src/env.js";
  import { openDatabase } from "./src/db/client.js";
  import { images, items, requests, timeWindows } from "./src/db/schema.js";
  import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
  const env = loadEnv();
  const { db } = openDatabase(env.DATABASE_PATH);
  const s3 = new S3Client({ endpoint: env.S3_ENDPOINT, region: "garage", forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
  const now = new Date().toISOString();
  for (let r = 0; r < 3; r++) {
    const id = `01TESTREQUEST00000000000${r}`;
    db.insert(requests).values({ id, status: "new", name: "Test", email: "t@example.se",
      phone: "+46701234567", street: "Gatan 1", postcode: "41250", city: "Göteborg",
      consentAt: now, tokenHash: `hash${r}`, tokenExpires: now, createdAt: now, updatedAt: now }).run();
    db.insert(items).values({ id: `item${r}`, requestId: id, title: "Soffa", quantity: 1 }).run();
    db.insert(timeWindows).values({ id: `win${r}`, requestId: id, date: "2026-11-01", part: "forenoon" }).run();
    for (let p = 0; p < 2; p++) {
      const key = `uploads/test-${r}-${p}.jpg`;
      const body = Buffer.alloc(50_000 + r * 1000 + p, r + p);
      await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: "image/jpeg" }));
      db.insert(images).values({ id: `img${r}${p}`, requestId: id, s3Key: key, contentType: "image/jpeg",
        sizeBytes: body.length, position: p }).run();
    }
  }
'
echo "Live system: 3 requests, 6 photos"

# --- Backup, twice (the second run is incremental and prunes) -------------------------------
openssl rand -base64 32 >"$TMP/restic-password"
cat >"$TMP/backup.env" <<ENV
RESTIC_REPOSITORY=$TMP/repo
RESTIC_PASSWORD_FILE=$TMP/restic-password
DATABASE_PATH=$TMP/live/app.db
GARAGE_CONFIG=$TMP/garage.toml
STAGE_DIR=$TMP/stage
API_ENV=$TMP/api.env
APP_DIR=$ROOT
RESTORE_TEST_DIR=$TMP
RESTORE_TEST_S3_PORT=3940
RESTORE_TEST_RPC_PORT=3941
ENV
run() { (set -a; . "$TMP/backup.env"; set +a; "$@"); }
run "$ROOT/deploy/backup/backup.sh"
run env FORCE_PRUNE=1 "$ROOT/deploy/backup/backup.sh"
snapshots="$(find "$TMP/live/meta/snapshots" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
echo "Garage metadata snapshots kept on disk: $snapshots (max 2)"
[[ "$snapshots" -le 2 ]]

# --- The live system is lost: restore from the backup alone ---------------------------------
kill "$GARAGE_PID"; wait "$GARAGE_PID" 2>/dev/null || true; GARAGE_PID=""
rm -rf "$TMP/live"
echo "Live system deleted; restoring from the backup"
run "$ROOT/deploy/backup/restore-test.sh"
