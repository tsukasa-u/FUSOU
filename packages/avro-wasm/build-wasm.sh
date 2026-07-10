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
        if [[ "$line" =~ ^schema_(v[0-9]+_[0-9]+(_[0-9]+)?)[[:space:]]*= ]]; then
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
elif [[ "$VERSION" =~ ^v[0-9]+_[0-9]+(_[0-9]+)?$ ]]; then
    FEATURE="schema_$VERSION,console_error_panic_hook"
else
    echo "Usage: $0 [v0_4|v0_5|v0_5_1|v0_6|...|all]"
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

# Check for a usable wasm-pack binary.
# In CI, npm-installed wasm-pack can exist but fail at runtime when postinstall scripts are blocked.
WASM_PACK=""
WASM_CANDIDATES=()

if command -v wasm-pack &> /dev/null; then
    WASM_CANDIDATES+=("$(command -v wasm-pack)")
fi
if [ -f "./node_modules/.bin/wasm-pack" ]; then
    WASM_CANDIDATES+=("./node_modules/.bin/wasm-pack")
fi
if [ -f "../../node_modules/.bin/wasm-pack" ]; then
    WASM_CANDIDATES+=("../../node_modules/.bin/wasm-pack")
fi

for candidate in "${WASM_CANDIDATES[@]}"; do
    if "$candidate" --version > /dev/null 2>&1; then
        WASM_PACK="$candidate"
        echo "✅ Using wasm-pack: $WASM_PACK"
        break
    fi
done

if [ -z "$WASM_PACK" ]; then
    echo "⚠️  No usable wasm-pack found. Installing via cargo..."
    cargo install wasm-pack --locked --force
    if command -v wasm-pack > /dev/null 2>&1; then
        WASM_PACK="$(command -v wasm-pack)"
        echo "✅ Installed wasm-pack via cargo: $WASM_PACK"
    else
        echo "❌ wasm-pack installation failed."
        exit 1
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
