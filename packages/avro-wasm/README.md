# @fusou/avro-wasm

WebAssembly Avro OCF validator for Cloudflare Workers.

## Overview

This package provides a WASM-based Apache Avro OCF (Object Container File) validator that runs in Cloudflare Workers/Pages environment without any Node.js dependencies.

**Key Features:**
- ✅ Zero Node.js dependencies (pure WASM)
- ✅ Full Avro OCF decode validation
- ✅ Cloudflare Workers/Pages compatible
- ✅ No dynamic code generation (CSP-safe)
- ✅ Supports standard codecs (null, snappy, deflate)
- ✅ Based on apache-avro 0.17.0 (Rust)

## Why WASM?

Cloudflare Workers enforce Content Security Policy (CSP) that prohibits dynamic code generation via `eval()` or `new Function()`. Popular JavaScript Avro libraries like `avro-js` and `avsc` use these features internally and fail with:

```
Code generation from strings disallowed for this context
```

This WASM implementation uses Rust's `apache-avro` crate, which performs validation without dynamic code generation.

## Installation

```bash
# Build WASM module
cd packages/avro-wasm
wasm-pack build --target web --out-dir pkg --release
```

## Usage

### Basic Validation

```typescript
import { initWasm, validateAvroOCF } from '@fusou/avro-wasm';

// Initialize WASM module (call once)
await initWasm();

// Validate Avro OCF file
const avroBytes = new Uint8Array(/* ... */);
const schema = JSON.stringify({
  type: "record",
  name: "Battle",
  fields: [
    { name: "id", type: "string" },
    { name: "timestamp", type: "long" }
  ]
});

const result = await validateAvroOCF(avroBytes, schema);

if (result.valid) {
  console.log(`Valid! Records: ${result.recordCount}`);
} else {
  console.error(`Validation failed: ${result.errorMessage}`);
}
```

### Integration with FUSOU-WEB

The validator is integrated into FUSOU-WEB via `src/server/utils/avro-validator.ts`:

```typescript
import { validateAvroOCF } from '@fusou/avro-wasm';

// Use in API routes
export async function POST({ request }) {
  const avroBytes = await request.arrayBuffer();
  const result = await validateAvroOCF(
    new Uint8Array(avroBytes),
    battleSchema
  );
  
  return new Response(JSON.stringify(result));
}
```

## Architecture

### Directory Structure

```
avro-wasm/
├── Cargo.toml           # Rust dependencies
├── src/
│   ├── lib.rs          # WASM entry point
│   ├── validator.rs    # Avro OCF validation logic
│   ├── schema_registry.rs  # Schema management
│   └── utils.rs        # Panic hooks
├── pkg/                # Generated WASM output
│   ├── avro_wasm.js
│   ├── avro_wasm_bg.wasm  (767KB)
│   └── avro_wasm.d.ts
├── index.ts            # TypeScript wrapper
└── package.json
```

### Validation Flow

1. **JavaScript Layer** (`index.ts`)
   - Initializes WASM module
   - Converts schema to JSON string
   - Calls WASM validation function

2. **WASM Layer** (`validator.rs`)
   - Checks magic bytes (`Obj\x01`)
   - Parses Avro schema using `apache_avro::Schema`
   - Reads OCF with `apache_avro::Reader`
   - Decodes all records and counts them
   - Returns `ValidationResult`

3. **Return to JavaScript**
   - TypeScript wrapper converts WASM result to `AvroValidationResult`

## API Reference

### `initWasm(): Promise<void>`

Initialize the WASM module. Must be called before any validation operations.

**Returns:** Promise that resolves when WASM is ready.

### `validateAvroOCF(data, schemaJson): Promise<AvroValidationResult>`

Validate an Avro OCF file against a schema.

**Parameters:**
- `data: Uint8Array` - Avro OCF file bytes
- `schemaJson: string` - Avro schema as JSON string

**Returns:** Promise of `AvroValidationResult`

```typescript
interface AvroValidationResult {
  valid: boolean;
  recordCount: number;
  errorMessage?: string;
}
```

## Build Configuration

### Cargo.toml

```toml
[package]
name = "avro-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[package.metadata.wasm-pack.profile.release]
wasm-opt = false  # Disable wasm-opt due to bulk-memory issues

[dependencies]
apache-avro = { version = "0.17.0", default-features = false, features = ["snappy"] }
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
console_error_panic_hook = "0.1"
once_cell = "1.19"

[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.2", features = ["js"] }
```

### Astro Configuration

FUSOU-WEB's `astro.config.mjs` includes:

```javascript
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        "@fusou/avro-wasm": fileURLToPath(
          new URL("../avro-wasm/index.ts", import.meta.url)
        ),
      },
    },
  },
});
```

### wrangler.toml

```toml
[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
fallthrough = true
```

## Troubleshooting

### Error: "wasm32-unknown-unknown targets not supported"

**Cause:** `getrandom` crate version 0.3+ doesn't support WASM without `wasm32-unknown-emscripten` target.

**Solution:** Use getrandom 0.2 with `features = ["js"]` in `[target.'cfg(target_arch = "wasm32")'.dependencies]`.

### Error: "Bulk memory operations require bulk memory"

**Cause:** wasm-opt tries to optimize with bulk-memory operations that aren't enabled.

**Solution:** Add `wasm-opt = false` to `[package.metadata.wasm-pack.profile.release]`.

### Module Not Found: '@fusou/avro-wasm'

**Cause:** TypeScript can't resolve the module path.

**Solution:** Add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@fusou/avro-wasm": ["../avro-wasm/index.ts"]
    }
  }
}
```

## Performance

- **WASM Bundle Size:** 767KB (uncompressed)
- **Initialization:** ~10-50ms (one-time cost)
- **Validation Speed:** ~1-5ms per file (depends on size)

## License

MIT OR Apache-2.0
