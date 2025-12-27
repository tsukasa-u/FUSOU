# Version Integration Test Scenarios
**Date:** 2025-12-26
**Purpose:** Comprehensive testing of version handling in production scenarios

## Scenario 1: Version Mismatch in Buffer

### Test Case 1-1: v1 and v2 Data Mixed in Hot Storage
```
Setup:
  - Old app (FUSOU-APP v1.0) uploading with SCHEMA_VERSION="v1"
  - New app (FUSOU-APP v2.0) uploading with SCHEMA_VERSION="v2"
  - Both writing to same D1 buffer_logs table

Expected Behavior:
  ✓ buffer_logs.schema_version correctly records "v1" or "v2"
  ✓ cron worker groups by (schema_version, table_name, period_tag)
  ✓ v1 blocks uploaded to R2 path: v1/2025-12/battle-001.avro
  ✓ v2 blocks uploaded to R2 path: v2/2025-12/battle-001.avro
  ✓ block_indexes correctly record schema_version for each block

Test Steps:
  1. INSERT buffer_logs with schema_version='v1' (simulate old app)
  2. INSERT buffer_logs with schema_version='v2' (simulate new app)
  3. Run handleCron()
  4. Verify R2 objects exist in both v1/ and v2/ folders
  5. Verify D1 archived_files has correct schema_version for each file
  6. Verify D1 block_indexes has correct schema_version for each block
```

### Test Case 1-2: v1 Default Handling
```
Setup:
  - Legacy data uploaded before schema_version tracking
  - New code inserts with DEFAULT 'v1'

Expected Behavior:
  ✓ Old records without explicit schema_version become 'v1'
  ✓ Reader can handle mixed records (some v1 explicit, some v1 default)

Test Steps:
  1. Manually INSERT into buffer_logs WITHOUT specifying schema_version
  2. Verify schema_version defaults to 'v1'
  3. Run handleCron() with mixed records
  4. Verify cron processes both correctly
```

## Scenario 2: DATABASE_TABLE_VERSION and SCHEMA_VERSION Correlation

### Test Case 2-1: env_info Version Field
```
Setup:
  - FUSOU-APP encodes PortTable with env_info
  - env_info.version = DATABASE_TABLE_VERSION = "0.4"
  - Upload includes schema_version: "v1"

Expected Behavior:
  ✓ D1 buffer_logs.schema_version = "v1" (Avro format)
  ✓ Avro payload contains env_info.version = "0.4" (game data)
  ✓ These are independent and don't conflict

Data Flow:
  Client (Avro):
    schema_version: "v1" ← from SCHEMA_VERSION
    [Avro binary with env_info.version="0.4" inside]
  ↓
  D1 buffer_logs:
    schema_version: "v1"
    data: [Avro binary]
  ↓
  Reader:
    Reads schema_version to find file location
    Decodes Avro to get env_info.version

Test Steps:
  1. Inspect uploaded Avro binary structure
  2. Verify schema_version is in buffer_logs
  3. Verify env_info.version is in Avro payload
  4. Confirm they're independent
```

## Scenario 3: Migration Edge Cases

### Test Case 3-1: Partial Column Migration
```
Setup:
  - Old D1 records: archived_files.schema_version = NULL
  - New D1 records: archived_files.schema_version = 'v1'
  - Old D1 records: block_indexes.schema_version = NULL
  - New D1 records: block_indexes.schema_version = 'v1'

Expected Behavior:
  ✓ Reader can handle NULL schema_version (treat as 'v1')
  ✓ Queries work with WHERE schema_version IS NOT NULL OR schema_version = 'v1'
  ✓ Cron inserts always include schema_version

Issue to Check:
  ✗ Do indices work correctly with NULL?
  ✗ Can we distinguish NULL from 'v1'?

Test Steps:
  1. INSERT archived_files without schema_version (NULL)
  2. INSERT archived_files with schema_version='v1'
  3. Query both types - verify results
  4. Check index usage in query plan
  5. Add schema_version to NULL records and verify consistency
```

### Test Case 3-2: R2 Path vs D1 Mismatch
```
Setup:
  - R2 file path: "v2/2025-12/battle-001.avro"
  - D1 archived_files.file_path: "v2/2025-12/battle-001.avro"
  - D1 archived_files.schema_version: NULL or "v1" (mismatch!)

Expected Behavior:
  ✗ Reader detects version from file_path
  ✗ But block_indexes doesn't have schema_version
  → Cannot determine correct Avro decoder

Issue:
  This breaks the system when v2 requires different decoder

Test Steps:
  1. Manually create mismatch scenario
  2. Try to read data with Reader
  3. Verify it fails or uses correct schema based on path
  4. Check if file_path parsing is robust enough
```

## Scenario 4: Reader Validation

### Test Case 4-1: Hot Data Reader with schema_version
```
Setup:
  - buffer_logs has records with different schema_version values
  - Reader.fetchHotData() includes timestamp range filter

Expected Behavior:
  ✓ Reader should optionally filter by schema_version
  ✓ Currently ignores schema_version in SELECT - is this intentional?
  ✓ For v1-only system, this is OK. For v2, need version awareness

Check:
  - Should QueryParams have optional schema_version?
  - Should fetchHotData filter by schema_version?
  - What happens when reader.ts is asked for data that's v2?

Test Steps:
  1. Inspect reader.ts QueryParams definition
  2. Check if schema_version parameter exists
  3. If not, add it and verify behavior
  4. Test with mixed v1/v2 data
```

