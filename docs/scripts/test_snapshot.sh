#!/usr/bin/env bash
set -euo pipefail

# Test script for POST /api/fleet/snapshot
# Usage:
#   SITE_URL="https://your-site.pages.dev" AUTH_TOKEN="<jwt-or-service-key>" OWNER_ID="<uuid>" TAG="test" ./docs/scripts/test_snapshot.sh

SITE_URL=${SITE_URL:-}
AUTH_TOKEN=${AUTH_TOKEN:-}
OWNER_ID=${OWNER_ID:-}
TAG=${TAG:-test}

if [ -z "$SITE_URL" ] || [ -z "$AUTH_TOKEN" ] || [ -z "$OWNER_ID" ]; then
  echo "Usage: SITE_URL=... AUTH_TOKEN=... OWNER_ID=... TAG=... $0"
  exit 2
fi

echo "Testing POST $SITE_URL/api/fleet/snapshot"

cat <<'JSON' > /tmp/_payload.json
{
  "owner_id": "${OWNER_ID}",
  "tag": "${TAG}",
  "payload": { "timestamp": "$(date -Is)", "sample": "hello world" },
  "is_public": true
}
JSON

curl -v -sS -X POST "$SITE_URL/api/fleet/snapshot" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/_payload.json | jq || true

rm -f /tmp/_payload.json
