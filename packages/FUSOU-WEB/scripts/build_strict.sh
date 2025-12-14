#!/usr/bin/env bash
set -euo pipefail

# Strict build: require wasm-pack and Cargo.toml under WASM_CRATE_DIR
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

# Copy WASM files to public directory for Cloudflare static asset upload
echo "[strict] Copying WASM files to public directory..."
mkdir -p public/wasm/compactor
cp "$WASM_CRATE_DIR"/pkg/*.wasm public/wasm/compactor/ 2>/dev/null || true
cp "$WASM_CRATE_DIR"/pkg/*.js public/wasm/compactor/ 2>/dev/null || true
cp "$WASM_CRATE_DIR"/pkg/*.d.ts public/wasm/compactor/ 2>/dev/null || true
cp "$WASM_CRATE_DIR"/pkg/package.json public/wasm/compactor/ 2>/dev/null || true

echo "[strict] Running astro check + build..."
astro check
dotenvx run -fk ../.env.keys -f .env --verbose --overload -- astro build
