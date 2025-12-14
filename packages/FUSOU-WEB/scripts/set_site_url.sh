#!/usr/bin/env bash
# Set PUBLIC_SITE_URL based on git branch name
# Usage: source ./scripts/set_site_url.sh

set -euo pipefail

# Get current branch name, handling detached HEAD
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

# Sanitize branch name for URL (replace special chars with hyphens)
SAFE_BRANCH=$(echo "$BRANCH_NAME" | sed 's/[^a-zA-Z0-9._-]/-/g' | sed 's/^-//;s/-$//')

# Set PUBLIC_SITE_URL
export PUBLIC_SITE_URL="https://${SAFE_BRANCH}.pages.fusou.dev"

echo "[set_site_url] Branch: $BRANCH_NAME"
echo "[set_site_url] Public Site URL: $PUBLIC_SITE_URL"
