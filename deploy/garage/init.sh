#!/usr/bin/env bash
# One-time setup for a fresh Garage node: layout, bucket, API key, CORS. UNTESTED.
# Usage: APP_ORIGIN=http://localhost:5173 ./init.sh
set -euo pipefail

CONTAINER="${CONTAINER:-pickup-garage}"
BUCKET="${BUCKET:-pickup-images}"
KEY_NAME="${KEY_NAME:-pickup-api}"
APP_ORIGIN="${APP_ORIGIN:-http://localhost:5173}"
garage() { docker exec "$CONTAINER" /garage "$@"; }

NODE_ID="$(garage node id -q | cut -d@ -f1)"
garage layout assign -z dc1 -c 10G "$NODE_ID"
garage layout apply --version 1

garage bucket create "$BUCKET"
garage key create "$KEY_NAME"
garage bucket allow --read --write --owner "$BUCKET" --key "$KEY_NAME"

echo
echo "Copy the Key ID and Secret key printed above into apps/api/.env as"
echo "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY."
echo
echo "Browser uploads need CORS on the bucket (Garage has no CLI for it). With the AWS CLI:"
cat <<JSON
aws --endpoint-url http://127.0.0.1:3900 s3api put-bucket-cors --bucket $BUCKET --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["$APP_ORIGIN"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "content-length"],
    "MaxAgeSeconds": 3600
  }]
}'
JSON
