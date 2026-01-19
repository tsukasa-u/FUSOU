# Hot/Cold Architecture Design for FUSOU Battle Data System

## Overview

統合戦略: 現在の Avro ベース戦闘データシステムに Hot/Cold 分離アーキテクチャを統合します。

### Current System (Before)

- Queue → Consumer → R2 Avro Append (Immediate)
- D1: `avro_files`, `avro_segments` (Metadata only)
- Read: Direct R2 access with full file download

### New System (After)

- Queue → **Buffer Consumer** → **D1 Buffer** (Hot, 1 時間分)
- **Archiver Cron** → R2 Consolidated Avro (Cold, Range-Requestable)
- D1: Hot buffer + Block Index (Byte-level addressing)
- Read: Hot (D1) + Cold (R2 Range Request)

---

## Architecture Components

```
┌─────────────┐
│  Ingest API │ → Queue
└─────────────┘
       ↓
┌──────────────────┐
│ Buffer Consumer  │ → D1 buffer_logs (Hot Storage)
└──────────────────┘
       ↓ (Every hour, Cron)
┌──────────────────┐
│ Archiver Worker  │ → R2 Consolidated Avro + D1 Block Index
└──────────────────┘
       ↓
┌──────────────────┐
│  Reader API      │ → Merge Hot + Cold (Range Request)
└──────────────────┘
```

---

## D1 Schema Extension

### 新規テーブル (Hot/Cold 統合用)

#### 1. `buffer_logs` - Hot Data Buffer

```sql
-- 直近1時間分のデータを保持（アーカイブ前の一時バッファ）
CREATE TABLE buffer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    timestamp INTEGER NOT NULL,     -- レコードのタイムスタンプ (ms)
    data BLOB NOT NULL,              -- JSONまたはAvroバイナリ
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX idx_buffer_search
    ON buffer_logs (dataset_id, table_name, timestamp);
CREATE INDEX idx_buffer_cleanup
    ON buffer_logs (created_at);
```

#### 2. `archived_files` - R2 ファイル正規化

```sql
-- ファイルパスを正規化（容量削減のため）
CREATE TABLE archived_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE, -- R2: "battle/202412.avro"
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
```

#### 3. `block_indexes` - Byte-Level Address Book

```sql
-- 「誰のデータが、どのファイルの、何バイト目にあるか」
CREATE TABLE block_indexes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    period_tag TEXT NOT NULL,        -- 追加: 期間タグ
    file_id INTEGER NOT NULL,        -- archived_files.id
    start_byte INTEGER NOT NULL,     -- R2 Range Request開始位置
    length INTEGER NOT NULL,         -- データ長
    record_count INTEGER,            -- ブロック内レコード数
    start_timestamp INTEGER,         -- ブロック内最初のタイムスタンプ
    end_timestamp INTEGER,           -- ブロック内最後のタイムスタンプ
    FOREIGN KEY (file_id) REFERENCES archived_files(id)
);

CREATE INDEX idx_block_search
    ON block_indexes (dataset_id, table_name, period_tag, start_timestamp);
CREATE INDEX idx_block_file
    ON block_indexes (file_id);
```

### 既存テーブルとの関係

- **`avro_files`/`avro_segments`**: 既存のリアルタイム書き込みシステムと**並行運用**
  - リアルタイム: 即座に R2 へ保存（小規模・頻繁アクセス）
  - バッチ: Hot → Cold 移行（大規模・効率的）

**統合方針:**

- リアルタイム要求: 既存システム継続使用
- 分析系要求: Hot/Cold 統合読み出し
- 段階移行: まずログシステムで実装 → 戦闘データへ段階適用

---

## Implementation Plan

### Phase 1: Parallel Infrastructure (新規ログシステム)

1. 新規 D1 スキーマ作成 (`buffer_logs`, `archived_files`, `block_indexes`)
2. Buffer Consumer 実装 (Bulk Insert)
3. Archiver Cron 実装 (Manual Avro Block Construction)
4. Reader API 実装 (Hot + Cold Merge)

