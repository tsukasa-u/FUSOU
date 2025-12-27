#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AVRO_WASM_DIR="$SCRIPT_DIR"

echo "Building Avro WASM with multiple schema versions..."

# Version to build (default: v1)
VERSION=${1:-"v1"}

if [ "$VERSION" = "all" ]; then
    FEATURE="schema_v1,schema_v2,console_error_panic_hook"
elif [ "$VERSION" = "v1" ] || [ "$VERSION" = "v2" ]; then
    FEATURE="schema_$VERSION,console_error_panic_hook"
else
    echo "Usage: $0 [v1|v2|all]"
    echo ""
    echo "  v1  - Build with schema_v1 (default)"
    echo "  v2  - Build with schema_v2"
    echo "  all - Build with BOTH schema_v1 and schema_v2"
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

# Build for wasm-pack
$WASM_PACK build --target bundler --release --no-default-features --features "$FEATURE" 2>&1 | head -100

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
