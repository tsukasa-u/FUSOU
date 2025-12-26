# Avro Schema Compatibility Audit Report

**Status**: ❌ **CRITICAL GAPS IDENTIFIED** - Implementation Incomplete  
**Date**: 2024-12-25  
**Severity**: HIGH  
**Impact**: v1/v2 schema compatibility is NOT actually implemented

---

## Executive Summary

The codebase has implemented **version TRACKING** (recording which version was used) but NOT **version COMPATIBILITY** (validating that different schemas actually work). This is a fundamental gap in the design.

### Key Findings
1. ✅ `schema_version` field added to D1 tables (buffer_logs, archived_files, block_indexes)
2. ✅ R2 paths correctly separate v1/v2 (e.g., `v1/202412/battle.avro` vs `v2/202412/battle.avro`)
3. ✅ TypeScript compilation passes
4. ❌ **v1 and v2 Avro schemas are IDENTICAL** - no schema differences defined
5. ❌ **Avro OCF block parsing is INCOMPLETE** - critical functions not implemented
6. ❌ **Schema compatibility validation MISSING** - no validation layer exists
7. ❌ **API path design is SUBOPTIMAL** - version in JSON body vs URL path
8. ❌ **DATABASE_TABLE_VERSION ↔ SCHEMA_VERSION relationship UNDEFINED**

---

## Problem 1: v1 and v2 Have No Schema Differences

### Current Implementation
**File**: `/packages/kc_api/crates/kc-api-database/src/schema_version.rs`

```rust
#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";
```

**The Problem**: This is JUST a constant string. The actual Avro schemas are identical.

### How Avro Schemas Are Generated
**File**: `/packages/kc_api/crates/kc-api-database/src/encode.rs`

```rust
pub fn encode<T>(datas: Vec<T>) -> Result<Vec<u8>, Error>
where
    T: TraitForEncode + AvroSchema + Serialize,
{
    let schema = T::get_schema();  // ← Schema derived from T's type definition
    let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Null);
    // ...
}
```

The schema comes from `#[derive(AvroSchema)]` on types in `/packages/kc_api/crates/kc-api-database/src/models/`

### Investigation
```bash
$ grep -r "#[cfg(feature" src/models/
# Result: NOTHING
```

**Conclusion**: There are NO conditional schema definitions for v1 vs v2. Both versions use the SAME PortTable structure.

---

## Problem 2: Avro OCF Block Parsing Is Not Implemented

**File**: `/packages/FUSOU-WORKFLOW/src/avro-manual.ts`

### Critical Missing Implementations

#### Function 1: `parseDeflateAvroBlock()`
```typescript
export function parseDeflateAvroBlock(header: Uint8Array, compressedBlock: Uint8Array): Promise<any[]> {
  // Implementation: decompress, then parse records
  throw new Error('Not implemented');
}
```