### Test Case 4-2: Cold Data Reader with schema_version
```
Setup:
  - block_indexes has multiple records for same (dataset_id, table_name, time_range)
    but different schema_version

Current Code:
  ```typescript
  SELECT ... FROM block_indexes bi
  JOIN archived_files af ON bi.file_id = af.id
  WHERE bi.dataset_id = ? AND bi.table_name = ?
  ```

Expected Behavior:
  ✓ Should also include schema_version in WHERE clause
  ✓ Or should return all versions and let caller decide?

Issue:
  - If v1 and v2 have different Avro structures
  - Reader needs to know which version to use
  - Currently no way to specify version preference

Test Steps:
  1. Add v2 schema_version to test data
  2. Query with current reader code
  3. Verify it returns all versions
  4. Test if Avro decoder can handle both
  5. If not, add version filtering to query
```

## Scenario 5: Default Values and NULL Handling

### Test Case 5-1: DEFAULT 'v1' Effectiveness
```
Setup:
  - D1 schema has DEFAULT 'v1' on schema_version columns
  - Application sometimes forgets to provide value
  - Feature flag might not be set correctly

Expected Behavior:
  ✓ DEFAULT 'v1' catches missing values
  ✓ Prevents NULL pollution
  ✓ Allows backward compatibility

Test Steps:
  1. INSERT into buffer_logs without schema_version
  2. Verify automatically becomes 'v1'
  3. INSERT into archived_files without schema_version
  4. Verify automatically becomes 'v1'
  5. INSERT into block_indexes without schema_version
  6. Verify automatically becomes 'v1'
  7. Query COUNT WHERE schema_version = 'v1' - all should be there
```

### Test Case 5-2: NULL vs Empty String vs Wrong Value
```
Setup:
  - Defensive programming: what if someone inserts wrong value?
  - What if feature flag is wrong?

Current Vulnerability:
  ✗ No validation that schema_version ∈ {'v1', 'v2'}
  ✗ Could insert 'v3', 'v0', '', NULL
  ✗ Reader doesn't validate before using

Test Steps:
  1. Try INSERT with schema_version='v3'
  2. Try INSERT with schema_version=''
  3. Try INSERT with schema_version='invalid'
  4. Verify system behavior (should succeed without validation)
  5. Propose: Add CHECK constraint or application-level validation
```

## Scenario 6: Concurrent Operations

### Test Case 6-1: Simultaneous v1 and v2 Uploads
```
Setup:
  - Two apps uploading simultaneously
  - App 1: SCHEMA_VERSION="v1"
  - App 2: SCHEMA_VERSION="v2"
  - Both hit cron at same time

Expected Behavior:
  ✓ Cron correctly groups by schema_version
  ✓ No data corruption
  ✓ Both versions uploaded correctly

Test Steps:
  1. Simulate parallel uploads with different versions
  2. Run cron concurrently (if stateless)
  3. Verify R2 files have correct paths
  4. Verify D1 records are consistent
  5. No data loss or duplication
```

### Test Case 6-2: Reader During Active Migration
```
Setup:
  - User tries to read while cron is running
  - Some data still in buffer_logs
  - Some data moved to archived_files

Expected Behavior:
  ✓ Reader correctly merges hot + cold
  ✓ No duplicate records
  ✓ Time ranges are correct
  ✓ schema_version doesn't affect correctness

Test Steps:
  1. Create scenario with partial archival
  2. Concurrent: Run reader while cron is mid-execution
  3. Verify data consistency
  4. Check for timing issues
```

## Scenario 7: Production Monitoring Points

### Test Case 7-1: Version Distribution Monitoring
```
Metrics to Track:
  ✓ COUNT(buffer_logs) GROUP BY schema_version, table_name, period_tag
  ✓ COUNT(archived_files) GROUP BY schema_version
  ✓ COUNT(block_indexes) GROUP BY schema_version
  ✓ Time distribution: when did schema_version change?

Query for Monitoring:
  ```sql
  SELECT schema_version, COUNT(*) as count, MIN(timestamp) as earliest
  FROM buffer_logs
  GROUP BY schema_version, table_name
  ORDER BY earliest DESC;
  ```

What to Look For:
  - Sudden drop in one version (might indicate app rollback)
  - Mix of versions (concurrent deployments)
  - NULL counts (indicates migration incomplete)
```

### Test Case 7-2: Version Mismatch Detection
```
Query:
  ```sql
  SELECT COUNT(*) as mismatches
  FROM archived_files af
  WHERE (af.schema_version IS NULL OR af.schema_version != 'v1')
    AND af.file_path LIKE 'v1/%';
  ```

Alerts:
  - If mismatches > 0: Log schema version corruption
  - If NULL count > 0: Migration incomplete
  - If version != path_prefix: Data integrity issue
```

## Testing Implementation

Each test case should:
1. Set up test data
2. Execute scenario
3. Verify with SQL queries
4. Check R2 objects (if using test R2)
5. Document results

Priority Order:
1. **Critical**: 1-1, 2-1, 4-2 (basic functionality)
2. **High**: 1-2, 3-1, 5-1 (edge cases)
3. **Medium**: 3-2, 5-2, 6-1 (robustness)
4. **Low**: 4-1, 6-2, 7-1, 7-2 (monitoring)