### Phase 2: Battle Data Integration (既存システム拡張)

1. 既存`avro_files`との統合設計
2. Migration Strategy (既存データの Cold 化)
3. Unified Query Interface

### Phase 3: Optimization

1. Durable Object Cache for Block Index
2. Compression (`deflate`/`snappy`)
3. Cache-Control Headers for Cold Data

---

## Key Optimizations

### 1. Compression (必須)

- R2 保存時: `deflate` または `snappy` 圧縮
- `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]` ✅ 既に設定済み

### 2. Range Request (必須)

```typescript
// ❌ NG: Full download
const obj = await R2.get(key);

// ✅ OK: Range Request
const obj = await R2.get(key, {
  range: { offset: startByte, length: blockLength },
});
```

### 3. Bulk Insert (D1 課金対策)

```typescript
// ❌ NG: 1件ずつINSERT
for (const record of records) {
  await db.prepare("INSERT INTO buffer_logs...").bind(record).run();
}

// ✅ OK: Bulk Insert
const values = records.map((r) => `(?,?,?)`).join(",");
const params = records.flatMap((r) => [r.dataset_id, r.timestamp, r.data]);
await db
  .prepare(`INSERT INTO buffer_logs VALUES ${values}`)
  .bind(...params)
  .run();
```

### 4. 安全なデータ移動

```sql
-- ✅ ID範囲指定で削除（新規書き込みと競合しない）
DELETE FROM buffer_logs WHERE id <= ?;
```

---

## Directory Structure

```
packages/FUSOU-WORKFLOW/
├── src/
│   ├── index.ts              # Main entry (既存)
│   ├── buffer-consumer.ts    # 新規: Hot Buffer Writer
│   ├── archiver.ts           # 新規: Cron Archiver
│   ├── reader.ts             # 新規: Hot/Cold Reader
│   └── utils/
│       ├── avro-manual.ts    # 既存
│       ├── avro-blocks.ts    # 新規: Manual Block Construction
│       └── compression.ts    # 新規: Deflate/Snappy
└── docs/
    └── sql/
        └── d1/
            ├── avro-schema.sql           # 既存
            └── hot-cold-schema.sql       # 新規: Buffer + Index
```

---

## Next Steps

1. ✅ Design Document (this file)
2. ⏳ Create `hot-cold-schema.sql`
3. ⏳ Implement Buffer Consumer
4. ⏳ Implement Archiver
5. ⏳ Implement Reader API
6. ⏳ Test & Deploy

---

**Status:** Architecture Design Complete  
**Next:** Schema Implementation
# Avro Schema Migration Guide

## Overview

This document describes the migration from the Parquet-era `battle_files` table to the new Avro-optimized schema (`avro_files`, `avro_segments`, and `avro_append_history`).

## Background

### Design Philosophy Change

**Parquet Pattern (Old):**
- Immutable fragments: 1 upload = 1 new file = 1 table record
- Files never change after creation
- History = complete list of all fragment records
- Query time = merge multiple fragments

**Avro Pattern (New):**
- Mutable files via append: 1 upload = append to existing file
- Files grow continuously
- Segmentation only when exceeding 512MB
- Query time = read latest consolidated file (+ segments if any)

### Schema Comparison

| Aspect | Parquet (battle_files) | Avro (avro_files + avro_segments) |
|--------|------------------------|-----------------------------------|
| Record Model | 1 record per upload | 1 record per file (updated on append) |
| File Growth | New fragment each time | Single file grows via UPDATE |
| Segmentation | N/A (always fragments) | Automatic at 512MB threshold |
| History Tracking | Implicit (all records) | Optional (avro_append_history) |
| Storage Efficiency | Low (redundant old states) | High (only current state) |

## Migration Steps

