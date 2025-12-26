# Migration Edge Cases and Risks
**Date:** 2025-12-26
**Severity:** CRITICAL for v1→v2 migration

## Scenario 1: Partial Column Migration (Deployment Order Matters)

### Deployment Order A (CORRECT)
```
1. Deploy FUSOU-WORKFLOW with new cron.ts (schema_version 対応)
   - cron.ts が schema_version をアップロード開始
   
2. Apply D1 migration: ALTER TABLE ... ADD COLUMN schema_version DEFAULT 'v1'
   - 既存アーカイブデータに schema_version='v1' が割り当てられる
   - 新規データもデフォルト 'v1'
   
3. Deploy reader.ts 更新
   - schema_version を取得・フィルタ可能

Result: ✓ Safe
- 古いアーカイブも新規アーカイブも schema_version を持つ
- reader が NULL を処理する必要なし
```

### Deployment Order B (DANGEROUS)
```
1. Apply D1 migration だけ先に実行
   - ALTER TABLE adds schema_version DEFAULT 'v1'
   - 既存: schema_version='v1'
   
2. Deploy FUSOU-WORKFLOW (スキーマ対応なし)
   - cron.ts: registerArchivedFile() に schema_version パラメータなし
   - → archived_files に NULL が入る可能性
   
3. Deploy 新 reader.ts
   - NULL 値が存在、クエリが複雑化

Result: ✗ Inconsistent state
```

### Deployment Order C (Very Dangerous)
```
1. Deploy reader.ts が schema_version を必須と想定
   - fetchColdIndexes() で WHERE schema_version = ? (必須)
   
2. D1 migration 未実行
   - archived_files に schema_version カラムなし
   - クエリエラー
   
3. 障害発生、reader が動作しない

Result: ✗ System down
```

## Scenario 2: v1 → v2 Migration Timeline

### Phase 0: Current State (v1 only)
```
FUSOU-APP v1.0:
  - SCHEMA_VERSION="v1" (Cargo feature)
  - Avro schema v1 で encode
  
FUSOU-WORKFLOW:
  - buffer_logs.schema_version: "v1"
  - archived_files.schema_version: "v1"
  - block_indexes.schema_version: "v1"
  - R2 path: v1/2025-12/battle-001.avro
  
Data: All v1
```

### Phase 1: v2 Support Added (Before Release)
```
Code Changes:
  1. kc-api-database/src/schema_version.rs:
     #[cfg(feature = "schema_v2")]
     pub const SCHEMA_VERSION: &str = "v2";
  
  2. reader.ts/cron.ts: Already support v2 schema_version
  
  3. Avro schema (v2) definition added
  
Deployment Status:
  - FUSOU-APP: v1.0 still builds with schema_v1 feature
  - FUSOU-WORKFLOW: Already supports v2
  - D1: Already has schema_version columns
```

### Phase 2: Gradual Rollout (Most Risky)
```
Day 1-3: Beta testers get FUSOU-APP v2.0 (schema_v2)
  - New data: schema_version="v2"
  - Old data: schema_version="v1"
  - Database: Mixed v1 and v2

buffer_logs content:
  id=1001, schema_version="v1", data=[Avro v1 binary]
  id=1002, schema_version="v2", data=[Avro v2 binary]
  
archived_files:
  file_path="v1/2025-12/battle-001.avro", schema_version="v1"
  file_path="v2/2025-12/battle-001.avro", schema_version="v2"
  
block_indexes:
  schema_version="v1", file_id=5
  schema_version="v2", file_id=6

RISKS:
  ✗ reader.deserializeAvroBlock() needs to know which schema to use
    - Currently uses Avro header to detect codec
    - But doesn't validate schema version compatibility
    
  ✗ Old app still uploading v1, new app uploading v2
    - Works fine, they go to different R2 paths
    
  ✓ reader can distinguish using file_path prefix
    - v1/* uses v1 decoder
    - v2/* uses v2 decoder
```

### Phase 3: Full v2 Rollout
```
All users updated to v2.0
  - Only new data is v2
  - Old v1 data still readable
  
Production State:
  - R2: Both v1/* and v2/* exist
  - D1: schema_version mixed
  - reader: Reads both correctly
```

### Phase 4: v1 Sunset (Optional)
```
Decision: Remove v1 support after 1 year
  - All data archived as v2
  - Drop schema_version="v1" records (after archive)
  - reader only needs v2 decoder
```

## Scenario 3: Rollback Nightmare

