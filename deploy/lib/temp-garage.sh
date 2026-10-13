# Sourced by the local test scripts: a throwaway Garage built from the production config.
#   start_temp_garage <dir> <s3-port>
# Uses <s3-port>+1 and +3 for RPC and admin. Sets GARAGE_PID, GARAGE_CONFIG, S3_KEY_ID and
# S3_KEY_SECRET, with bucket "pickup-images" ready. The caller stops it (kill "$GARAGE_PID").
start_temp_garage() {
  local dir="$1" port="$2" root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  mkdir -p "$dir/meta" "$dir/data"
  GARAGE_CONFIG="$dir/garage.toml"
  sed -e "s|/var/lib/garage/meta|$dir/meta|" -e "s|/var/lib/garage/data|$dir/data|" \
    -e "s|127.0.0.1:3900|127.0.0.1:$port|" -e "s|127.0.0.1:3901|127.0.0.1:$((port + 1))|g" \
    -e "s|127.0.0.1:3903|127.0.0.1:$((port + 3))|" -e "s|__RPC_SECRET__|$(openssl rand -hex 32)|" \
    -e "s|__ADMIN_TOKEN__|$(openssl rand -hex 16)|" -e "s|__METRICS_TOKEN__|$(openssl rand -hex 16)|" \
    "$root/deploy/garage/garage.toml" >"$GARAGE_CONFIG"
  RUST_LOG=garage=warn garage -c "$GARAGE_CONFIG" server >"$dir/garage.log" 2>&1 &
  GARAGE_PID=$!
  local _
  for _ in $(seq 40); do garage -c "$GARAGE_CONFIG" status >/dev/null 2>&1 && break; sleep 0.25; done
  garage -c "$GARAGE_CONFIG" layout assign -z dc1 -c 5G \
    "$(garage -c "$GARAGE_CONFIG" node id -q | cut -d@ -f1)" >/dev/null
  garage -c "$GARAGE_CONFIG" layout apply --version 1 >/dev/null
  garage -c "$GARAGE_CONFIG" bucket create pickup-images >/dev/null
  S3_KEY_ID="GK$(openssl rand -hex 12)"
  S3_KEY_SECRET="$(openssl rand -hex 32)"
  garage -c "$GARAGE_CONFIG" key import -n test --yes "$S3_KEY_ID" "$S3_KEY_SECRET" >/dev/null
  garage -c "$GARAGE_CONFIG" bucket allow --read --write --owner pickup-images --key test >/dev/null
}
