#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVRO_WASM_DIR="$SCRIPT_DIR"

echo "Building Avro WASM with multiple schema versions..."

# Version to build (default: all — always include every version for multi-version coexistence)
VERSION=${1:-"all"}

# Auto-detect available schema versions from Cargo.toml
detect_versions() {
    local versions=()
    while IFS= read -r line; do
        if [[ "$line" =~ ^schema_(v[0-9]+_[0-9]+)[[:space:]]*= ]]; then
            versions+=("${BASH_REMATCH[1]}")
        fi
    done < "$AVRO_WASM_DIR/Cargo.toml"
    echo "${versions[@]}"
}

DETECTED_VERSIONS=($(detect_versions))
echo "Detected schema versions: ${DETECTED_VERSIONS[*]}"

if [ "$VERSION" = "all" ]; then
    FEATURE_PARTS=()
    for v in "${DETECTED_VERSIONS[@]}"; do
        FEATURE_PARTS+=("schema_$v")
    done
    FEATURE="$(IFS=,; echo "${FEATURE_PARTS[*]}"),console_error_panic_hook"
elif [[ "$VERSION" =~ ^v[0-9]+_[0-9]+$ ]]; then
    FEATURE="schema_$VERSION,console_error_panic_hook"
else
    echo "Usage: $0 [v0_4|v0_5|v0_6|...|all]"
    echo ""
    echo "  vN_M  - Build with schema_vN_M only"
    echo "  all   - Build with ALL detected schema versions (default)"
    exit 1
fi

echo "📦 Building avro-wasm with --features $FEATURE"
cd "$AVRO_WASM_DIR"

# Check for Rust toolchain
if ! command -v cargo &> /dev/null; then
    echo "⚠️  Cargo not found. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    export PATH="$HOME/.cargo/bin:$PATH"
    echo "✅ Rust installed. Path updated."
else
    echo "✅ Rust toolchain found."
fi

# Check for wasm-pack
WASM_PACK="wasm-pack"
if ! command -v wasm-pack &> /dev/null; then
    # Helper to find node_modules bin
    if [ -f "./node_modules/.bin/wasm-pack" ]; then
        WASM_PACK="./node_modules/.bin/wasm-pack"
        echo "✅ Using local wasm-pack from node_modules."
    elif [ -f "../../node_modules/.bin/wasm-pack" ]; then
        WASM_PACK="../../node_modules/.bin/wasm-pack"
        echo "✅ Using root wasm-pack from node_modules."
    else
        echo "⚠️  wasm-pack not found. Installing via curl..."
        curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
    fi
fi

# Build for wasm-pack with web target for Cloudflare Workers compatibility
$WASM_PACK build --target web --release --no-default-features --features "$FEATURE" 2>&1 | head -100

# Check if build succeeded
if [ -f "pkg/avro_wasm.js" ]; then
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📊 Generated files:"
    ls -lh pkg/ | grep -E "\.wasm|\.js|\.d\.ts" | awk '{print "  " $9 " (" $5 ")"}'
    echo ""
    echo "📝 WASM module location: $AVRO_WASM_DIR/pkg/avro_wasm_bg.wasm"
    echo "📝 Version: $VERSION (schema_$VERSION)"
else
    echo "❌ Build failed!"
    exit 1
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "WASM Schema Information:"
echo "───────────────────────────────────────────────────────────"
echo "Version:      $VERSION"
echo "Feature:      $FEATURE"
echo "Build Type:   Release (optimized)"
echo "Target:       web"
echo ""
echo "Use in TypeScript:"
echo "  import { validate_avro_ocf_smart } from './pkg/avro_wasm';"
echo "═══════════════════════════════════════════════════════════"
