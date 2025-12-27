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

# Build for wasm-pack
wasm-pack build --target bundler --release --no-default-features --features "$FEATURE" 2>&1 | head -100

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
