# Supabase Integration: User ↔ Member ID Mapping

## Goal
- Bind Supabase `auth.users.id` (application user) to the game `member_id_hash` (salted SHA-256 of `member_id`), enabling cross-device data consolidation and secure per-user access control.

## Schema (SQL Migrations)

Migration file: [docs/sql/001_user_member_map.sql](./sql/001_user_member_map.sql)

### Applying the Migration

1. **Via Supabase Dashboard**:
   - Navigate to SQL Editor in Supabase dashboard
   - Copy and execute the migration SQL file

2. **Via Supabase CLI**:
   ```bash
   supabase migration new user_member_map
   # Copy the SQL into the generated migration file
   supabase db push
   ```

### Table Schema

```sql
create table if not exists public.user_member_map (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_member_map_member_id_hash
  on public.user_member_map (member_id_hash);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_user_member_map_updated_at on public.user_member_map;
create trigger trg_user_member_map_updated_at
  before update on public.user_member_map
  for each row execute function public.set_updated_at();
```

### Row Level Security (RLS)

```sql
alter table public.user_member_map enable row level security;

drop policy if exists user_member_map_select on public.user_member_map;
create policy user_member_map_select on public.user_member_map
  for select using (auth.uid() = user_id);

drop policy if exists user_member_map_insert on public.user_member_map;
create policy user_member_map_insert on public.user_member_map
  for insert with check (auth.uid() = user_id);

drop policy if exists user_member_map_update on public.user_member_map;
create policy user_member_map_update on public.user_member_map
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_member_map_delete on public.user_member_map;
create policy user_member_map_delete on public.user_member_map
  for delete using (auth.uid() = user_id);
```

### RPC Functions

> See the full SQL including metadata columns and RPCs (with `client_version`) in [docs/sql/001_user_member_map.sql](./sql/001_user_member_map.sql).

## Backend (Workers) Hook
- Endpoint: `POST /user/member-map/upsert`
- Authentication: Requires valid JWT in Authorization header
- Request body: `{ "member_id_hash": "<salted-sha256-hash>" }`
- Implementation: [FUSOU-WEB/src/server/routes/user.ts](../packages/FUSOU-WEB/src/server/routes/user.ts)
- Flow:
  1. Extract and validate JWT from Authorization header
  2. Parse request body and validate `member_id_hash`
  3. Create Supabase service role client (safe server-side only)
  4. Call `rpc_upsert_user_member_map` RPC with authenticated user's JWT
  5. RPC uses `auth.uid()` to bind user_id automatically
  6. Return success or error response
- Error handling:
  - 400: Missing or invalid `member_id_hash`
  - 401: Authentication failed (missing/invalid JWT)
  - 409: Conflict (member_id already mapped to another user)
  - 500: Server or database error
