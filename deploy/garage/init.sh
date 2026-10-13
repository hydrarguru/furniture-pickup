#!/usr/bin/env bash
# First-time Garage setup on the VPS. Run as root once Garage is installed (see deploy/README.md):
#   sudo deploy/garage/init.sh
# Safe to run again: it skips whatever already exists.
#  1. Writes /etc/garage.toml with fresh secrets (if missing) and starts the garage service.
#  2. Gives the node its storage role, creates the bucket and an API key.
#  3. Writes the key to the API's env file and sets the bucket's CORS rule for the site.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$HERE/../.." && pwd)"
CONFIG=/etc/garage.toml
API_ENV="${API_ENV:-/etc/hamtning/api.env}"
BUCKET="${BUCKET:-pickup-images}"
KEY_NAME="${KEY_NAME:-pickup-api}"
CAPACITY="${CAPACITY:-20G}" # disk space Garage may use for photos

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -f "$API_ENV" ]] || { echo "Create $API_ENV first (see deploy/env/api.env.example)" >&2; exit 1; }

if [[ ! -f "$CONFIG" ]]; then
  sed -e "s|__RPC_SECRET__|$(openssl rand -hex 32)|" \
    -e "s|__ADMIN_TOKEN__|$(openssl rand -base64 32 | tr -d '\n')|" \
    -e "s|__METRICS_TOKEN__|$(openssl rand -base64 32 | tr -d '\n')|" \
    "$HERE/garage.toml" >"$CONFIG"
  chown root:garage "$CONFIG"
  chmod 0640 "$CONFIG"
  echo "Wrote $CONFIG"
fi

systemctl enable --now garage
G() { garage -c "$CONFIG" "$@"; }
for _ in $(seq 30); do G status >/dev/null 2>&1 && break; sleep 1; done

if G layout show 2>/dev/null | grep -q "No nodes currently have a role"; then
  G layout assign -z dc1 -c "$CAPACITY" "$(G node id -q | cut -d@ -f1)"
  G layout apply --version 1
fi
G bucket info "$BUCKET" >/dev/null 2>&1 || G bucket create "$BUCKET"

set_env() { # set_env KEY VALUE: replace (or add) a line in the API env file
  if grep -qE "^#? ?$1=" "$API_ENV"; then
    sed -i -E "s|^#? ?$1=.*|$1=$2|" "$API_ENV"
  else
    echo "$1=$2" >>"$API_ENV"
  fi
}
if ! G key info "$KEY_NAME" >/dev/null 2>&1; then
  # Generate the key ourselves, so the secret goes straight into the env file.
  id="GK$(openssl rand -hex 12)"
  secret="$(openssl rand -hex 32)"
  G key import -n "$KEY_NAME" --yes "$id" "$secret" >/dev/null
  set_env S3_ACCESS_KEY_ID "$id"
  set_env S3_SECRET_ACCESS_KEY "$secret"
  set_env S3_BUCKET "$BUCKET"
  echo "Created key $KEY_NAME and wrote it to $API_ENV"
fi
G bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME" >/dev/null

# Garage's CLI has no CORS command; set it through the S3 API with the key above.
(cd "$APP_DIR/apps/api" && node --env-file="$API_ENV" --import tsx scripts/set-bucket-cors.ts)
echo "Garage is ready. Restart the API so it picks up the key: systemctl restart hamtning-api"
