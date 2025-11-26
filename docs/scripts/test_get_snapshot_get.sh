#!/usr/bin/env bash
set -eu

# Usage:
# SITE_URL=https://your-site.pages.dev TOKEN=<share_token> ./docs/scripts/test_get_snapshot_get.sh

if [ -z "${SITE_URL:-}" ]; then
  echo "Error: SITE_URL environment variable is required" >&2
  exit 2
fi
if [ -z "${TOKEN:-}" ]; then
  echo "Error: TOKEN environment variable is required" >&2
  exit 2
fi

echo "Testing GET ${SITE_URL}/s/${TOKEN}"

curl -v -H 'Accept: application/json' "${SITE_URL%/}/s/${TOKEN}"
