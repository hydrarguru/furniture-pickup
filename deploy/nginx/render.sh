#!/usr/bin/env bash
# Fills in deploy/nginx/*.conf for this server.
#   sudo APP_DOMAIN=hamta.example.se S3_DOMAIN=s3.hamta.example.se deploy/nginx/render.sh
# Writes /etc/nginx/sites-available/hamtning.conf and two snippets, then checks the config.
# The other paths and ports can be overridden; deploy/nginx/test-local.sh does.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${APP_DOMAIN:?set APP_DOMAIN}" "${S3_DOMAIN:?set S3_DOMAIN}"
OUT_DIR="${OUT_DIR:-/etc/nginx/sites-available}"
SNIPPETS="${SNIPPETS:-/etc/nginx/snippets}"
WEB_ROOT="${WEB_ROOT:-/var/www/hamtning/current}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/$APP_DOMAIN}"
API="${API:-127.0.0.1:3000}"
GARAGE="${GARAGE:-127.0.0.1:3900}"
LOG_DIR="${LOG_DIR:-/var/log/nginx}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

# RATE_LIMITS=off drops nginx's rate limits: only for load tests (loadtest/run-local.sh).
strip_limits() { if [[ "${RATE_LIMITS:-on}" == off ]]; then grep -v "limit_req zone="; else cat; fi; }

render() {
  sed -e "s|__APP_DOMAIN__|$APP_DOMAIN|g" -e "s|__S3_DOMAIN__|$S3_DOMAIN|g" \
    -e "s|__WEB_ROOT__|$WEB_ROOT|g" -e "s|__CERT_DIR__|$CERT_DIR|g" \
    -e "s|__SNIPPETS__|$SNIPPETS|g" -e "s|__API__|$API|g" -e "s|__GARAGE__|$GARAGE|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" -e "s|__HTTP_PORT__|$HTTP_PORT|g" -e "s|__HTTPS_PORT__|$HTTPS_PORT|g" "$1"
}
mkdir -p "$OUT_DIR" "$SNIPPETS"
render "$HERE/hamtning.conf" | strip_limits >"$OUT_DIR/hamtning.conf"
render "$HERE/hamtning-proxy.conf" >"$SNIPPETS/hamtning-proxy.conf"
render "$HERE/hamtning-headers.conf" >"$SNIPPETS/hamtning-headers.conf"
if grep -rq "__[A-Z0-9_]*__" "$OUT_DIR/hamtning.conf" "$SNIPPETS"/hamtning-*.conf; then
  echo "Unfilled placeholder left in the rendered config" >&2
  exit 1
fi
echo "Wrote $OUT_DIR/hamtning.conf and $SNIPPETS/hamtning-{proxy,headers}.conf"
