# Hot/Cold Architecture Design for FUSOU Battle Data System

## Overview

統合戦略: 現在のAvroベース戦闘データシステムにHot/Cold分離アーキテクチャを統合します。

### Current System (Before)
- Queue → Consumer → R2 Avro Append (Immediate)
- D1: `avro_files`, `avro_segments` (Metadata only)
- Read: Direct R2 access with full file download

### New System (After)
- Queue → **Buffer Consumer** → **D1 Buffer** (Hot, 1時間分)
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

### 新規テーブル (Hot/Cold統合用)

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

#### 2. `archived_files` - R2ファイル正規化
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
    file_id INTEGER NOT NULL,        -- archived_files.id
    start_byte INTEGER NOT NULL,     -- R2 Range Request開始位置
    length INTEGER NOT NULL,         -- データ長
    record_count INTEGER,            -- ブロック内レコード数
    start_timestamp INTEGER,         -- ブロック内最初のタイムスタンプ
    end_timestamp INTEGER,           -- ブロック内最後のタイムスタンプ
    FOREIGN KEY (file_id) REFERENCES archived_files(id)
);

CREATE INDEX idx_block_search 
    ON block_indexes (dataset_id, table_name, start_timestamp);
CREATE INDEX idx_block_file 
    ON block_indexes (file_id);
```

### 既存テーブルとの関係

- **`avro_files`/`avro_segments`**: 既存のリアルタイム書き込みシステムと**並行運用**
  - リアルタイム: 即座にR2へ保存（小規模・頻繁アクセス）
  - バッチ: Hot → Cold移行（大規模・効率的）

**統合方針:**
- リアルタイム要求: 既存システム継続使用
- 分析系要求: Hot/Cold統合読み出し
- 段階移行: まずログシステムで実装 → 戦闘データへ段階適用

---

## Implementation Plan

### Phase 1: Parallel Infrastructure (新規ログシステム)
1. 新規D1スキーマ作成 (`buffer_logs`, `archived_files`, `block_indexes`)
2. Buffer Consumer実装 (Bulk Insert)
3. Archiver Cron実装 (Manual Avro Block Construction)
4. Reader API実装 (Hot + Cold Merge)

### Phase 2: Battle Data Integration (既存システム拡張)
1. 既存`avro_files`との統合設計
2. Migration Strategy (既存データのCold化)
3. Unified Query Interface

### Phase 3: Optimization
1. Durable Object Cache for Block Index
2. Compression (`deflate`/`snappy`)
3. Cache-Control Headers for Cold Data

---

## Key Optimizations

### 1. Compression (必須)
- R2保存時: `deflate` または `snappy` 圧縮
- `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]` ✅ 既に設定済み

### 2. Range Request (必須)
```typescript
// ❌ NG: Full download
const obj = await R2.get(key);

// ✅ OK: Range Request
const obj = await R2.get(key, {
  range: { offset: startByte, length: blockLength }
});
```

### 3. Bulk Insert (D1課金対策)
```typescript
// ❌ NG: 1件ずつINSERT
for (const record of records) {
  await db.prepare('INSERT INTO buffer_logs...').bind(record).run();
}

// ✅ OK: Bulk Insert
const values = records.map(r => `(?,?,?)`).join(',');
const params = records.flatMap(r => [r.dataset_id, r.timestamp, r.data]);
await db.prepare(`INSERT INTO buffer_logs VALUES ${values}`).bind(...params).run();
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