- Additional endpoint: `GET /user/member-map` (retrieves current user's mapping)

## Client Flow (Tauri App)
- Timing: `Set::Basic` が更新されたとき（ゲーム起動後、`get_data` または `require_info` API の後）に自動トリガー
- Implementation: `json_parser.rs` で `Set::Basic(data)` が `restore()` された直後に `try_upsert_member_id()` を呼び出す
- One-shot guarantee: `AtomicBool` フラグでセッション内一度きりを保証（失敗時は次回リトライ可能にフラグをリセット）
- Compute: `member_id_hash` は既存の `get_user_member_id()` でソルト付きSHA-256を取得
- Client version: `CARGO_PKG_VERSION` をコンパイル時に埋め込み、リクエストに含める
- Endpoint: `app.auth.member_map_endpoint` を使用（未設定・空の場合は`configs.toml`のデフォルトへ自動フォールバック）。オリジン推定は行いません。
- Error handling:
  - `member_id` が空の場合: スキップしてフラグをリセット（次回リトライ）
  - 認証トークン取得失敗: ログ出力してフラグをリセット
  - ネットワークエラー: ログ出力してフラグをリセット
  - 成功時: ログ出力してフラグ保持（以降スキップ）

## Notes
- Snapshots currently store under `fleets/{dataset_id}/{tag}/...` after API update (see server route changes). Previously it used `auth.users.id`.
- Battle data uploads already require `dataset_id` and are aligned with this mapping.
# Supabase Free Tier 最適化ガイド

## 概要

Supabase Free プランで運用する場合、**shared infrastructure** 上で動作するため、リソース効率を最大化する必要があります。本ドキュメントでは、Queue ベースの Parquet 圧縮システムに対して実装した最適化を説明します。

## Free プラン の制限

| 項目 | Free | Pro |
|------|------|-----|
| データベース容量 | 500 MB | 8 GB |
| インフラ | Shared | Dedicated |
| 接続数制限 | なし | あり（PgBouncer 接続プール） |
| Rate Limiting | あり | あり |
| レイテンシ | 可変 | 低遅延保証 |

**Free での推奨**: 接続プール、バッチ処理、リトライロジックで負荷を平準化

---

## 実装した3つの最適化

### 1️⃣ リトライロジック（指数バックオフ）

**目的**: 一時的な rate limit エラーに対応

**実装**:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimitError = 
        (error as any)?.message?.includes('429') ||
        (error as any)?.status === 429;

      if (!isRateLimitError || attempt === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**使用例**:
```typescript
const insertResult = await withRetry(async () => {
  const result = await supabase.from('datasets').insert(...).select();
  if (result.error) throw result.error;
  return result;
});
```

**効果**:
- 429 エラーで最大3回再試行
- 指数バックオフで Supabase のキャパシティ回復を待つ
- Cloudflare Workers の自動リトライと組み合わせ

---

### 2️⃣ バッチメトリクス挿入

**目的**: `/trigger-scheduled` で複数 dataset を処理する際、クエリ数を最小化

**最適化前**（10 datasets の場合）:
```
Query 1: SELECT datasets WHERE compaction_needed=true (10件取得)
Query 2-11: INSERT processing_metrics (各dataset ごと)
→ 合計 11 クエリ
```

**最適化後**:
```typescript
// 1つのバッチで全メトリクス作成
const metricsPayload = datasets.map((d) => ({
  dataset_id: d.id,
  workflow_instance_id: `scheduled-${Date.now()}-${d.id}`,
  status: 'pending',
  queued_at: new Date().toISOString(),
}));

const metricsInsertResult = await withRetry(async () => {
  const result = await supabase
    .from('processing_metrics')
    .insert(metricsPayload)        // ← バッチ挿入
    .select('id, dataset_id');
  
  if (result.error) throw result.error;
  return result;
});
```

**効果**:
- `INSERT` クエリを 10 → 1 に削減
- 同一トランザクション内で一括処理
- Supabase の負荷を平準化

---

### 3️⃣ 統一されたリトライ設定（Workflow）

**目的**: Workflow のすべてのステップに一貫性のあるリトライポリシーを適用

**実装**:
```typescript
// Standard retry config for Supabase operations
const SUPABASE_RETRY_CONFIG = {
  limit: 3,
  delay: '2 seconds',
  backoff: 'exponential' as const,
};

// Step 1: Validate Dataset
const validation = await step.do('validate-dataset', {
  retries: SUPABASE_RETRY_CONFIG  // ← 統一設定
}, async () => {
  // ... Supabase operation
});

// Step 2: Set in-progress flag
await step.do('set-in-progress-flag', {
  retries: SUPABASE_RETRY_CONFIG  // ← 統一設定
}, async () => {
  // ... Supabase operation
});
```

**効果**:
- Workflow の各ステップで一貫したリトライ戦略
- 設定の一元管理でメンテナンス性向上
- Supabase Free 特有の rate limiting に対応

---

## 現在のアクセスパターン分析

### スケジュール起動（1日1回, 02:00 UTC）

```
1. SELECT datasets (compaction_needed=true, compaction_in_progress=false)
   ↓
2. BATCH INSERT processing_metrics (N records)    ← 最適化
   ↓
3. QUEUE SEND (N messages)
   ↓
4. Workflow Step 1: SELECT datasets (validation)
5. Workflow Step 2: UPDATE datasets (set flag)
6. Workflow Step 3: COMPACT (R2 read, no DB)
7. Workflow Step 4: UPDATE datasets (metrics)

推定負荷: ~20-25 クエリ（N datasets = 10の場合）
```

### リアルタイムアップロード

```
1. R2 PUT file
2. INSERT datasets
3. INSERT processing_metrics  ← with retry
4. QUEUE SEND
5. Workflow（同上）

推定負荷: ~4-5 クエリ/upload
```

### 監視エンドポイント

```
GET /dlq-status:
1. SELECT processing_metrics (status='failure')

推定負荷: ~1 クエリ/check
```

---

## トラブルシューティング

### 症状: 「429 Too Many Requests」エラー

**原因**: 
- バッチ処理がなく、各dataset で個別にクエリ
- リトライなし

**対策**:
1. バッチメトリクス挿入を確認（`trigger-scheduled` で 1 INSERT のみ）
2. リトライロジック のログを確認
3. `/dlq-status` で失敗原因を特定

```bash
# ログ確認
curl https://$PAGES_DOMAIN/api/compaction/dlq-status | jq '.failures[] | {error_message, error_step}'
```

### 症状: Workflow が頻繁にタイムアウト

**原因**:
- Supabase リクエスト が slow
- Shared infrastructure の過負荷

**対策**:
1. `trigger-scheduled` を 02:00 UTC（夜間）に設定済み ✅
2. リトライ config で delay を増加
   ```typescript
   delay: '5 seconds'  // 2 秒 → 5 秒に増加
   ```
3. `limit` を 2 に削減（リトライ回数）
   ```typescript
   limit: 2  // Fast fail pattern
   ```

---

## Supabase Pro へのアップグレード判定基準

以下の場合、Pro への移行を検討：

- **接続数エラー**: 同時実行 Workflow が 10 以上
- **Rate limit**: 1秒あたり 100+ クエリ
- **レイテンシ**: 平均 500ms 以上

**Pro のメリット**:
- PgBouncer 接続プール（最大同時接続数を増加）
- Dedicated infrastructure（リソース保証）
- Connection pooling（コスト削減）

---

## モニタリング

### ダッシュボード

Supabase Dashboard → Analytics でリアルタイムモニタリング:

1. **Database**: Query 実行数、遅延時間
2. **Auth**: Session 数
3. **Storage**: R2 のバイト転送量

### 処理メトリクスのクエリ

```sql
-- 過去24時間の処理統計
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - queued_at))) as avg_duration_sec
FROM processing_metrics
WHERE created_at > now() - interval '24 hours'
GROUP BY hour, status
ORDER BY hour DESC;

-- 失敗原因の分析
SELECT
  error_step,
  error_message,
  COUNT(*) as count
FROM processing_metrics
WHERE status = 'failure'
  AND created_at > now() - interval '7 days'
GROUP BY error_step, error_message
ORDER BY count DESC;
```

---

## ベストプラクティス

| 項目 | 推奨値 | 理由 |
|------|--------|------|
| Batch Insert Size | 10-50 records | Supabase Free では 50+ で遅延増加 |
| Retry Max Attempts | 3 | Exponential backoff: 1s, 2s, 4s |
| Retry Delay | 2 秒（初回） | Free tier の recover time |
| Concurrent Workflows | ≤ 5 | Shared infrastructure の負荷制限 |
| scheduled trigger時間 | 02:00 UTC | ユーザーオフピーク時間 |

---

## 関連ファイル

- `/packages/FUSOU-WEB/src/server/routes/compact.ts` - `withRetry()` 実装
- `/packages/FUSOU-WORKFLOW/src/index.ts` - `SUPABASE_RETRY_CONFIG` 定義
- `/docs/sql/20251216_add_compaction_tables.sql` - RLS ポリシー設定

---

## デプロイメント チェックリスト

- [ ] `withRetry()` が全エンドポイントで使用されている
- [ ] `/trigger-scheduled` でバッチ挿入を確認
- [ ] Workflow のリトライ設定が統一されている（SUPABASE_RETRY_CONFIG）
- [ ] GitHub Actions cron が 02:00 UTC に設定
- [ ] DLQ モニタリング (`/dlq-status`) が動作
- [ ] 処理メトリクスダッシュボードで成功率 ≥ 99% を確認

---

**Last Updated**: 2025-12-17  
**Status**: ✅ Production Ready for Free Tier
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
      const v = row.table_version || 'NULL';
      versionDistribution.set(v, (versionDistribution.get(v) ?? 0) + 1);
    }
    
    console.log('[Archival] Version distribution:', 
      Object.fromEntries(versionDistribution)
    );
    
    // Log any NULL occurrences
    const nullCount = rows.filter(r => !r.table_version).length;
    if (nullCount > 0) {
      console.warn(
        `[ALERT] Found ${nullCount} rows with NULL table_version! ` +
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
      
      versionsSeen.add(group.key.table_version);
      
      console.debug(
        `[Archival] Processing group: ` +
        `table_version=${group.key.table_version}, ` +
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
        `table_version=${group.key.table_version}`
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
    table_version: params.table_version || 'any',
    time_range: params.from && params.to ? 
      `${params.from}-${params.to}` : 'all'
  });
  
  try {
    const hotData = await fetchHotData(env.BATTLE_INDEX_DB, params);
    const coldIndexes = await fetchColdIndexes(env.BATTLE_INDEX_DB, params);
    
    // Log version distribution in result
    const hotVersions = new Set(hotData.map(r => r.table_version));
    const coldVersions = new Set(coldIndexes.map(b => b.table_version));
    
    console.info('[Reader] Data distribution:', {
      hot_records: hotData.length,
      hot_versions: Array.from(hotVersions),
      cold_blocks: coldIndexes.length,
      cold_versions: Array.from(coldVersions)
    });
    
    // Warn if versions are mixed unexpectedly
    if (hotVersions.size > 1 || coldVersions.size > 1) {
      console.warn('[Reader] Multiple table versions detected - this is OK during migration');
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
  table_version,
  COUNT(*) as record_count,
  MIN(timestamp) as oldest_record,
  MAX(timestamp) as newest_record
FROM buffer_logs
WHERE created_at > datetime('now', '-1 hour')
GROUP BY table_version
UNION ALL
SELECT 
  'archived_files',
  table_version,
  COUNT(*),
  MIN(created_at),
  MAX(created_at)
FROM archived_files
WHERE created_at > datetime('now', '-1 hour')
GROUP BY table_version;
```

### Daily: Integrity Check

```sql
-- Check for NULL values (should be 0)
SELECT 
  SUM(CASE WHEN table_version IS NULL THEN 1 ELSE 0 END) as null_count
FROM (
  SELECT table_version FROM buffer_logs
  UNION ALL
  SELECT table_version FROM archived_files
  UNION ALL
  SELECT table_version FROM block_indexes
);
```

### Weekly: Path vs. Schema Version Consistency

```sql
-- Detect path/table_version mismatches
-- e.g., file_path="v1/..." but table_version="v2"
SELECT COUNT(*) as mismatches
FROM archived_files
WHERE 
  (SUBSTR(file_path, 1, 2) = 'v1' AND table_version != 'v1') OR
  (SUBSTR(file_path, 1, 2) = 'v2' AND table_version != 'v2');
  
-- Should always be 0
```

## 3. Alert Conditions

### Critical Alerts
```
1. NULL table_version detected
   - Threshold: > 0
   - Action: Check if migration was applied correctly
   - Severity: CRITICAL

2. Path/Version mismatch
   - Threshold: > 0
   - Action: Data integrity issue, investigate immediately
   - Severity: CRITICAL

3. Reader fails on version filtering
   - Pattern: "table_version column not found"
   - Action: Check if D1 migration was applied
   - Severity: CRITICAL
```

### Warning Alerts
```
1. Unexpected version in production
   - Pattern: table_version != 'v1' during v1-only phase
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
  - Alert on NULL table_version
  - Alert on version mismatch

### Day-1 Post-Production

- [ ] Monitor first hour of logs
  ```bash
  tail -f cloudflare-worker-logs.txt | grep table_version
  ```

- [ ] Check version distribution
  ```sql
  SELECT table_version, COUNT(*) FROM buffer_logs GROUP BY table_version;
  ```

- [ ] Verify no NULL values
  ```sql
  SELECT COUNT(*) FROM buffer_logs WHERE table_version IS NULL;
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
    "table_version": "v1",
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
    "table_version": "v2"
  }
}
```

## 6. Troubleshooting Guide

### Symptom: "table_version column not found" Error

```
Likely Cause: D1 migration not applied
Fix:
1. Check if ALTER TABLE was executed
   PRAGMA table_info(buffer_logs);
2. If missing, apply migration
   npx wrangler d1 execute prod_db --file=migrations/add_table_version.sql
3. Redeploy FUSOU-WORKFLOW
```

### Symptom: All new data has table_version=NULL

```
Likely Cause: Default value not working or app not specifying version
Fix:
1. Check DEFAULT in schema
   PRAGMA table_info(buffer_logs);
   (should show: DEFAULT 'v1')
2. Check app code
   - buffer-consumer.ts: tableVersion || 'v1'
   - cron.ts: Always passes table_version
3. If DEFAULT missing, run:
   ALTER TABLE buffer_logs ADD CONSTRAINT check_version 
   CHECK (table_version IS NOT NULL);
```

### Symptom: Path/Version Mismatch Detected

```
Example:
  archived_files.file_path = "v1/2025-12/battle-001.avro"
  archived_files.table_version = "v2"

Investigation:
1. Query the specific file
   SELECT * FROM archived_files WHERE file_path = 'v1/2025-12/battle-001.avro';
2. Check when it was created
3. Check cron logs from that time
4. If recent, might be race condition in cron
5. If old, might be manual edit or bug

Fix:
1. Update the column to match
   UPDATE archived_files SET table_version='v1' 
   WHERE file_path LIKE 'v1/%' AND table_version != 'v1';
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
   - Was table_version filtering removed by accident?
2. Check if v2 app was deployed when it shouldn't be
3. Check logs for version distribution
```

## 7. Automation: Health Check Script

```typescript
// scripts/version-health-check.ts
import { D1Database } from "@cloudflare/workers-types";

export async function checkVersionHealth(db: D1Database): Promise<void> {
  console.log('=== Table Version Health Check ===');
  
  // Check 1: NULL values
  const nullCount = await db.prepare(
    `SELECT COUNT(*) as cnt FROM buffer_logs WHERE table_version IS NULL`
  ).first<{ cnt: number }>();
  
  if (nullCount?.cnt! > 0) {
    console.error(`❌ CRITICAL: Found ${nullCount.cnt} NULL table_version values`);
  } else {
    console.log('✓ No NULL table_version values');
  }
  
  // Check 2: Distribution
  const distribution = await db.prepare(
    `SELECT table_version, COUNT(*) as cnt FROM buffer_logs 
     GROUP BY table_version`
  ).all();
  
  console.log('Version distribution:', distribution.results);
  
  // Check 3: Path/Version mismatch
  const mismatches = await db.prepare(
    `SELECT COUNT(*) as cnt FROM archived_files 
     WHERE SUBSTR(file_path, 1, 2) != table_version`
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
