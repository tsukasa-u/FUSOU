# Schema Fingerprint Validation System

## Overview

This system provides cryptographic verification of Avro schemas embedded in data files, ensuring that only approved schema versions can be read by the FUSOU-WORKFLOW reader. This prevents data corruption from schema drift and enables backward-compatible schema evolution.

## Architecture

### Components

1. **Schema Extraction** (`kc_api/crates/kc-api-database/src/bin/print_schema.rs`)
   - Extracts canonical Avro schemas from Rust types
   - Outputs JSON with TABLE_VERSION metadata: `{table_version: "0.4", schemas: [...]}`
   - Run: `cargo run -p kc-api-database --bin print_schema --features schema_v1 > kc_api_v1.json`

2. **Fingerprint Computation** (`FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs`)
   - Computes SHA-256 fingerprints from canonical schemas
   - Adds namespace (`fusou.v1`) to schemas before hashing
   - Output format: `{v1: {table_version: "0.4", tables: {battle: ["hash1"], ...}}}`
   - Run: `node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json > schemas/fingerprints.json`

3. **Runtime Validation** (`FUSOU-WORKFLOW/src/reader.ts`)
   - Extracts schema fingerprint from Avro OCF headers
   - Validates namespace (e.g., `fusou.v1`) matches expected version
   - Validates fingerprint is in allowed list for table
   - Throws error if validation fails