### Step 1: Archive Old Table

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --local --command="ALTER TABLE battle_files RENAME TO battle_files_parquet_archive"
```

For remote (production):
```bash
npx wrangler d1 execute dev_kc_battle_index --remote --command="ALTER TABLE battle_files RENAME TO battle_files_parquet_archive"
```

### Step 2: Apply New Schema

```bash
# Local environment
npx wrangler d1 execute dev_kc_battle_index --local --file=../../docs/sql/d1/avro-schema.sql

# Remote environment (production)
npx wrangler d1 execute dev_kc_battle_index --remote --file=../../docs/sql/d1/avro-schema.sql
```

### Step 3: Verify Schema

```bash
# List tables
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT name FROM sqlite_master WHERE type='table'"

# Expected output:
# - battle_files_parquet_archive
# - avro_files
# - avro_segments
# - avro_append_history
```

### Step 4: Optional - Backfill Existing Avro Data

If you have existing Avro data in the old `battle_files_parquet_archive` table that you want to migrate to the new schema:

```sql
-- Extract latest state per file_key from archived data
INSERT INTO avro_files (
    file_key, 
    dataset_id, 
    table_name, 
    period_tag,
    current_size, 
    is_segmented,
    segment_count,
    created_at, 
    last_appended_at,
    last_etag,
    content_hash,
    uploaded_by
)
SELECT 
    key AS file_key,
    dataset_id,
    "table" AS table_name,
    period_tag,
    MAX(size) AS current_size,
    FALSE AS is_segmented,
    0 AS segment_count,
    MIN(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS created_at,
    MAX(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS last_appended_at,
    (SELECT etag FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS last_etag,
    (SELECT content_hash FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS content_hash,
    (SELECT uploaded_by FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS uploaded_by
FROM battle_files_parquet_archive bf
WHERE dataset_id IS NOT NULL  -- Filter for Avro-era data only
GROUP BY key;
```

Run via:
```bash
npx wrangler d1 execute dev_kc_battle_index --local --file=backfill-avro-data.sql
```

### Step 5: Update Application Code

The workflow consumer (`packages/FUSOU-WORKFLOW/src/index.ts`) has been updated to use the new schema. Key changes:

1. **Canonical file logic**: Uses `INSERT` for new files, `UPDATE` for appends
2. **Segment creation**: When file would exceed 512MB, creates segment record in `avro_segments`
3. **Parent file tracking**: Updates `is_segmented` and `segment_count` in `avro_files`

### Step 6: Deploy Updated Code

```bash
cd packages/FUSOU-WORKFLOW
npm run build
npx wrangler deploy
```

### Step 7: Verify Deployment

1. Upload test data via FUSOU-WEB battle_data endpoint
2. Check wrangler tail logs:
```bash
npx wrangler tail
```

3. Query D1 to verify records:
```bash
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT * FROM avro_files LIMIT 5"
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT * FROM avro_segments LIMIT 5"
```

## Rollback Plan

If migration fails, you can restore the old table:

```bash
# Drop new tables
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_files"
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_segments"
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_append_history"

# Restore old table
npx wrangler d1 execute dev_kc_battle_index --local --command="ALTER TABLE battle_files_parquet_archive RENAME TO battle_files"
```

## Monitoring

After migration, monitor:

1. **File growth patterns**: Check `avro_files.current_size` over time
2. **Segmentation frequency**: Count records in `avro_segments`
3. **Append operations**: If using `avro_append_history`, track append frequency
4. **Storage efficiency**: Compare total bytes in D1 vs R2

### Useful Queries

```sql
-- Files approaching 512MB limit
SELECT file_key, current_size, period_tag
FROM avro_files
WHERE current_size > 450 * 1024 * 1024  -- 450 MB
ORDER BY current_size DESC;

-- Segmented files summary
SELECT 
    dataset_id,
    table_name,
    COUNT(*) as segmented_files,
    SUM(segment_count) as total_segments
FROM avro_files
WHERE is_segmented = TRUE
GROUP BY dataset_id, table_name;

-- Recent append activity (requires avro_append_history)
SELECT 
    file_key,
    action,
    appended_bytes,
    appended_at
FROM avro_append_history
WHERE appended_at > (strftime('%s', 'now') - 86400) * 1000  -- Last 24 hours
ORDER BY appended_at DESC
LIMIT 20;
```

## Cleanup (Optional)

After verifying the migration is successful and stable for a reasonable period (e.g., 1-2 weeks), you can drop the archived Parquet table:

```bash
# WARNING: This is irreversible!
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE battle_files_parquet_archive"

# For production (use with extreme caution):
npx wrangler d1 execute dev_kc_battle_index --remote --command="DROP TABLE battle_files_parquet_archive"
```

## References

- Schema definition: [docs/sql/d1/avro-schema.sql](../sql/d1/avro-schema.sql)
- Type definitions: [packages/FUSOU-WORKFLOW/src/avro-schema-types.ts](../../packages/FUSOU-WORKFLOW/src/avro-schema-types.ts)
- Workflow consumer: [packages/FUSOU-WORKFLOW/src/index.ts](../../packages/FUSOU-WORKFLOW/src/index.ts)
# Avro Schema Registry Integration

## Overview

kc-api-databaseのCargoフィーチャー（`schema_v1`/`schema_v2`）を使って、Avroスキーマを自動生成し、FUSOU-WEB/WORKFLOWで使用できるようにしました。

## スキーマバージョンについて

### 現状の動作

kc-api-databaseのCargoフィーチャーは以下のように定義されています：

```toml
[features]
default = ["graphviz", "schema_v1"]
schema_v1 = []
schema_v2 = []
breaking_schema = []
```

これらのフィーチャーは、**スキーマ自体を変更するのではなく**、`SCHEMA_VERSION`定数を設定してR2ストレージのパス管理に使用されます。

- `schema_v1` → `SCHEMA_VERSION = "v1"`
- `schema_v2` → `SCHEMA_VERSION = "v2"`

**重要**: 現時点では、v1とv2のAvroスキーマは完全に同一です。将来的にスキーマ変更が必要な場合、条件コンパイル（`#[cfg(feature)]`）で分岐させる必要があります。

## 生成されたファイル

### 1. スキーマ生成スクリプト

**場所**: [packages/kc_api/scripts/generate-schemas.sh](../kc_api/scripts/generate-schemas.sh)

実行方法：
```bash
cd packages/kc_api
./scripts/generate-schemas.sh
```

出力：
- `packages/kc_api/generated-schemas/schema_v1.json`
- `packages/kc_api/generated-schemas/schema_v2.json`

### 2. Schema Registry (FUSOU-WORKFLOW)

**場所**: [packages/FUSOU-WORKFLOW/src/schema-registry.ts](FUSOU-WORKFLOW/src/schema-registry.ts)

機能：
```typescript
// テーブルの正規スキーマを取得
getCanonicalSchema(version: 'v1' | 'v2', tableName: string): string | null

// 利用可能なテーブル一覧
getAvailableTables(version: 'v1' | 'v2'): string[]

// データベーステーブルバージョン
getTableVersion(version: 'v1' | 'v2'): string | null
```

### 3. Schema Registry (FUSOU-WEB)

**場所**: [packages/FUSOU-WEB/src/server/utils/schema-registry.ts](FUSOU-WEB/src/server/utils/schema-registry.ts)

Cloudflare Workers環境で動作する軽量版です。

### 4. 更新されたValidator

**場所**: [packages/FUSOU-WORKFLOW/src/avro-validator.ts](FUSOU-WORKFLOW/src/avro-validator.ts)

新しいAPI：
```typescript
await validateAvroOCF(avroBytes, {
  // オプション1: 正規スキーマを使用（推奨）
  schemaVersion: 'v1',
  tableName: 'battle',
  
  // オプション2: 明示的なスキーマ
  explicitSchema: schemaJson,
  
  // オプション3: OCFヘッダースキーマを信頼（セキュリティ上非推奨）
  trustOCFSchema: true,
});
```

## 利用可能なテーブル

現在33個のテーブルが利用可能：

- `env_info`, `cells`
- `airbase`, `plane_info`
- `own_slotitem`, `enemy_slotitem`, `friend_slotitem`
- `own_ship`, `enemy_ship`, `friend_ship`
- `own_deck`, `support_deck`, `enemy_deck`, `friend_deck`
- `airbase_airattack`, `airbase_airattack_list`
- `airbase_assult`, `carrierbase_assault`
- `closing_raigeki`
- `friendly_support_hourai`, `friendly_support_hourai_list`
- `hougeki`, `hougeki_list`
- `midnight_hougeki`, `midnight_hougeki_list`
- `opening_airattack`, `opening_airattack_list`
- `opening_raigeki`
- `opening_taisen`, `opening_taisen_list`
- `support_airattack`, `support_hourai`
- `battle`

## 使用例

### FUSOU-WORKFLOWでの使用

```typescript
import { validateAvroOCF } from './src/avro-validator';

// 正規スキーマで検証（推奨）
const result = await validateAvroOCF(avroBytes, {
  schemaVersion: 'v1',
  tableName: 'battle',
});

if (result.valid) {
  console.log('Valid! Record count:', result.recordCount);
} else {
  console.error('Validation failed:', result.error);
}
```

### FUSOU-WEBでの使用

```typescript
import { validateAvroOCF } from './server/utils/avro-validator';
import { getCanonicalSchema } from './server/utils/schema-registry';

// Cloudflare Workerで実行
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const avroBytes = await request.arrayBuffer();
    
    const result = await validateAvroOCF(new Uint8Array(avroBytes), {
      schemaVersion: 'v1',
      tableName: 'battle',
    });
    
    return Response.json(result);
  }
};
```

## テスト結果

```bash
$ node test/test-schema-registry-simple.mjs
=== Schema Registry Test ===

Test 1: Load schema v1
  Table version: 0.4
  Schema count: 33
  ✓ Loaded successfully

Test 2: Load schema v2
  Table version: 0.4
  Schema count: 33
  ✓ Loaded successfully

Test 3: Find battle table schema
  Schema name: Battle
  Schema type: record
  Field count: 40
  ✓ Battle schema found

Test 5: Compare v1 and v2
  Same schema count: true
  Same table version: true
  ✓ Comparison complete

All tests passed!
```

## セキュリティ上の推奨事項

1. **正規スキーマを使用**: `schemaVersion` + `tableName` で検証
2. **OCFヘッダーは信頼しない**: `trustOCFSchema: true` は避ける
3. **スキーマフィンガープリント検証**: 将来的に実装推奨

## 今後の拡張

1. **スキーマフィンガープリント検証**: OCFヘッダーと正規スキーマの一致確認
2. **バージョン別スキーマ**: v1/v2で異なるスキーマが必要な場合、条件コンパイルで分岐
3. **スキーマ進化の追跡**: breaking_schema featureを活用したメジャーバージョン管理

## 関連ファイル

- [kc_api/scripts/generate-schemas.sh](../kc_api/scripts/generate-schemas.sh)
- [kc_api/crates/kc-api-database/src/bin/print_schema.rs](../kc_api/crates/kc-api-database/src/bin/print_schema.rs)
- [kc_api/crates/kc-api-database/src/schema_version.rs](../kc_api/crates/kc-api-database/src/schema_version.rs)
- [FUSOU-WORKFLOW/src/schema-registry.ts](FUSOU-WORKFLOW/src/schema-registry.ts)
- [FUSOU-WORKFLOW/src/avro-validator.ts](FUSOU-WORKFLOW/src/avro-validator.ts)
- [FUSOU-WEB/src/server/utils/schema-registry.ts](FUSOU-WEB/src/server/utils/schema-registry.ts)
# Avro Smart Validation System

## 概要

**外部ファイルに依存しない、Rust内スキーマ比較による検証システム**

クライアントがアップロードしたAvro OCFファイルから抽出したスキーマと、Rustプログラム内で生成したスキーマを**動的に比較・マッチング**して、データの正確性を確保します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Client uploads Avro OCF                                    │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ WASM: validate_avro_ocf_smart()                            │
│  1. Extract schema from OCF header                         │
│  2. Match against Rust schemas (kc-api-database)          │
│  3. Validate data conforms to matched schema              │
│  4. Return: version + table_name + validation result      │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────┬──────────────────────────────────┐
│ kc-api-database          │ avro-wasm                        │
│ ├─ schema_registry.rs    │ ├─ validator.rs                 │
│ ├─ schema_version.rs     │ ├─ schema_registry.rs           │
│ └─ models/*              │ └─ lib.rs                       │
│                          │                                  │
│ Rust実行時に複数バージョン│ Compiled-in schema set       │
│ のスキーマを生成         │ (v1 or v2)                     │
└──────────────────────────┴──────────────────────────────────┘
```

## 主要な実装

### 1. kc-api-database/schema_registry.rs

Rust側でモデルから動的に複数バージョンのスキーマを生成：

```rust
// 現在コンパイルされたバージョンのスキーマセットを取得
pub fn get_current_schema_set() -> SchemaSet {
    // schema_v1またはschema_v2フィーチャーに応じて
    // 異なるモデル構造から33種類のテーブルスキーマを生成
}

// クライアント送付スキーマとマッチング
pub fn find_matching_schema(canonical_schema: &str) -> Option<(String, String)> {
    // (version, table_name)を返す
}
```

### 2. avro-wasm/schema_registry.rs

WASM側でのスキーママッチング：

```rust
/// クライアントOCFヘッダースキーマをRust内スキーマと比較
#[wasm_bindgen]
pub fn match_client_schema(schema_json: &str) -> SchemaMatchResult {
    // ✅ クライアントスキーマ正規化
    // ✅ Rust内スキーマセットと照合
    // ✅ マッチしたバージョン・テーブル名を返す
}

/// 利用可能なテーブル一覧（バージョン別）
#[wasm_bindgen]
pub fn get_available_schemas() -> Vec<String> { ... }
```

### 3. avro-wasm/validator.rs

スマート検証エンジン：

```rust
/// ✅ OCFヘッダースキーマを自動抽出
/// ✅ Rust内スキーマとマッチング
/// ✅ 一致したスキーマでデータ検証
/// ✅ バージョン・テーブル情報を返す
#[wasm_bindgen]
pub fn validate_avro_ocf_smart(avro_data: &[u8]) -> ValidationResult {
    // 1. Extract schema from OCF
    // 2. match_client_schema()で比較
    // 3. Apache-avroでデータ検証
    // 4. Result { valid, record_count, schema_version, table_name, error }
}
```

## マルチバージョン対応

### コンパイル時フィーチャー制御

```toml
# avro-wasm/Cargo.toml
[features]
default = ["schema_v1"]
schema_v1 = ["kc-api-database/schema_v1"]  # v1モデルセット
schema_v2 = ["kc-api-database/schema_v2"]  # v2モデルセット
```

### ビルドコマンド

```bash
# v1サポート（デフォルト）
cargo build --features schema_v1

# v2サポート
cargo build --features schema_v2

# 複数バージョンをサポート →個別のWASM/バイナリが必要
```

### API切り替え時の流れ

```
時刻T1: v1のみサポート
  └─ WEB: schema_v1フィーチャーで構築

時刻T2: v1 → v2 移行開始（両方サポート）
  └─ WEB: schema_v2フィーチャーで構築（互換性あり）
  └─ 新しいクライアントはv2スキーマ送信
  └─ 旧クライアントはv1スキーマ送信

時刻T3: v1サポート終了
  └─ WEB: schema_v2のみ（軽量化）
```

**重要**: 両バージョンを同時サポートする場合は、**2つのWASMモジュール/サーバーを並列運用**する必要があります。

## 使用例

### FUSOU-WORKFLOWでの使用

```typescript
import { validateAvroOCFSmart } from '../../avro-wasm/index';

// クライアント送付データを自動判定
const result = await validateAvroOCFSmart(avroBytes);

if (result.valid) {
  console.log(`✅ Valid!`);
  console.log(`  Version: ${result.schemaVersion}`);     // "v1" or "v2"
  console.log(`  Table: ${result.tableName}`);           // "battle", "cells", etc.
  console.log(`  Records: ${result.recordCount}`);
} else {
  console.error(`❌ Failed: ${result.errorMessage}`);
}
```

### FUSOU-WEBでの使用（Cloudflare Workers）

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const avroBytes = await request.arrayBuffer();
    
    // スマート検証（スキーマ自動判定）
    const result = await validateAvroOCFSmart(
      new Uint8Array(avroBytes)
    );
    
    return Response.json(result);
  }
};
```

### スキーマ情報の取得

```typescript
// 現在のバージョンを取得
const version = getCurrentSchemaVersion(); // "v1" or "v2"

// 利用可能なテーブル一覧
const tables = getAvailableSchemas();
// ["battle", "cells", "env_info", "airbase", ...]

// 特定テーブルのスキーマJSON取得
const battleSchema = getSchemaJson("battle");
```

## バージョン間の差異

### 現状（v1/v2同一）

```
kc-api-database
├─ schema_v1 → 33テーブル（0.4）
└─ schema_v2 → 33テーブル（0.4）
  ※完全に同じスキーマ
```

### スキーマ差分が必要な場合

条件コンパイルで分岐：

```rust
// models/battle.rs
#[cfg(feature = "schema_v1")]
#[derive(AvroSchema, ...)]
pub struct Battle {
    pub field_a: i32,
    // v1フィールド
}

#[cfg(feature = "schema_v2")]
#[derive(AvroSchema, ...)]
pub struct Battle {
    pub field_a: i32,
    pub field_b: String,  // 新フィールド
}
```

するとWASMでも自動的にバージョン別スキーマが生成されます。

## テスト結果

```bash
$ cargo test --lib
running 7 tests
test schema_registry::tests::test_get_available_schemas ... ok
test schema_registry::tests::test_get_current_schema_version ... ok
test schema_registry::tests::test_get_schema_json_invalid_table ... ok
test schema_registry::tests::test_get_schema_json_valid_table ... ok
test validator::tests::test_magic_bytes_validation ... ok
test validator::tests::test_get_available_schemas ... ok
test validator::tests::test_get_current_version ... ok

test result: ok. 7 passed; 0 failed
```

## セキュリティ特性

| 項目 | 説明 |
|------|------|
| **スキーマ正規化** | クライアントスキーマをCanonical Avro形式に正規化して比較 |
| **バージョン検証** | クライアント送付スキーマが現バージョンと一致するか検証 |
| **データ完全性** | スキーマ一致後、Apache-avroでレコード単位の検証 |
| **外部ファイル不依存** | 真実のソースはRust内モデル（分散管理なし） |

## 関連ファイル

- [kc-api-database/src/schema_registry.rs](../../kc_api/crates/kc-api-database/src/schema_registry.rs)
- [kc-api-database/src/schema_version.rs](../../kc_api/crates/kc-api-database/src/schema_version.rs)
- [avro-wasm/src/schema_registry.rs](../avro-wasm/src/schema_registry.rs)
- [avro-wasm/src/validator.rs](../avro-wasm/src/validator.rs)
- [avro-wasm/Cargo.toml](../avro-wasm/Cargo.toml)

## 次のステップ

1. **WASM最適化**: `wasm-pack build --release`でサイズ最適化
2. **エラーメッセージ改善**: スキーマ不一致時の詳細情報
3. **複数バージョン並行サポート**: Blue-Green deploymentで実装
