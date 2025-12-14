#!/usr/bin/env bash
set -euo pipefail

# Strict dev: require wasm-pack and Cargo.toml under WASM_CRATE_DIR, then astro dev
WASM_CRATE_DIR="${WASM_CRATE_DIR:-src/wasm/compactor}"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Error: wasm-pack not found. Please install wasm-pack." >&2
  exit 1
fi

if [ ! -f "$WASM_CRATE_DIR/Cargo.toml" ]; then
  # Allow prebuilt pkg fallback if present
  if ls "$WASM_CRATE_DIR"/pkg/*.wasm >/dev/null 2>&1; then
    echo "[strict] Cargo.toml not found, but prebuilt pkg detected. Skipping wasm build."
  else
    echo "Error: Cargo.toml not found under '$WASM_CRATE_DIR' and no prebuilt pkg/*.wasm available." >&2
    echo "Set WASM_CRATE_DIR appropriately or provide prebuilt pkg."
    exit 1
  fi
else
  echo "[strict] Building wasm crate at '$WASM_CRATE_DIR'..."
  pnpm exec wasm-pack build "$WASM_CRATE_DIR" \
    --target bundler \
    --out-dir pkg
fi

echo "[strict] Starting astro dev with dotenvx..."

# Source set_site_url to export PUBLIC_SITE_URL based on branch
source ./scripts/set_site_url.sh

dotenvx run -fk ../.env.keys -f .env --verbose --overload -- astro dev