### Situation: v2 has critical bug
```
Current State:
  - 2025-12-25 00:00: v2 deployed
  - 2025-12-25 12:00: Critical bug found in v2 decoder
  - Action: Rollback to v1

Rollback Steps:
  1. FUSOU-APP v1.0 deploy (schema_v1 feature)
  2. FUSOU-WORKFLOW redeploy (old version without v2 support)
  3. reader.ts redeploy (old version without v2 handling)
  
Problem:
  ✗ Database already has v2 data in D1 and R2
  ✗ v1 reader cannot understand v2 Avro binary
  ✗ Query by v2 file fails
  
Options:
  A. Keep reader code that supports both v1/v2 (safer)
     - Even if v1 is deployed, reader handles v2 in DB
     - reader.ts already does this via BlockIndex.schema_version!
  
  B. Delete v2 data from D1 before rollback (dangerous)
     - Data loss
     - User angry
  
  C. Quarantine v2 data
     - Mark all v2 records as "incompatible"
     - Prevent reader from accessing them
     - Requires additional column/flag

Recommendation:
  ✓ Use Option A: Reader always supports all known versions
  ✓ Cron can be downgraded to v1-only safely
    (just won't create new v2 files)
  ✓ But reader needs to handle existing v2 files in storage
```

## Scenario 4: Database Consistency Audit

### Pre-migration Checklist
```sql
-- Are schema_version columns present?
PRAGMA table_info(buffer_logs);
-- Expected: column schema_version exists

PRAGMA table_info(archived_files);
-- Expected: column schema_version exists

PRAGMA table_info(block_indexes);
-- Expected: column schema_version exists

-- Do DEFAULT values work?
INSERT INTO buffer_logs (dataset_id, table_name, timestamp, data) VALUES (?, ?, ?, ?);
SELECT schema_version FROM buffer_logs ORDER BY id DESC LIMIT 1;
-- Expected: 'v1'

-- Are indices correct?
EXPLAIN QUERY PLAN
SELECT * FROM block_indexes
WHERE dataset_id = ? AND table_name = ? AND schema_version = 'v1';
-- Expected: Uses index idx_block_search

-- NULL Check (should be empty)
SELECT COUNT(*) FROM archived_files WHERE schema_version IS NULL;
SELECT COUNT(*) FROM block_indexes WHERE schema_version IS NULL;
SELECT COUNT(*) FROM buffer_logs WHERE schema_version IS NULL;
```

### Post-migration Checklist
```sql
-- Production monitoring queries
SELECT schema_version, COUNT(*) as count
FROM buffer_logs
GROUP BY schema_version
ORDER BY schema_version DESC;
-- Expected: Mostly 'v1', no NULL

SELECT schema_version, COUNT(*) as count
FROM archived_files
GROUP BY schema_version
ORDER BY schema_version DESC;
-- Expected: All 'v1'

SELECT schema_version, COUNT(*) as count
FROM block_indexes
GROUP BY schema_version
ORDER BY schema_version DESC;
-- Expected: All 'v1'

-- Verify R2 path matches D1
SELECT af.file_path, af.schema_version,
       SUBSTR(af.file_path, 1, 2) as path_version
FROM archived_files af
WHERE SUBSTR(af.file_path, 1, 2) != af.schema_version;
-- Expected: Empty (no mismatches)
```

## Critical Checkpoints for v1→v2 Migration

1. **Code Checkpoint**
   - [ ] reader.ts supports schema_version filtering
   - [ ] reader.ts handles NULL schema_version (for old data)
   - [ ] reader.ts Avro decoder validates compatibility
   - [ ] cron.ts passes schema_version in all inserts

2. **Database Checkpoint**
   - [ ] ALTER TABLE migrations applied successfully
   - [ ] No NULL values in schema_version columns
   - [ ] Indices created and working
   - [ ] DEFAULT 'v1' functioning

3. **Deployment Checkpoint**
   - [ ] FUSOU-WORKFLOW deployed first (with schema_version support)
   - [ ] D1 migration applied
   - [ ] reader.ts deployed last
   - [ ] No reader errors after deployment

4. **Data Checkpoint**
   - [ ] New uploads have schema_version
   - [ ] Old data has schema_version='v1'
   - [ ] R2 paths match schema_version
   - [ ] Reader can read both v1 and v2 (when v2 exists)

5. **Monitoring Checkpoint**
   - [ ] Daily audit: NULL schema_version count
   - [ ] Daily audit: Path vs. schema_version mismatch
   - [ ] Alert on first 'v2' schema_version inserted
   - [ ] Track v1 vs. v2 ratio over time
