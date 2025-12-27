# Production Monitoring and Logging Strategy
**Date:** 2025-12-26
**Purpose:** Detect schema version issues before they cause failures

## 1. Application-Level Logging

### FUSOU-WORKFLOW/src/cron.ts

```typescript
// Enhanced logging for schema version tracking
export async function handleCron(env: Env): Promise<void> {
  try {
    const rows = await fetchBufferedData(env.BATTLE_INDEX_DB);
    if (!rows.length) {
      console.log('[Archival] No data to archive');
      return;
    }

    // NEW: Log schema version distribution
    const versionDistribution = new Map<string, number>();
    for (const row of rows) {
      const v = row.schema_version || 'NULL';
      versionDistribution.set(v, (versionDistribution.get(v) ?? 0) + 1);
    }
    
    console.log('[Archival] Version distribution:', 
      Object.fromEntries(versionDistribution)
    );
    
    // Log any NULL occurrences
    const nullCount = rows.filter(r => !r.schema_version).length;
    if (nullCount > 0) {
      console.warn(
        `[ALERT] Found ${nullCount} rows with NULL schema_version! ` +
        `This should not happen after migration.`
      );
    }

    const maxId = Math.max(...rows.map(r => r.id));
    const groups = groupByDataset(rows);

    let totalFiles = 0;
    let totalBytes = 0;
    let totalDatasets = 0;
    const versionsSeen = new Set<string>();

    // Process each group with enhanced logging
    for (const group of groups) {
      if (!group.blocks.length) continue;
      
      versionsSeen.add(group.key.schema_version);
      
      console.debug(
        `[Archival] Processing group: ` +
        `schema_version=${group.key.schema_version}, ` +
        `table=${group.key.table_name}, ` +
        `period=${group.key.period_tag}, ` +
        `blocks=${group.blocks.length}`
      );
      
      // ... rest of cron logic ...
      
      // After upload, log R2 path and metadata
      const filePath = generateFilePath(...);
      console.info(
        `[Archival] Uploaded file: path=${filePath}, ` +
        `size=${chunk.size}, ` +
        `schema_version=${group.key.schema_version}`
      );
    }
    
    console.info(
      `[Archival Complete] ` +
      `Files=${totalFiles}, ` +
      `Datasets=${totalDatasets}, ` +
      `Bytes=${totalBytes}, ` +
      `Versions=[${Array.from(versionsSeen).join(',')}]`
    );
    
  } catch (error) {
    console.error('[Archival Error]', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
```

### FUSOU-WORKFLOW/src/reader.ts

```typescript
async function handleRead(request: Request, env: Env): Promise<Response> {
  const params = parseParams(request);
  
  // Log read request with version preference
  console.debug('[Reader] Query:', {
    dataset_id: params.dataset_id,
    table_name: params.table_name,
    schema_version: params.schema_version || 'any',
    time_range: params.from && params.to ? 
      `${params.from}-${params.to}` : 'all'
  });
  
  try {
    const hotData = await fetchHotData(env.BATTLE_INDEX_DB, params);
    const coldIndexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
    
    // Log version distribution in result
    const hotVersions = new Set(hotData.map(r => r.schema_version));
    const coldVersions = new Set(coldIndexes.map(b => b.schema_version));
    
    console.info('[Reader] Data distribution:', {
      hot_records: hotData.length,
      hot_versions: Array.from(hotVersions),
      cold_blocks: coldIndexes.length,
      cold_versions: Array.from(coldVersions)
    });
    
    // Warn if versions are mixed unexpectedly
    if (hotVersions.size > 1 || coldVersions.size > 1) {
      console.warn('[Reader] Multiple schema versions detected - this is OK during migration');
    }
    
    // ... rest of reader logic ...
  } catch (error) {
    console.error('[Reader Error]', {
      message: error instanceof Error ? error.message : String(error),
      params: params,
    });
    throw error;
  }
}
```

## 2. Database Monitoring Queries

### Hourly: Version Distribution Check

