#!/usr/bin/env bash
# First-time Garage setup for the Docker stack, the counterpart of deploy/garage/init.sh.
#   sudo deploy/docker/init.sh      (run from /opt/hamtning/app, after creating /etc/hamtning/api.env)
# Safe to run again: it skips whatever already exists.
set -euo pipefail
cd "$(dirname "$0")/../.."
CONFIG="${GARAGE_CONFIG:-/etc/garage.toml}"
API_ENV="${API_ENV:-/etc/hamtning/api.env}"
BUCKET="${BUCKET:-pickup-images}"
KEY_NAME="${KEY_NAME:-pickup-api}"
CAPACITY="${CAPACITY:-20G}"
export GARAGE_CONFIG="$CONFIG" API_ENV

[[ -f "$API_ENV" ]] || { echo "Create $API_ENV first (see deploy/env/api.env.example)" >&2; exit 1; }
if [[ ! -s "$CONFIG" ]]; then
  # Written to a temp file first, so a failure never leaves an empty config behind.
  tmp="$(mktemp)"
  sed -e "s|__RPC_SECRET__|$(openssl rand -hex 32)|" \
    -e "s|__ADMIN_TOKEN__|$(openssl rand -base64 32 | tr -d '\n')|" \
    -e "s|__METRICS_TOKEN__|$(openssl rand -base64 32 | tr -d '\n')|" \
    deploy/docker/garage.toml >"$tmp"
  install -m 0644 "$tmp" "$CONFIG" # the container's user must be able to read it
  rm -f "$tmp"
  echo "Wrote $CONFIG"
fi

docker compose up -d garage
G() { docker compose exec -T garage /garage -c /etc/garage.toml "$@"; }
for _ in $(seq 30); do G status >/dev/null 2>&1 && break; sleep 1; done

if G layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  G layout assign -z dc1 -c "$CAPACITY" "$(G node id -q | cut -d@ -f1)"
  G layout apply --version 1
fi
G bucket info "$BUCKET" >/dev/null 2>&1 || G bucket create "$BUCKET"

set_env() {
  if grep -qE "^#? ?$1=" "$API_ENV"; then sed -i -E "s|^#? ?$1=.*|$1=$2|" "$API_ENV"; else echo "$1=$2" >>"$API_ENV"; fi
}
if ! G key info "$KEY_NAME" >/dev/null 2>&1; then
  id="GK$(openssl rand -hex 12)"
  secret="$(openssl rand -hex 32)"
  G key import -n "$KEY_NAME" --yes "$id" "$secret" >/dev/null
  set_env S3_ACCESS_KEY_ID "$id"
  set_env S3_SECRET_ACCESS_KEY "$secret"
  set_env S3_BUCKET "$BUCKET"
  echo "Created key $KEY_NAME and wrote it to $API_ENV"
fi
G bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" >/dev/null

# Garage has no CORS command; set it through the S3 API from inside the API container.
docker compose up -d api
docker compose exec -T api tsx scripts/set-bucket-cors.ts
