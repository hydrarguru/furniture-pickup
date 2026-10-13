#!/usr/bin/env bash
# Starts everything needed for local development in one terminal:
# Garage (S3, :3900), the API (:3000) and the web app (:5173). Ctrl+C stops all of them.
set -euo pipefail
cd "$(dirname "$0")/.."

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
  "./scripts/garage-dev.sh wait && ./scripts/garage-dev.sh init --if-needed && cd apps/api && exec node_modules/.bin/tsx watch --clear-screen=false --env-file-if-exists=.env src/index.ts" \
  "cd apps/web && exec node_modules/.bin/vite"