```sql
-- Query for monitoring dashboard
SELECT 
  'buffer_logs' as table_name,
  schema_version,
  COUNT(*) as record_count,
  MIN(timestamp) as oldest_record,
  MAX(timestamp) as newest_record
FROM buffer_logs
WHERE created_at > datetime('now', '-1 hour')
GROUP BY schema_version
UNION ALL
SELECT 
  'archived_files',
  schema_version,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM archived_files
WHERE created_at > datetime('now', '-1 hour')
GROUP BY schema_version;
```

### Daily: Integrity Check

```sql
-- Check for NULL values (should be 0)
SELECT 
  SUM(CASE WHEN schema_version IS NULL THEN 1 ELSE 0 END) as null_count
FROM (
  SELECT schema_version FROM buffer_logs
  UNION ALL
  SELECT schema_version FROM archived_files
  UNION ALL
  SELECT schema_version FROM block_indexes
);
```

### Weekly: Path vs. Schema Version Consistency

```sql
-- Detect path/schema_version mismatches
-- e.g., file_path="v1/..." but schema_version="v2"
SELECT COUNT(*) as mismatches
FROM archived_files
WHERE 
  (SUBSTR(file_path, 1, 2) = 'v1' AND schema_version != 'v1') OR
  (SUBSTR(file_path, 1, 2) = 'v2' AND schema_version != 'v2');
  
-- Should always be 0
```

## 3. Alert Conditions

### Critical Alerts
```
1. NULL schema_version detected
   - Threshold: > 0
   - Action: Check if migration was applied correctly
   - Severity: CRITICAL

2. Path/Version mismatch
   - Threshold: > 0
   - Action: Data integrity issue, investigate immediately
   - Severity: CRITICAL

3. Reader fails on version filtering
   - Pattern: "schema_version column not found"
   - Action: Check if D1 migration was applied
   - Severity: CRITICAL
```

### Warning Alerts
```
1. Unexpected version in production
   - Pattern: schema_version != 'v1' during v1-only phase
   - Action: Check if new app was deployed early
   - Severity: WARNING

2. Large version distribution spread
   - Pattern: > 90 days with only v1
   - Action: Normal, but monitor for unusual patterns
   - Severity: INFO (not an alert)
```

## 4. Logging Checklist

### Before Going to Production

- [ ] Enable structured logging in cron.ts
  ```typescript
  export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
  ```

- [ ] Enable structured logging in reader.ts
  ```typescript
  const reader_debug = process.env.READER_DEBUG === 'true';
  ```

- [ ] Configure CloudFlare Workers analytics
  ```toml
  # wrangler.toml
  [analytics]
  enabled = true
  ```

- [ ] Set up D1 query logging (if available)
  ```bash
  npx wrangler d1 execute dev_kc_battle_index --remote \
    'PRAGMA query_only = true;' # or appropriate logging command
  ```

- [ ] Configure alerts in monitoring system
  - Datadog / New Relic / CloudFlare Analytics Engine
  - Alert on NULL schema_version
  - Alert on version mismatch

### Day-1 Post-Production

- [ ] Monitor first hour of logs
  ```bash
  tail -f cloudflare-worker-logs.txt | grep schema_version
  ```

- [ ] Check version distribution
  ```sql
  SELECT schema_version, COUNT(*) FROM buffer_logs GROUP BY schema_version;
  ```

- [ ] Verify no NULL values
  ```sql
  SELECT COUNT(*) FROM buffer_logs WHERE schema_version IS NULL;
  ```

### Ongoing Monitoring (Daily)

- [ ] Run daily integrity check query
- [ ] Check log aggregation for errors
- [ ] Monitor reader response times (should not change)
- [ ] Spot-check R2 object metadata

## 5. Log Format Specification

### Standard Log Entry
```json
{
  "timestamp": "2025-12-26T10:30:45.123Z",
  "level": "info",
  "service": "FUSOU-WORKFLOW",
  "operation": "cron|reader|buffer-consumer",
  "message": "Schema version tracking",
  "data": {
    "schema_version": "v1",
    "count": 150,
    "duration_ms": 245,
    "error": null
  }
}
```

