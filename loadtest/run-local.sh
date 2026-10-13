#!/usr/bin/env bash
# Load-tests the whole app on this machine, in production shape: nginx (the real config, HTTPS)
# in front of the built API and its own Garage, with a seeded database. See loadtest/README.md.
#
#   pnpm build && loadtest/run-local.sh [smoke|load|breakpoint]
#
# Needs k6, nginx, garage and openssl. Everything runs in a temporary directory with its own
# ports and is removed afterwards; your dev database and dev Garage are not touched.
# Results: loadtest/results/<profile>-<time>.json (k6's full data) and the summary printed below.
set -euo pipefail

PROFILE="${1:-smoke}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hamtning-loadtest.XXXXXX")"
APP=hamta.localhost
S3=s3.hamta.localhost
HTTPS_PORT=8443 HTTP_PORT=8080 API_PORT=3999 S3_PORT=3950
SEED_REQUESTS="${SEED_REQUESTS:-500}"
GARAGE_PID="" API_PID="" SAMPLER_PID=""

cleanup() {
  [[ -n "$SAMPLER_PID" ]] && kill "$SAMPLER_PID" 2>/dev/null || true
  [[ -f "$TMP/nginx.pid" ]] && nginx -p "$TMP" -c "$TMP/nginx.conf" -s stop 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$GARAGE_PID" ]] && kill "$GARAGE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

for tool in k6 nginx garage openssl; do
  command -v $tool >/dev/null || { echo "$tool not found (brew install $tool)" >&2; exit 1; }
done
[[ -f "$ROOT/apps/api/dist/index.js" && -f "$ROOT/apps/web/dist/index.html" ]] ||
  { echo "Build first: pnpm build" >&2; exit 1; }
for port in $HTTPS_PORT $HTTP_PORT $API_PORT $S3_PORT; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is busy" >&2; exit 1; fi
done
# Many simultaneous connections need more open files than macOS allows by default (256).
ulimit -n "$(ulimit -Hn | sed 's/unlimited/65536/')" 2>/dev/null || ulimit -n 10240

echo "Starting Garage, the API (LOAD_TEST mode) and nginx in $TMP"

# --- Garage, from the production config -------------------------------------------------------
mkdir -p "$TMP/logs" "$TMP/tmp" "$TMP/cert"
. "$ROOT/deploy/lib/temp-garage.sh"
start_temp_garage "$TMP/garage" "$S3_PORT"
KEY_ID="$S3_KEY_ID" KEY_SECRET="$S3_KEY_SECRET"

# --- API: built bundle, LOAD_TEST mode, seeded database ---------------------------------------
cat >"$TMP/api.env" <<ENV
NODE_ENV=development
LOAD_TEST=true
PORT=$API_PORT
DATABASE_PATH=$TMP/app.db
APP_ORIGIN=https://$APP:$HTTPS_PORT
MAILER=console
S3_ENDPOINT=http://127.0.0.1:$S3_PORT
S3_PUBLIC_ENDPOINT=https://$S3:$HTTPS_PORT
S3_BUCKET=pickup-images
S3_ACCESS_KEY_ID=$KEY_ID
S3_SECRET_ACCESS_KEY=$KEY_SECRET
ENV
(cd "$ROOT/apps/api" &&
  node --env-file="$TMP/api.env" --import tsx scripts/loadtest-seed.ts "$TMP/seed.json" "$SEED_REQUESTS")
node --env-file="$TMP/api.env" --enable-source-maps "$ROOT/apps/api/dist/index.js" >"$TMP/logs/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/health" && break; sleep 0.25; done

# --- nginx: the production config without its rate limits -------------------------------------
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$APP" \
  -addext "subjectAltName=DNS:$APP,DNS:$S3" \
  -keyout "$TMP/cert/privkey.pem" -out "$TMP/cert/fullchain.pem" 2>/dev/null
APP_DOMAIN=$APP S3_DOMAIN=$S3 OUT_DIR="$TMP/sites" SNIPPETS="$TMP/snippets" \
  WEB_ROOT="$ROOT/apps/web/dist" CERT_DIR="$TMP/cert" LOG_DIR="$TMP/logs" \
  API="127.0.0.1:$API_PORT" GARAGE="127.0.0.1:$S3_PORT" HTTP_PORT=$HTTP_PORT HTTPS_PORT=$HTTPS_PORT \
  RATE_LIMITS=off "$ROOT/deploy/nginx/render.sh" >/dev/null
MIME="$(dirname "$(nginx -V 2>&1 | tr ' ' '\n' | sed -n 's/^--conf-path=//p')")/mime.types"
# Worker settings as in Debian's and Ubuntu's stock nginx.conf, so the numbers match a VPS.
cat >"$TMP/nginx.conf" <<CONF
pid $TMP/nginx.pid;
error_log $TMP/logs/error.log warn;
worker_processes auto;
events { worker_connections 768; }
http {
  include $MIME;
  default_type application/octet-stream;
  sendfile on;
  keepalive_timeout 65;
  client_body_temp_path $TMP/tmp/body;
  proxy_temp_path $TMP/tmp/proxy;
  fastcgi_temp_path $TMP/tmp/fastcgi;
  uwsgi_temp_path $TMP/tmp/uwsgi;
  scgi_temp_path $TMP/tmp/scgi;
  include $TMP/sites/hamtning.conf;
}
CONF
nginx -p "$TMP" -c "$TMP/nginx.conf"

# --- Run k6, sampling the API process's CPU and memory meanwhile -------------------------------
( while kill -0 "$API_PID" 2>/dev/null; do ps -o %cpu=,rss= -p "$API_PID" >>"$TMP/api-usage"; sleep 2; done ) &
SAMPLER_PID=$!
disown "$SAMPLER_PID" # no "Terminated" message when it is stopped

mkdir -p "$ROOT/loadtest/results"
RESULT="$ROOT/loadtest/results/$PROFILE-$(date +%Y%m%d-%H%M%S).json"
status=0
k6 run --quiet -e PROFILE="$PROFILE" -e BASE_URL="https://$APP:$HTTPS_PORT" \
  -e DATA="$TMP/seed.json" -e SUMMARY_JSON="$RESULT" ${K6_ARGS:-} "$ROOT/loadtest/k6/app.js" || status=$?

if [[ -s "$TMP/api-usage" ]]; then
  awk '{ if ($1 > cpu) cpu = $1; if ($2 > rss) rss = $2 }
       END { printf "API process: peak CPU %d%% of one core, peak memory %d MB\n", cpu, rss / 1024 }' \
    "$TMP/api-usage"
fi
errors="$(grep -c -iE "error|exception" "$TMP/logs/api.log" || true)"
echo "API log lines mentioning errors: $errors"
[[ "$errors" -gt 0 ]] && grep -iE "error|exception" "$TMP/logs/api.log" | sort | uniq -c | sort -rn | head -5
# Keep the server-side logs next to the results (the temporary directory is removed).
mkdir -p "${RESULT%.json}-logs"
cp "$TMP/logs/error.log" "$TMP/logs/api.log" "${RESULT%.json}-logs/" 2>/dev/null || true
echo "Full k6 results: ${RESULT#"$ROOT/"} (server logs in ${RESULT%.json}-logs/)"
exit $status
