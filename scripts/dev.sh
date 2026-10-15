#!/usr/bin/env bash
# Starts everything needed for local development in one terminal:
# Garage (S3, :3900), the API (:3000) and the web app (:5173). Ctrl+C stops all of them.
# `pnpm dev --host` also serves the web app and photo storage on the local network, e.g. to
# open it on a phone. The API stays local; the web app proxies /api to it.
set -euo pipefail
cd "$(dirname "$0")/.."

web_args=()
api_setup="./scripts/garage-dev.sh init --if-needed"
for arg in "$@"; do
  case "$arg" in
    --host)
      lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
      [[ -n "$lan_ip" ]] || { echo "Could not find this machine's network address (en0/en1)." >&2; exit 1; }
      web_args+=(--host)
      # Photo links and mail links must point at an address the phone can reach. Exported values
      # take precedence over apps/api/.env.
      export GARAGE_S3_HOST=0.0.0.0
      export APP_ORIGIN="http://$lan_ip:5173"
      export S3_PUBLIC_ENDPOINT="http://$lan_ip:3900"
      export CORS_EXTRA_ORIGINS="http://localhost:5173"
      api_setup+=" && ./scripts/garage-dev.sh cors >/dev/null"
      ;;
    *) echo "Unknown option: $arg (supported: --host)" >&2; exit 1 ;;
  esac
done

command -v garage >/dev/null || { echo "garage not found. Install it with: brew install garage" >&2; exit 1; }
[[ -d node_modules ]] || pnpm install

for port in 3000 5173; do
  # lsof exits 1 when nothing listens, which is the normal case.
  holder="$({ lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true; } | awk 'NR==2 {print $1 " (pid " $2 ")"}')"
  if [[ -n "$holder" ]]; then
    echo "Port $port is already in use by $holder. Stop it and run pnpm dev again." >&2
    exit 1
  fi
done

# The API and web commands mirror the apps' `dev` scripts (keep them in sync). They run the tools
# directly because `pnpm run` reports Ctrl+C as "Command failed", which looks alarming.
# The API only starts once Garage answers and is set up, so it always reads the right keys.
exec pnpm exec concurrently \
  --names garage,api,web \
  --prefix-colors yellow,cyan,magenta \
  --kill-others \
  "./scripts/garage-dev.sh serve" \
  "./scripts/garage-dev.sh wait && $api_setup && cd apps/api && exec node_modules/.bin/tsx watch --clear-screen=false --env-file-if-exists=.env src/index.ts" \
  "cd apps/web && exec node_modules/.bin/vite ${web_args[*]:-}"