**Status**: ❌ **NOT IMPLEMENTED**  
**Called by**: [reader.ts:180](src/reader.ts#L180)

#### Function 2: `parseNullAvroBlock()`
```typescript
export function parseNullAvroBlock(header: Uint8Array, block: Uint8Array): any[] {
  // Uncompressed blocks: parse records directly
  throw new Error('Not implemented');
}
```

**Status**: ❌ **NOT IMPLEMENTED**  
**Called by**: [reader.ts:180](src/reader.ts#L180)

### Impact
reader.ts calls these functions but they throw exceptions immediately:
```typescript
// reader.ts:180-190
export async function deserializeAvroBlock(
  data: ArrayBuffer,
  schemaVersion?: string
): Promise<any[]> {
  // ... codec detection ...
  if (codec === 'deflate') {
    return await parseDeflateAvroBlock(header, compressedBlock);  // THROWS
  } else {
    return parseNullAvroBlock(header, uncompressedBlock);  // THROWS
  }
}
```

**This means: NO Avro data can be deserialized from R2**

---

## Problem 3: Schema Compatibility Validation Missing

### What's NOT Implemented

#### 1. No Avro Schema Validation
**Missing**: Check if incoming Avro data matches declared schema_version

```typescript
// MISSING: Avro schema validation
async function validateAvroSchemaVersion(data: Uint8Array, declaredVersion: string) {
  // Extract actual Avro schema from OCF header
  // Compare with expected schema for declaredVersion
  // Throw if mismatch
  // ❌ NOT IMPLEMENTED
}
```

#### 2. No Codec Version Mapping
**Missing**: Define which codec is used by each schema version

```rust
// MISSING: Codec negotiation
enum CodecVersion {
  V1 { codec: Codec::Deflate },
  V2 { codec: Codec::Snappy },  // Hypothetical
}
```

#### 3. No Schema Evolution Handling
**Missing**: How to handle schema changes (new fields in v2)

```rust
// MISSING: Schema compatibility matrix
// - Can v1 reader decode v2 data (with new fields)?
// - Can v2 reader decode v1 data (missing new fields)?
// - What's the upgrade path?
```

#### 4. No Client-Side Validation
**Missing**: Tauri app should validate schema_version before upload

**File**: `/packages/FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs`

```rust
// Current: Just sends schema_version without validation
pub async fn upload(buffer: Vec<u8>, dataset: String, table: String) -> Result<()> {
  // ✅ Sends schema_version
  // ❌ No validation that buffer actually matches this schema_version
}
```

---

## Problem 4: API Path Design is Suboptimal

### Current Design
```
POST /battle-data/upload
Content-Type: application/json

{
  "schema_version": "v1",
  "data": "..."
}
```

**Issues**:
1. Version in JSON body makes routing harder
2. Can't cache different versions easily
3. Not RESTful (version should be in path)

### Proposed Design
```
POST /v1/battle-data/upload
Content-Type: application/octet-stream

[Avro OCF binary data]
```

**Benefits**:
1. Version in URL path (standard REST)
2. Cleaner routing: different handlers for `/v1/*` vs `/v2/*`
3. Better caching (version in path)
4. Schema_version can be inferred from path, not extracted from body

---

## Problem 5: DATABASE_TABLE_VERSION ↔ SCHEMA_VERSION Relationship Undefined

### Current State
**File**: `/packages/kc_api/crates/kc-api-database/src/schema_version.rs`

```rust
pub const DATABASE_TABLE_VERSION: &str = "0.4";  // KanColle game version
pub const SCHEMA_VERSION: &str = "v1";            // Avro format version
```

### Unclear Scenarios

#### Scenario 1: When game version changes (0.4 → 0.5)
- Does v1 Avro schema change?
- Or does schema stay the same?
- If schema changes, is it a v1→v2 migration?

#### Scenario 2: When Avro format changes (v1 → v2)
- Must game data structure change?
- Can they be independent?

#### Scenario 3: Multiple game versions with same Avro schema
```
DATABASE_TABLE_VERSION: 0.4 + SCHEMA_VERSION: v1 ✅
DATABASE_TABLE_VERSION: 0.5 + SCHEMA_VERSION: v1 ✅ (compatible?)
DATABASE_TABLE_VERSION: 0.5 + SCHEMA_VERSION: v2 ✅ (new format for 0.5)
```

**Question**: Can old client (v1) read data from new game (0.5) with v1 schema?

---

## Code Archaeology: Where v1/v2 Should Differ

### 1. Model Definitions
**File**: `/packages/kc_api/crates/kc-api-database/src/models/`

Expected pattern (NOT FOUND):
```rust
#[derive(Serialize, Deserialize, AvroSchema)]
#[cfg(feature = "schema_v1")]
pub struct Battle {
    pub id: i32,
    pub api_name: String,
    // v1 fields
}

#[derive(Serialize, Deserialize, AvroSchema)]
#[cfg(feature = "schema_v2")]
pub struct Battle {
    pub id: i32,
    pub api_name: String,
    pub api_new_field: Option<String>,  // v2 adds new field
}
```

**Actual State**: 🔍 No `#[cfg(feature = "schema_v")]` found in models

### 2. Codec Version Mapping
**File**: `/packages/FUSOU-WORKFLOW/src/cron.ts`

Expected pattern (NOT FOUND):
```typescript
const codecByVersion = {
  v1: 'deflate',
  v2: 'snappy',
};
```

**Actual State**: Codec is hardcoded in cron.ts without version awareness

### 3. Avro Header Parsing
**File**: `/packages/FUSOU-WORKFLOW/src/avro-manual.ts`

Expected pattern (PARTIAL):
```typescript
export function getAvroHeaderLengthFromPrefix(data: Uint8Array): {
  length: number;
  codec: string;
  schema: string;  // ← Should parse and validate
} {
  // Currently: Just returns length
  // Should: Return codec AND schema, validate schema version
}
```

---

## Verification Matrix

| Aspect | Implemented | Verified | Notes |
|--------|-------------|----------|-------|
| schema_version column in D1 | ✅ | ⚠️ Schema identical v1↔v2 |
| R2 path separation | ✅ | ✅ Correctly separates versions |
| Avro OCF parsing | ❌ | ❌ Functions throw immediately |
| Schema validation | ❌ | N/A | No validation exists |
| Codec negotiation | ❌ | N/A | Hardcoded Codec::Null |
| Client-side validation | ❌ | N/A | No checks before upload |
| API path design | ⚠️ | ❌ Should be in URL path |
| DATABASE_TABLE_VERSION sync | ❌ | N/A | Relationship undefined |

---

## Impact Assessment

### Current State: What Works
- ✅ schema_version is tracked in database
- ✅ R2 paths separate by version
- ✅ TypeScript compiles

### Current State: What Doesn't Work
- ❌ **Cannot deserialize Avro data** (parseDeflateAvroBlock not implemented)
- ❌ **Cannot validate schema compatibility** (no validation logic)
- ❌ **Different schemas not actually supported** (v1 === v2)
- ❌ **No codec version handling** (always Null codec)
- ❌ **API design not optimal** (version in body, not path)

### Production Readiness
**Current**: ❌ **NOT READY**

The system has the tracking infrastructure but is missing the actual compatibility layer. Attempting to deserialize any Avro data from R2 will fail.

---

## Recommended Actions

### Phase 1: Define Schema Differences (Required)
1. [ ] Create v1 Avro schema definition (document current structure)
2. [ ] Create v2 Avro schema definition (define what changes)
3. [ ] Document schema compatibility rules (breaking vs compatible changes)
4. [ ] Update models with `#[cfg(feature = "schema_v")]` guards

### Phase 2: Implement Parsing (Critical)
1. [ ] Implement `parseDeflateAvroBlock()` - decompress + parse
2. [ ] Implement `parseNullAvroBlock()` - parse records directly
3. [ ] Add schema validation in `deserializeAvroBlock()`
4. [ ] Test with actual Avro OCF files from R2

### Phase 3: Codec & Validation (Important)
1. [ ] Define codec mapping for each schema version
2. [ ] Add codec negotiation logic
3. [ ] Implement schema compatibility checks
4. [ ] Add validation in encode.rs when creating Avro data

### Phase 4: API Redesign (Optimization)
1. [ ] Refactor API to include version in URL path
2. [ ] Update client and server routing
3. [ ] Improve caching strategy

### Phase 5: Database Synchronization (Clarification)
1. [ ] Document DATABASE_TABLE_VERSION ↔ SCHEMA_VERSION rules
2. [ ] Define migration paths (0.4→0.5 handling)
3. [ ] Add versioning tests

---

## Files Requiring Changes

### Rust Crates
- [ ] `/packages/kc_api/crates/kc-api-database/src/schema_version.rs` - Add schema definitions
- [ ] `/packages/kc_api/crates/kc-api-database/src/models/*.rs` - Add conditional schemas
- [ ] `/packages/kc_api/crates/kc-api-database/src/encode.rs` - Add schema_version validation
- [ ] `/packages/kc_api/crates/kc-api-database/src/decode.rs` - Add schema validation

### TypeScript/Node
- [ ] `/packages/FUSOU-WORKFLOW/src/avro-manual.ts` - Implement parsers
- [ ] `/packages/FUSOU-WORKFLOW/src/reader.ts` - Add schema validation
- [ ] `/packages/FUSOU-WORKFLOW/src/cron.ts` - Add codec version handling

### Tauri App
- [ ] `/packages/FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs` - Validate schema before upload
- [ ] `/packages/FUSOU-APP/src-tauri/src/api/mod.rs` - Update API path structure

---

## References
- KanColle API: [kc_api interface definition](../kc_api)
- Avro Format: [Apache Avro OCF Spec](https://avro.apache.org/docs/current/)
- Current Schema Version: [schema_version.rs](../kc_api/crates/kc-api-database/src/schema_version.rs)

---

**Next Step**: Start with **Phase 1** - Define v1 and v2 schema differences