4. **Pre-commit Guard** (`kc_api/scripts/check-schema-version-bump.sh`)
   - Detects schema-related file changes (models/, encode.rs, etc.)
   - Errors if schema files changed but schema_version.rs not updated
   - Install: `ln -s ../../scripts/check-schema-version-bump.sh .git/hooks/pre-commit`

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Schema Definition (Rust)                                 │
│    kc-api-database/src/models/*.rs                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Schema Extraction                                        │
│    print_schema.rs → kc_api_v1.json                         │
│    {table_version: "0.4", schemas: [...]}                   │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Fingerprint Computation                                  │
│    compute-kc-api-fingerprints.mjs → fingerprints.json      │
│    {v1: {table_version: "0.4", tables: {battle: ["..."]...}}}│
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Deployment                                               │
│    SCHEMA_FINGERPRINTS_JSON env var in Cloudflare Workers   │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Runtime Validation                                       │
│    reader.ts validates Avro headers against fingerprints    │
│    - Extract fingerprint from header                        │
│    - Check namespace matches version (fusou.v1)             │
│    - Verify fingerprint in allowed list                     │
└─────────────────────────────────────────────────────────────┘
```

## Fingerprint Format

### Current Format (v1 only)

```json
{
  "v1": {
    "table_version": "0.4",
    "tables": {
      "battle": ["8446dac50a1e4f1847f6ef06081c9c819e3dfa3ec8cf1546d23ab3ab929db870"],
      "cells": ["069ee0341eb65443eeb0d47f7db0534d5c6c7889caf0ed665dfb5d29e999b9c2"],
      ...
    }
  }
}
```

**Key Points:**
- Each table has an **array** of allowed fingerprints
- Multiple fingerprints support backward-compatible schema evolution
- `table_version` ties fingerprints to DATABASE_TABLE_VERSION for management clarity
- No v2 until actual schema divergence is implemented

### Future Format (when v2 is needed)

```json
{
  "v1": {
    "table_version": "0.4",
    "tables": { ... }
  },
  "v2": {
    "table_version": "0.5",
    "tables": { ... }
  }
}
```

## Version Management

### Two Version Axes

1. **SCHEMA_VERSION** (`v1`, `v2`, ...) - Feature flag for schema set selection
   - Controlled by Cargo features: `schema_v1`, `schema_v2`
   - Embedded in Avro namespace: `fusou.v1`, `fusou.v2`
   - Used for major schema changes (breaking changes)

2. **DATABASE_TABLE_VERSION** (`"0.4"`, `"0.5"`, ...) - Semantic versioning
   - Defined in `schema_version.rs`
   - Embedded in fingerprints.json for management
   - Used for tracking table structure evolution

**Relationship:**
- Same SCHEMA_VERSION can have multiple TABLE_VERSIONs (patch updates)
- Different SCHEMA_VERSIONs should have different TABLE_VERSIONs (major updates)

## Schema Evolution Workflow

### Backward-Compatible Change (Add Optional Field)

1. **Modify Schema**
   ```rust
   // In kc-api-database/src/models/battle.rs
   pub struct Battle {
       // existing fields...
       #[serde(default)]
       pub new_optional_field: Option<String>,
   }
   ```

2. **Update TABLE_VERSION**
   ```rust
   // In kc-api-database/src/schema_version.rs
   pub const DATABASE_TABLE_VERSION: &str = "0.5"; // was "0.4"
   ```

3. **Regenerate Schemas**
   ```bash
   cd kc_api
   cargo run -p kc-api-database --bin print_schema --features schema_v1 > \
     ../packages/FUSOU-WORKFLOW/schemas/kc_api_v1.json
   ```

4. **Compute New Fingerprints**
   ```bash
   cd packages/FUSOU-WORKFLOW
   node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json > \
     schemas/fingerprints_new.json
   ```

5. **Merge Fingerprints** (Manual)
   ```javascript
   // Add new hash to existing hash array for backward compatibility
   {
     "v1": {
       "table_version": "0.5",
       "tables": {
         "battle": [
           "8446dac50a1e4f1847f6ef06081c9c819e3dfa3ec8cf1546d23ab3ab929db870", // old
           "new_hash_here" // new
         ]
       }
     }
   }
   ```

6. **Test**
   ```bash
   node test/test-kc-api-fingerprints.mjs
   node test/test-fingerprint-e2e.mjs
   ```

7. **Deploy**
   - Update `SCHEMA_FINGERPRINTS_JSON` environment variable in Cloudflare Workers
   - Both old and new schema files will be accepted

### Breaking Change (New Schema Version)

1. **Add v2 Feature Flag**
   ```toml
   # In kc-api-database/Cargo.toml
   [features]
   schema_v1 = []
   schema_v2 = []
   ```

2. **Create v2 Schemas**
   - Copy `models/` to `models_v2/`
   - Make breaking changes
   - Update `schema_version.rs` with conditional compilation

3. **Generate Both Versions**
   ```bash
   cargo run -p kc-api-database --bin print_schema --features schema_v1 > kc_api_v1.json
   cargo run -p kc-api-database --bin print_schema --features schema_v2 > kc_api_v2.json
   ```

4. **Compute Fingerprints**
   ```bash
   node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json schemas/kc_api_v2.json > \
     schemas/fingerprints.json
   ```

5. **Deploy with Migration Plan**
   - Phase 1: Deploy v2 writer + dual-version reader (accepts both v1 and v2)
   - Phase 2: Monitor data migration
   - Phase 3: Deprecate v1 (remove from fingerprints.json)

## Testing

### Unit Tests

```bash
# Verify fingerprint consistency
cd packages/FUSOU-WORKFLOW
node test/test-kc-api-fingerprints.mjs
```

### E2E Tests

```bash
# Verify validation workflow
node test/test-fingerprint-e2e.mjs
```

**Test Coverage:**
- ✅ Valid fingerprint accepted
- ✅ Invalid fingerprint rejected
- ✅ Wrong namespace rejected
- ✅ TABLE_VERSION consistency check

## Security Properties

1. **Cryptographic Integrity**: SHA-256 ensures schema tampering is detected
2. **Namespace Isolation**: `fusou.v1` vs `fusou.v2` prevents version confusion
3. **Allowlist Validation**: Only explicitly approved fingerprints are accepted
4. **Pre-commit Guard**: Catches forgotten version bumps before commit

## Troubleshooting

### "Schema fingerprint mismatch" Error

**Cause:** Data file schema doesn't match any allowed fingerprint

**Solutions:**
1. Check if schema was recently changed without updating fingerprints.json
2. Verify SCHEMA_FINGERPRINTS_JSON environment variable is up to date
3. Add backward-compatible fingerprint to allowed array

### "Schema namespace mismatch" Error

**Cause:** Data file has wrong namespace (e.g., `fusou.v2` when expecting `fusou.v1`)

**Solutions:**
1. Check schema_version parameter in reader query
2. Verify data was written with correct SCHEMA_VERSION
3. Update reader to accept multiple versions if needed

### Fingerprints.json Out of Sync

**Symptoms:**
- Test failures
- TABLE_VERSION mismatch warnings

**Fix:**
```bash
# Regenerate from source of truth
cd kc_api
cargo run -p kc-api-database --bin print_schema --features schema_v1 > \
  ../packages/FUSOU-WORKFLOW/schemas/kc_api_v1.json
cd ../packages/FUSOU-WORKFLOW
node scripts/compute-kc-api-fingerprints.mjs schemas/kc_api_v1.json > \
  schemas/fingerprints.json
node test/test-kc-api-fingerprints.mjs
```

## Maintenance

### Regular Tasks

- [ ] **After schema change**: Update TABLE_VERSION, regenerate schemas, update fingerprints
- [ ] **Before deploy**: Run both tests (`test-kc-api-fingerprints.mjs`, `test-fingerprint-e2e.mjs`)
- [ ] **Quarterly**: Review allowed fingerprint arrays; remove obsolete entries after data migration

### Files to Keep in Sync

1. `kc-api-database/src/schema_version.rs` (DATABASE_TABLE_VERSION)
2. `FUSOU-WORKFLOW/schemas/kc_api_v1.json` (generated schemas)
3. `FUSOU-WORKFLOW/schemas/fingerprints.json` (computed hashes)
4. Cloudflare Workers `SCHEMA_FINGERPRINTS_JSON` environment variable

## References

- Avro Specification: https://avro.apache.org/docs/current/spec.html
- Schema Fingerprints: https://avro.apache.org/docs/current/spec.html#Schema+Fingerprints
- SHA-256: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