### Error Log Entry
```json
{
  "timestamp": "2025-12-26T10:30:45.123Z",
  "level": "error",
  "service": "FUSOU-WORKFLOW",
  "operation": "reader",
  "message": "Failed to read block",
  "error": {
    "type": "R2 Range Request Failed",
    "code": "NoSuchKey",
    "path": "v2/2025-12/battle-001.avro",
    "schema_version": "v2"
  }
}
```

## 6. Troubleshooting Guide

### Symptom: "schema_version column not found" Error

```
Likely Cause: D1 migration not applied
Fix:
1. Check if ALTER TABLE was executed
   PRAGMA table_info(buffer_logs);
2. If missing, apply migration
   npx wrangler d1 execute prod_db --file=migrations/add_schema_version.sql
3. Redeploy FUSOU-WORKFLOW
```

### Symptom: All new data has schema_version=NULL

```
Likely Cause: Default value not working or app not specifying version
Fix:
1. Check DEFAULT in schema
   PRAGMA table_info(buffer_logs);
   (should show: DEFAULT 'v1')
2. Check app code
   - buffer-consumer.ts: schemaVersion || 'v1'
   - cron.ts: Always passes schema_version
3. If DEFAULT missing, run:
   ALTER TABLE buffer_logs ADD CONSTRAINT check_version 
   CHECK (schema_version IS NOT NULL);
```

### Symptom: Path/Version Mismatch Detected

```
Example:
  archived_files.file_path = "v1/2025-12/battle-001.avro"
  archived_files.schema_version = "v2"

Investigation:
1. Query the specific file
   SELECT * FROM archived_files WHERE file_path = 'v1/2025-12/battle-001.avro';
2. Check when it was created
3. Check cron logs from that time
4. If recent, might be race condition in cron
5. If old, might be manual edit or bug

Fix:
1. Update the column to match
   UPDATE archived_files SET schema_version='v1' 
   WHERE file_path LIKE 'v1/%' AND schema_version != 'v1';
2. Verify R2 object still exists and is readable
3. Test reader on affected file
```

### Symptom: Reader returns mix of v1 and v2 data

```
Expected behavior during migration:
- This is OK and expected
- Reader should handle both versions

If this is NOT expected:
1. Check reader.ts query
   - Was schema_version filtering removed by accident?
2. Check if v2 app was deployed when it shouldn't be
3. Check logs for version distribution
```

## 7. Automation: Health Check Script

```typescript
// scripts/version-health-check.ts
import { D1Database } from "@cloudflare/workers-types";

export async function checkVersionHealth(db: D1Database): Promise<void> {
  console.log('=== Schema Version Health Check ===');
  
  // Check 1: NULL values
  const nullCount = await db.prepare(
    `SELECT COUNT(*) as cnt FROM buffer_logs WHERE schema_version IS NULL`
  ).first<{ cnt: number }>();
  
  if (nullCount?.cnt! > 0) {
    console.error(`❌ CRITICAL: Found ${nullCount.cnt} NULL schema_version values`);
  } else {
    console.log('✓ No NULL schema_version values');
  }
  
  // Check 2: Distribution
  const distribution = await db.prepare(
    `SELECT schema_version, COUNT(*) as cnt FROM buffer_logs 
     GROUP BY schema_version`
  ).all();
  
  console.log('Version distribution:', distribution.results);
  
  // Check 3: Path/Version mismatch
  const mismatches = await db.prepare(
    `SELECT COUNT(*) as cnt FROM archived_files 
     WHERE SUBSTR(file_path, 1, 2) != schema_version`
  ).first<{ cnt: number }>();
  
  if (mismatches?.cnt! > 0) {
    console.error(`❌ CRITICAL: Found ${mismatches.cnt} path/version mismatches`);
  } else {
    console.log('✓ No path/version mismatches');
  }
  
  // Check 4: Indices
  const indexStatus = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' 
     AND name LIKE '%schema%'`
  ).all();
  
  console.log('Schema version indices:', indexStatus.results?.length ?? 0);
  
  console.log('=== Health Check Complete ===');
}
```
