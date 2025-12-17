# Table Offset Metadata for Compaction

## Overview

Battle data fragments uploaded to R2 contain **concatenated Parquet files** with multiple tables. To enable efficient compaction and table-specific extraction, we store offset metadata alongside each fragment.

## Data Structure

### Client Side (FUSOU-APP)

When uploading, the client sends:

```json
{
  "dataset_id": "user_env_id_uuid",
  "table": "port_table",
  "kc_period_tag": "2025-11-05",
  "file_size": "123456",
  "content_hash": "sha256_hex",
  "table_offsets": "[{\"table_name\":\"api_port\",\"start_byte\":0,\"byte_length\":50000,\"format\":\"parquet\"},{\"table_name\":\"api_ship\",\"start_byte\":50000,\"byte_length\":30000,\"format\":\"parquet\"}]"
}
```

### Server Side (D1 battle_files)

```sql
INSERT INTO battle_files (
  key, dataset_id, "table", period_tag,
  size, etag, uploaded_at, content_hash, uploaded_by,
  table_offsets  -- JSON string
) VALUES (...);
```

## Compaction Implementation

### Step 1: Fetch Fragment Metadata

```typescript
const fragments = await indexDb.prepare(
  `SELECT key, table_offsets FROM battle_files 
   WHERE dataset_id = ? AND period_tag = ?`
).bind(datasetId, periodTag).all();
```

### Step 2: Extract Specific Table from Each Fragment

```typescript
for (const frag of fragments.results) {
  const offsets = JSON.parse(frag.table_offsets);
  
  // Find the target table offset
  const targetTable = offsets.find(o => o.table_name === 'api_port');
  
  if (!targetTable) {
    console.warn(`Table api_port not found in fragment ${frag.key}`);
    continue;
  }
  
  // Use R2 Range request to read only the target table
  const r2Response = await bucket.get(frag.key, {
    range: {
      offset: targetTable.start_byte,
      length: targetTable.byte_length
    }
  });
  
  const tableParquet = await r2Response.arrayBuffer();
  
  // Now `tableParquet` is a pure Parquet file for `api_port`
  // Ready for merging with other fragments of the same table
}
```

### Step 3: Merge Parquet Files

Use DataFusion or Arrow to merge:

```typescript
const mergedParquet = await mergeParquetFiles(parquetFragments);
```

### Step 4: Upload Compacted File

```typescript
const compactedKey = `compact/per_user/${datasetId}/api_port/${periodTag}/${timestamp}.parquet`;
await bucket.put(compactedKey, mergedParquet);
```

## Benefits

1. **Memory Efficiency**: Only read the needed table from R2 (Range request)
2. **Network Efficiency**: Avoid downloading entire concatenated file
3. **Correctness**: Ensure each table is processed independently
4. **Scalability**: Support arbitrary number of tables per fragment

## Example: Global Compaction with Offsets

For global compaction (all users):

```typescript
// Fetch all fragments for a period/table across all datasets
const fragments = await indexDb.prepare(
  `SELECT key, table_offsets FROM battle_files 
   WHERE period_tag = ? AND "table" = ?`
).bind(periodTag, 'port_table').all();

// Extract target table from each fragment using offsets
const tableFragments = [];
for (const frag of fragments.results) {
  const offsets = JSON.parse(frag.table_offsets);
  const targetTable = offsets.find(o => o.table_name === tableName);
  
  if (targetTable) {
    const r2Response = await bucket.get(frag.key, {
      range: { offset: targetTable.start_byte, length: targetTable.byte_length }
    });
    tableFragments.push(await r2Response.arrayBuffer());
  }
}

// Merge all fragments
const globalMerged = await mergeParquetFiles(tableFragments);

// Upload to global path
const globalKey = `compact/global/${tableName}/${periodTag}/${timestamp}.parquet`;
await bucket.put(globalKey, globalMerged);
```

## Migration

For existing fragments without `table_offsets`:

1. Treat as legacy single-table fragments
2. Download entire file (no Range request)
3. Log warning for monitoring

```typescript
if (!frag.table_offsets) {
  console.warn(`Legacy fragment without offset metadata: ${frag.key}`);
  const fullFile = await bucket.get(frag.key);
  // Process as single Parquet
}
```

## Validation

After implementation, verify:

1. ✅ Client sends `table_offsets` in handshake
2. ✅ Server stores `table_offsets` in D1
3. ✅ Compaction uses offsets for Range requests
4. ✅ Merged Parquet files are valid (schema check)
