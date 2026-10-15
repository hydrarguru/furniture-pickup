#!/usr/bin/env bash
# Runs the production nginx config locally and checks it, end to end:
#   pnpm build && deploy/nginx/test-local.sh
# Needs nginx, garage and openssl. Starts its own Garage (:3960) and API (:3999) with a throwaway
# database, all removed afterwards, so your dev setup is not touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hamtning-nginx.XXXXXX")"
APP=hamta.localhost
S3=s3.hamta.localhost
HTTPS_PORT=8443
HTTP_PORT=8080
API_PORT=3999
API_PID=""
GARAGE_PID=""
S3_PORT=3960
NGINX_CONF="$TMP/nginx.conf"

cleanup() {
  [[ -f "$TMP/nginx.pid" ]] && nginx -p "$TMP" -c "$NGINX_CONF" -s stop 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$GARAGE_PID" ]] && kill "$GARAGE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

for tool in nginx garage openssl; do
  command -v $tool >/dev/null || { echo "$tool not found (brew install $tool)" >&2; exit 1; }
done
[[ -f "$ROOT/apps/web/dist/index.html" ]] || { echo "Build first: pnpm build" >&2; exit 1; }
[[ -f "$ROOT/apps/api/dist/index.js" ]] || { echo "Build first: pnpm build" >&2; exit 1; }
for port in $HTTPS_PORT $HTTP_PORT $API_PORT $S3_PORT; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is busy" >&2; exit 1; fi
done

# --- Self-signed certificate for both host names --------------------------------------------
mkdir -p "$TMP/cert" "$TMP/logs" "$TMP/tmp"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$APP" \
  -addext "subjectAltName=DNS:$APP,DNS:$S3" \
  -keyout "$TMP/cert/privkey.pem" -out "$TMP/cert/fullchain.pem" 2>/dev/null

# --- Render the real config with local paths and ports ---------------------------------------
APP_DOMAIN=$APP S3_DOMAIN=$S3 OUT_DIR="$TMP/sites" SNIPPETS="$TMP/snippets" \
  WEB_ROOT="$ROOT/apps/web/dist" CERT_DIR="$TMP/cert" LOG_DIR="$TMP/logs" \
  API="127.0.0.1:$API_PORT" GARAGE="127.0.0.1:$S3_PORT" HTTP_PORT=$HTTP_PORT HTTPS_PORT=$HTTPS_PORT \
  "$ROOT/deploy/nginx/render.sh" >/dev/null
MIME="$(dirname "$(nginx -V 2>&1 | tr ' ' '\n' | sed -n 's/^--conf-path=//p')")/mime.types"
cat >"$NGINX_CONF" <<CONF
pid $TMP/nginx.pid;
error_log $TMP/logs/error.log warn;
events {}
http {
  include $MIME;
  default_type application/octet-stream;
  client_body_temp_path $TMP/tmp/body;
  proxy_temp_path $TMP/tmp/proxy;
  fastcgi_temp_path $TMP/tmp/fastcgi;
  uwsgi_temp_path $TMP/tmp/uwsgi;
  scgi_temp_path $TMP/tmp/scgi;
  include $TMP/sites/hamtning.conf;
}
CONF
nginx -t -p "$TMP" -c "$NGINX_CONF" 2>&1 | tail -1
nginx -p "$TMP" -c "$NGINX_CONF"

# --- Garage and the API, each with throwaway data, and one admin ------------------------------
. "$ROOT/deploy/lib/temp-garage.sh"
start_temp_garage "$TMP/garage" "$S3_PORT"
export DATABASE_PATH="$TMP/app.db" PORT=$API_PORT NODE_ENV=development \
  APP_ORIGIN="https://$APP:$HTTPS_PORT" S3_ENDPOINT="http://127.0.0.1:$S3_PORT" \
  S3_PUBLIC_ENDPOINT="https://$S3:$HTTPS_PORT" S3_BUCKET=pickup-images \
  S3_ACCESS_KEY_ID="$S3_KEY_ID" S3_SECRET_ACCESS_KEY="$S3_KEY_SECRET"
PASSWORD="$(cd "$ROOT/apps/api" && node --import tsx scripts/employee.ts \
  add admin@test.local "Test Admin" --admin | sed -n 's/.*Lösenord: *//p')"
node "$ROOT/apps/api/dist/index.js" >"$TMP/logs/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/health" && break; sleep 0.25; done

# --- Checks -----------------------------------------------------------------------------------
CURL=(curl -sk --resolve "$APP:$HTTPS_PORT:127.0.0.1" --resolve "$S3:$HTTPS_PORT:127.0.0.1"
  --resolve "$APP:$HTTP_PORT:127.0.0.1")
BASE="https://$APP:$HTTPS_PORT"
TOKEN="AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"
failures=0
check() { # check <description> <command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  ok    $name"; else echo "  FAIL  $name"; failures=$((failures + 1)); fi
}
header() { "${CURL[@]}" -o /dev/null -D - "$@" | tr -d '\r'; }
has_header() { local url="$1" pattern="$2"; header "$url" | grep -qiE "$pattern"; }
lacks_header() { local url="$1" pattern="$2"; ! header "$url" | grep -qiE "$pattern"; }
status_is() { local expected="$1"; shift; [[ "$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$@")" == "$expected" ]]; }

echo "Web app"
check "HTTP redirects to HTTPS" has_header "http://$APP:$HTTP_PORT/" "^location: https://$APP/"
check "index.html is served" bash -c "$(printf '%q ' "${CURL[@]}") $BASE/ | grep -q '<div id=\"root\">'"
check "unknown paths fall back to the app (status page link)" \
  bash -c "$(printf '%q ' "${CURL[@]}") $BASE/arende/$TOKEN | grep -q '<div id=\"root\">'"
check "index.html is not cached" has_header "$BASE/" "^cache-control: no-cache"
ASSET="$(cd "$ROOT/apps/web/dist" && ls assets/*.js | head -1)"
check "hashed assets are cached for a year" has_header "$BASE/$ASSET" "immutable"
check "assets keep the security headers" has_header "$BASE/$ASSET" "^content-security-policy:"
check "CSP allows Turnstile and the storage host" \
  has_header "$BASE/" "^content-security-policy:.*challenges\.cloudflare\.com.*https://$S3"
check "CSP allows OpenStreetMap tiles for the admin map" \
  has_header "$BASE/" "^content-security-policy:.*img-src[^;]*https://tile\.openstreetmap\.org"
check "HSTS" has_header "$BASE/" "^strict-transport-security: max-age=31536000"
check "no referrer (status links carry tokens)" has_header "$BASE/" "^referrer-policy: no-referrer"
check "nginx version hidden" lacks_header "$BASE/" "^server: nginx/"

echo "API"
check "proxied with the client IP" status_is 200 "$BASE/api/categories"
check "API sends its own headers, without the web CSP twice" \
  bash -c "[[ \$($(printf '%q ' "${CURL[@]}") -o /dev/null -D - $BASE/api/categories | grep -ci '^content-security-policy') -le 1 ]]"
head -c 1100000 /dev/zero | tr '\0' 'a' >"$TMP/big.json"
# /api/categories: a plain /api/ route, so the submit rate limit below isn't used up first.
big="$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST -H "content-type: application/json" \
  --data-binary "@$TMP/big.json" "$BASE/api/categories")"
check "bodies over 1 MB are refused by nginx (got: $big)" test "$big" = 413
codes=""
for _ in $(seq 10); do
  codes+="$("${CURL[@]}" -o /dev/null -w '%{http_code} ' -X POST -H "content-type: application/json" -d '{}' "$BASE/api/requests")"
done
check "form submissions are rate limited (got: $codes)" grep -q 429 <<<"$codes"

echo "Admin live updates (SSE through nginx)"
JAR="$TMP/cookies"
"${CURL[@]}" -c "$JAR" -o /dev/null -H "content-type: application/json" -H "x-requested-with: fetch" \
  -d "{\"email\":\"admin@test.local\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/login"
check "events arrive immediately (not buffered)" bash -c \
  "$(printf '%q ' "${CURL[@]}") -N -b $JAR --max-time 2 $BASE/api/admin/notifications/stream | grep -q '^event: summary'"

echo "Photo storage host"
SLOT="$("${CURL[@]}" -H "content-type: application/json" \
  -d '{"files":[{"contentType":"image/jpeg","size":4}]}' "$BASE/api/uploads/presign")"
URL="$(node -e 'console.log(JSON.parse(process.argv[1]).uploads[0].url)' "$SLOT")"
check "presigned URL points at the storage host" grep -q "^https://$S3:$HTTPS_PORT/" <<<"$URL"
check "presigned upload goes through nginx to Garage" status_is 200 -X PUT \
  -H "content-type: image/jpeg" --data-binary "test" "$URL"
check "a tampered upload is refused" status_is 403 -X PUT \
  -H "content-type: image/png" --data-binary "test" "$URL"

echo "Logs"
"${CURL[@]}" -o /dev/null "$BASE/bekrafta/$TOKEN"
"${CURL[@]}" -o /dev/null "$BASE/api/requests/by-token/$TOKEN"
check "access log has no tokens" bash -c "! grep -q '$TOKEN' '$TMP/logs/hamtning.access.log'"
check "access log shows [token] instead" grep -q "/arende/\[token\]" "$TMP/logs/hamtning.access.log"
check "API log has no tokens" bash -c "! grep -q '$TOKEN' '$TMP/logs/api.log'"

if ((failures > 0)); then
  echo "$failures check(s) failed. nginx error log:"
  tail -20 "$TMP/logs/error.log"
  exit 1
fi
echo "All checks passed."
