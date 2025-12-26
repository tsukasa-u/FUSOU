# 🔍 FUSOU Avro データフロー完全監査ガイド

**作成日:** 2025-12-26  
**対象:** クライアント側 (FUSOU-APP) → サーバー側 (FUSOU-WEB) → ワーカー側 (FUSOU-WORKFLOW)  
**目的:** Avroバイナリの準備から保存まで、完全なデータフローを検証

---

## 📊 全体データフロー図

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT (FUSOU-APP)                                   │
│                                                                                 │
│  1. Battle データ収集                                                            │
│     └─ Cells::load() → Battle, Cells, AirBase 等を メモリに蓄積                  │
│                                                                                 │
│  2. Avro encode (各テーブル独立)                                                 │
│     └─ kc_api::database::table::PortTable::encode()                             │
│        └─ 33個のテーブルを各々 Apache Avro ライブラリで encode                   │
│        └─ 結果: PortTableEncode { env_info, cells, battle, ... }  ← Vec<u8>    │
│                                                                                 │
│  3. バイナリ連結                                                                 │
│     └─ storage/providers/r2/provider.rs [line 214]                              │
│        └─ concatenated = Vec<u8> (全テーブル結合)                               │
│        └─ metadata = [{table_name, start_byte, byte_length, format}]           │
│                                                                                 │
│  4. Upload 準備                                                                 │
│     └─ upload_to_r2()                                                           │
│        ├─ table_offsets JSON 作成 [line 253]                                    │
│        └─ handshake_body 生成                                                   │
│           ├─ period_tag: "YYYY_MM_DD"                                          │
│           ├─ dataset_id: user_member_id                                        │
│           ├─ table: "port_table"                                               │
│           ├─ file_size: concatenated.len()                                    │
│           ├─ table_offsets: JSON metadata                                      │
│           └─ content_hash: SHA-256(concatenated)                               │
│                                                                                 │
│  5. HTTPS POST → サーバー                                                       │
│     └─ /api/battle-data/upload (binary in body, metadata in JSON)             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    ⬇️ HTTPS ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (FUSOU-WEB)                                    │
│                                                                                 │
│  1. Handshake 受信・検証                                                        │
│     └─ POST /api/battle-data/upload                                            │
│        ├─ JWT 認証                                                              │
│        ├─ table_offsets JSON パース                                             │
│        ├─ metadata 検証 [validators/offsets.ts]                                 │
│        │  ├─ 各 offset が有効か？                                                │
│        │  ├─ 重複していないか？                                                  │
│        │  └─ ファイル内に収まっているか？                                        │
│        └─ content_hash 記録 (token に埋め込み)                                  │
│                                                                                 │
│  2. バイナリ分割                                                                 │
│     └─ routes/battle_data.ts [line 214]                                        │
│        └─ for each offset:                                                      │
│           ├─ slice = binary[start_byte : start_byte + byte_length]            │
│           ├─ Avro OCF ヘッダ検証 (magic bytes)                                  │
│           ├─ スキーマ抽出                                                        │
│           └─ 全レコード decode 検証                                             │
│                                                                                 │
│  3. Queue へ enqueue                                                             │
│     └─ COMPACTION_QUEUE.sendBatch()                                            │
│        └─ 各スライス → {table, avro_base64, datasetId, periodTag, ...}        │
│                                                                                 │
│  4. レスポンス                                                                   │
│     └─ { ok: true, dataset_id, table, period_tag }                             │
│        ├─ status: 200                                                           │
│        └─ ※ R2 へのアップロードは async で実行 (ここでは完了を待たない)         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    ⬇️ Queue ⬇️
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       WORKER (FUSOU-WORKFLOW)                                  │
│                                                                                 │
│  1. Queue メッセージ受信                                                        │
│     └─ handleBufferConsumer() [buffer-consumer.ts]                             │
│        └─ batch: [{table, avro_base64, datasetId, periodTag, ...}]            │
│                                                                                 │
│  2. Base64 → Binary 変換                                                        │
│     └─ avroBytes = Uint8Array.from(atob(avro_base64), ...)                    │
│                                                                                 │
│  3. Defense-in-depth 検証 (2段階)                                               │
│     ├─ ✅ 軽量チェック: OCF ヘッダ (magic bytes, codec)                         │
│     └─ ✅ 完全検証: 全レコード decode [avro-validator.ts]                      │
│                                                                                 │
│  4. Hot Storage に書き込み                                                      │
│     └─ D1 buffer_logs テーブル (bulk insert)                                   │
│        ├─ dataset_id                                                            │
│        ├─ table_name                                                            │
│        ├─ period_tag                                                            │
│        ├─ schema_version                                                        │
│        ├─ timestamp (now)                                                       │
│        ├─ data (Avro バイナリ BLOB)                                             │
│        └─ uploaded_by (userId)                                                 │
│                                                                                 │
│  ※ 注意: 各レコードには _dataset_id フィールドが追加されない                     │
│     (Avro スキーマ内で定義されていないため、Avro decoder が失敗する可能性)      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 フェーズ別検証チェックリスト

### **フェーズ 1️⃣: クライアント側スキーマ定義**

**ファイル:** 
- [kc_api/crates/kc-api-database/src/table.rs](kc_api/crates/kc-api-database/src/table.rs#L114) (PortTableEncode 定義)
- [kc_api 内 Avro スキーマ定義](kc_api/bindings/) (各テーブルのスキーマ)

**検証チェック:**

| # | 項目 | ファイル | 行番号 | 期待値 | 状態 |
|---|------|---------|--------|--------|------|
| 1.1 | `PortTableEncode` 構造体 | table.rs | 114-148 | 33個の `Vec<u8>` フィールド定義 | ✅ |
| 1.2 | `encode()` メソッド | table.rs | 431 | AvroSchemaで encode → PortTableEncode | ⏳ 確認要 |
| 1.3 | スキーマが Avro 準拠か | kc_api/bindings | - | Apache Avro JSON スキーマ形式 | ⏳ 確認要 |
| 1.4 | null 許容フィールド | - | - | `Option<T>` → `["null", type]` union | ⏳ 確認要 |
| 1.5 | ネストされた構造体 | - | - | 各フィールド型が flatten されているか？ | ⏳ 確認要 |

**デバッグ:**
```rust
// 1.2 検証: encode() の動作確認
let port_table = PortTable::new(cells, user_env, timestamp);
match port_table.encode() {
    Ok(PortTableEncode { env_info, cells, battle, ... }) => {
        println!("✅ Encoded {} tables", 33);  // Should be 33 tables
        println!("env_info: {} bytes", env_info.len());
        println!("cells: {} bytes", cells.len());
        // ...
    },
    Err(e) => println!("❌ Encode failed: {}", e),
}
```

---

### **フェーズ 2️⃣: クライアント側バイナリ準備**

**ファイル:** [FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs](FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs)

**検証チェック:**

| # | ステップ | 行番号 | コード位置 | 期待値 | 検証方法 |
|---|---------|--------|-----------|--------|---------|
| 2.1 | テーブル抽出 | 160 | `get_all_port_tables()` | 空でないテーブルのみ抽出 | ログで確認 |
| 2.2 | 連結開始 | 214 | `let mut concatenated = Vec::new()` | 初期化されたバイナリ | 確認 |
| 2.3 | Offset 計算 | 216-222 | `start_byte`, `byte_length` 計算 | offset が連続か？ 重複なしか？ | チェック |
| 2.4 | Metadata 構造体 | 224-231 | `TableMeta` 定義 | `{table_name, start_byte, byte_length, format}` | ✅ |
| 2.5 | JSON シリアライズ | 253 | `serde_json::to_string(&metadata)` | 有効な JSON か？ | パース確認 |
| 2.6 | ログ出力 | 251-252 | `tracing::info!` | table_offsets JSON ログ | 確認 |

**クリティカルチェック:**

```rust
// 2.3-2.5 検証: metadata の整合性確認
let metadata = vec![
    TableMeta { table_name: "env_info", start_byte: 0, byte_length: 512, format: "avro".to_string() },
    TableMeta { table_name: "cells", start_byte: 512, byte_length: 1024, format: "avro".to_string() },
    // ...
];

// ✅ 確認: offset が連続か？
let mut expected_start = 0;
for entry in &metadata {
    assert_eq!(entry.start_byte, expected_start, "Gap at {}", entry.table_name);
    expected_start += entry.byte_length;
}

// ✅ 確認: 全体サイズが一致か？
let total = metadata.iter().map(|m| m.byte_length).sum::<usize>();
assert_eq!(total, concatenated.len());
```

**デバッグ:**
```bash
# ログファイルから metadata を抽出
tail -f ~/.config/[app-name]/logs/debug.log | grep "table_offsets JSON"

# 例:
# table_offsets JSON: [{"table_name":"env_info","start_byte":0,"byte_length":512,"format":"avro"},...]
```

---

### **フェーズ 3️⃣: Upload Handshake 構築**

**ファイル:** [FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs](FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs#L35)

**検証チェック:**

| # | パラメータ | ソース | 行番号 | 値例 | 検証ルール |
|---|-----------|--------|--------|------|-----------|
| 3.1 | `period_tag` | supabase auth | - | `"2025_12_23"` | `YYYY_MM_DD` 形式 |
| 3.2 | `path_tag` | [265] | `format!("{}-port-{}-{}", period_tag, maparea_id, mapinfo_no)` | `"2025_12_23-port-1-1"` | 一意か？ |
| 3.3 | `dataset_id` | `get_user_member_id()` | - | 64文字 SHA256 ハッシュ | user 固有 ID |
| 3.4 | `table_name` | 定数 | [265] | `"port_table"` | 常に同じ |
| 3.5 | `file_size` | `concatenated.len()` | [267] | e.g., 50000 | binary のバイト数 |
| 3.6 | `table_offsets` | JSON | [253] | `[{...}]` JSON 配列 | valid JSON か？ |
| 3.7 | `content_hash` | SHA-256 | - | 64文字 hex | クライアントで計算 |
| 3.8 | `schema_version` | `kc_api::SCHEMA_VERSION` | - | `"v1"` | バージョン管理 |

**デバッグ:**
```rust
// 3.1-3.8 検証: Handshake 内容確認
let handshake_body = fusou_upload::Uploader::build_battle_data_handshake(
    &period_tag,           // "2025_12_23"
    &path_tag,             // "2025_12_23-port-1-1"
    &dataset_id,           // user_member_id
    "port_table",
    concatenated.len() as u64,
    &table_offsets,        // JSON metadata
    kc_api::SCHEMA_VERSION,
);

println!("Handshake body: {:?}", handshake_body);
// 期待値:
// Handshakebody {
//     period_tag: "2025_12_23",
//     path_tag: "2025_12_23-port-1-1",
//     dataset_id: "[user hash]",
//     table: "port_table",
//     file_size: 50000,
//     table_offsets: "[{...}]",
//     content_hash: "[sha256]",
//     schema_version: "v1",
// }
```

---

### **フェーズ 4️⃣: サーバー側受信エンドポイント**

**ファイル:** [FUSOU-WEB/src/server/routes/battle_data.ts](FUSOU-WEB/src/server/routes/battle_data.ts#L80)

**検証チェック:**

| # | ステップ | 行番号 | 処理 | 期待値 | 状態 |
|---|---------|--------|------|--------|------|
| 4.1 | JWT 認証 | ~95 | `validateJWT(token)` | token 有効 | ✅ |
| 4.2 | Body パース | ~100 | `request.json()` | valid JSON | ✅ |
| 4.3 | dataset_id 抽出 | 92 | `body.dataset_id.trim()` | non-empty | ⏳ |
| 4.4 | table 抽出 | 93 | `body.table.trim()` | non-empty | ⏳ |
| 4.5 | period_tag 抽出 | 94 | `body.kc_period_tag.trim()` | valid format | ⏳ |
| 4.6 | table_offsets JSON パース | 156 | `JSON.parse(tableOffsets)` | valid array | ⏳ |
| 4.7 | Offset metadata 検証 | 158 | `validateOffsetMetadata()` | no overlaps, within bounds | ✅ |
| 4.8 | content_hash 記録 | 146 | token に埋め込み | SHA-256 hex | ✅ |

**バリデータ詳細:** [FUSOU-WEB/src/server/validators/offsets.ts](FUSOU-WEB/src/server/validators/offsets.ts)

```typescript
// 4.7 検証ロジック
export function validateOffsetMetadata(
  offsets: TableOffsetMetadata[],
  totalFileSize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (let i = 0; i < offsets.length; i++) {
    const current = offsets[i];

    // ✅ Check: 負の offset か？
    if (current.start_byte < 0) {
      errors.push(`Table '${current.table_name}' has negative start_byte`);
    }

    // ✅ Check: 無効な length か？
    if (current.byte_length <= 0) {
      errors.push(`Table '${current.table_name}' has invalid byte_length`);
    }

    // ✅ Check: ファイルサイズ超過か？
    const endByte = current.start_byte + current.byte_length;
    if (endByte > totalFileSize) {
      errors.push(`Table '${current.table_name}' exceeds file size`);
    }

    // ✅ Check: 他のテーブルと重複か？
    for (let j = i + 1; j < offsets.length; j++) {
      const other = offsets[j];
      const otherEnd = other.start_byte + other.byte_length;
      const overlap = !(endByte <= other.start_byte || current.start_byte >= otherEnd);
      if (overlap) {
        errors.push(`Table '${current.table_name}' overlaps with '${other.table_name}'`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

### **フェーズ 5️⃣: Avro バイナリ分割・検証**

**ファイル:** [FUSOU-WEB/src/server/routes/battle_data.ts](FUSOU-WEB/src/server/routes/battle_data.ts#L214)

**処理フロー:**

```typescript
// 5.1: バイナリ分割
for (const entry of offsets) {
  const start = Number(entry.start_byte ?? 0);
  const len = Number(entry.byte_length ?? 0);
  const tname = String(entry.table_name ?? table);
  
  const slice = data.subarray(start, start + len);
  // slice: Uint8Array of exactly [len] bytes
}

// 5.2: OCF ヘッダ検証
const headerCheck = validateAvroHeader(slice, maxBytes);
// ✅ Check:
//   - Magic bytes: 0x4F 0x62 0x6A 0x01 ("Obj\x01")
//   - Size <= 64KB
//   - Codec: not "deflate" or "snappy" (no decompression bombs)

// 5.3: スキーマ抽出
const schemaJson = extractSchemaFromOCF(slice);
// ✅ Returns: JSON string or null
// 例: '{"type":"record","name":"Battle","fields":[...]}'

// 5.4: 完全デコード検証
const decodeResult = await validateAvroOCF(slice, schemaJson);
// ✅ Check:
//   - All records decode successfully
//   - No schema mismatches
//   - recordCount > 0
```

**クリティカルチェック:**

| # | 検証 | コード | 期待値 | 失敗時動作 |
|---|-----|--------|--------|-----------|
| 5.1 | slice 範囲チェック | `start + len <= data.length` | true | 400 error |
| 5.2 | Magic bytes | `slice[0:4] == [0x4F, 0x62, 0x6A, 0x01]` | true | 400 error |
| 5.3 | Size limit | `slice.length <= 64KB` | true | 400 error |
| 5.4 | Codec チェック | `avro.codec != "deflate"` | true | 400 error |
| 5.5 | スキーマ抽出 | `extractSchemaFromOCF()` result | non-null | 400 error |
| 5.6 | 全レコードデコード | `validateAvroOCF()` result | `valid: true` | 400 error |

---

### **フェーズ 6️⃣: スキーマ検証**

**ファイル:** [FUSOU-WEB/src/server/utils/avro-validator.ts](FUSOU-WEB/src/server/utils/avro-validator.ts)

**スキーマ型マッピング検証:**

```typescript
// 6.1: Avro 型チェック
interface AvroTypeMapping {
  "string": string,
  "long": number,
  "int": number,
  "float": number,
  "double": number,
  "boolean": boolean,
  "bytes": Uint8Array,
  "null": null,
  ["null", "int"]: number | null,  // union
  ["array", "string"]: string[],   // array
  ["record"]: { [key: string]: any }  // nested record
}

// 6.2: Union type (nullable) チェック
const field = { name: "boss_form", type: ["null", "int"] };
// ✅ Valid: データは null または int
// ❌ Invalid: null 以外が type[0]

// 6.3: Record チェック
const schema = {
  type: "record",
  name: "Battle",
  fields: [
    { name: "cell_no", type: "long" },
    { name: "battle_order", type: { type: "array", items: "int" } },
    // ...
  ]
};
// ✅ Decoder は各 field を type に従い decode
```

**Avro OCF デコード処理:**

```typescript
export async function validateAvroOCF(
  avroBytes: Uint8Array,
  expectedSchema: string | object
): Promise<DecodeValidationResult> {
  const schemaObj = typeof expectedSchema === 'string' 
    ? JSON.parse(expectedSchema) 
    : expectedSchema;
  
  const type = avro.Type.forSchema(schemaObj);
  const stream = Readable.from(Buffer.from(avroBytes));
  const decoder = type.createFileDecoder(stream);
  
  let recordCount = 0;
  const errors: string[] = [];
  
  // 6.4: 全レコード decode
  await new Promise<void>((resolve, reject) => {
    decoder.on('data', () => {
      recordCount++;
      // ✅ Record successfully decoded
      // ✅ Schema conformant
    });
    
    decoder.on('error', (err) => {
      errors.push(err.message);
      reject(err);
    });
    
    decoder.on('end', () => {
      resolve();
    });
  });
  
  return { valid: errors.length === 0, recordCount, error: errors[0] };
}
```

**検証チェック:**

| # | 項目 | 期待値 | 検証方法 |
|---|------|--------|---------|
| 6.1 | スキーマ JSON 解析可能 | `JSON.parse()` 成功 | try-catch で確認 |
| 6.2 | スキーマ形式が record | `schema.type === "record"` | 確認 |
| 6.3 | 全フィールド定義済み | 各データに対応 field がある | decoder で自動検証 |
| 6.4 | Union type 正しい | `["null", type]` 形式 | decoder で検証 |
| 6.5 | 全レコードデコード成功 | `recordCount > 0` | 確認 |
| 6.6 | スキーマバージョン一致 | client と server で同じ | metadata で確認 |

---

### **フェーズ 7️⃣: Queue enqueue**

**ファイル:** [FUSOU-WEB/src/server/routes/battle_data.ts](FUSOU-WEB/src/server/routes/battle_data.ts#L300)

**検証チェック:**

| # | ステップ | 行番号 | 処理 | 期待値 |
|---|---------|--------|------|--------|
| 7.1 | Messages 構築 | 293 | `messages.push({ body: {...} })` | ✅ |
| 7.2 | Base64 エンコード | 292 | `arrayBufferToBase64(slice)` | valid base64 |
| 7.3 | Queue binding 確認 | 77 | `COMPACTION_QUEUE` 存在 | non-null |
| 7.4 | sendBatch 呼び出し | 303 | `await env.runtime.COMPACTION_QUEUE.sendBatch(messages)` | success |
| 7.5 | エラーハンドリング | 308 | queue エラーをログ | error を記録 |

**メッセージフォーマット:**

```typescript
interface QueueMessage {
  body: {
    table: string;           // e.g., "env_info"
    avro_base64: string;     // base64(Avro OCF binary)
    datasetId: string;       // user hash
    periodTag: string;       // "2025_12_23"
    schemaVersion: string;   // "v1"
    triggeredAt: string;     // ISO8601 timestamp
    userId: string;          // user ID
  }
}
```

---

### **フェーズ 8️⃣: Worker側 Queue 消費**

**ファイル:** [FUSOU-WORKFLOW/src/buffer-consumer.ts](FUSOU-WORKFLOW/src/buffer-consumer.ts)

**検証チェック:**

| # | ステップ | 行番号 | 処理 | 期待値 |
|---|---------|--------|------|--------|
| 8.1 | Message 受信 | 165 | `batch.messages` | array of QueueMessage |
| 8.2 | Base64 デコード | 149 | `Uint8Array.from(atob(...))` | valid bytes |
| 8.3 | Avro ヘッダ検証 (軽量) | 152 | `validateAvroHeader()` | valid magic bytes |
| 8.4 | スキーマ抽出 | 158 | `extractSchemaFromOCF()` | non-null JSON |
| 8.5 | 完全デコード検証 | 161 | `validateAvroOCF()` | valid: true, recordCount > 0 |
| 8.6 | D1 bulk insert | 178 | `buildBulkInsertSQL(recordCount)` | SQL generated |
| 8.7 | Buffer log 書き込み | 183 | `await env.BATTLE_INDEX_DB.prepare(sql).bind(...).run()` | success |
| 8.8 | Message ACK | 197 | `msg.ack()` | メッセージ削除 |

**Defense-in-depth の 2段階検証:**

```typescript
// ✅ 8.3: 軽量チェック (速い)
function validateAvroHeader(data: Uint8Array): { valid: boolean; error?: string } {
  // Size limit
  if (data.byteLength > 1048576) {  // 1MB
    return { valid: false, error: 'Too large' };
  }
  
  // Magic bytes
  if (data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
    return { valid: false, error: 'Invalid magic bytes' };
  }
  
  // Codec check
  const text = new TextDecoder().decode(data.slice(0, 512));
  if (text.includes('deflate') || text.includes('snappy')) {
    return { valid: false, error: 'Compressed codec not allowed' };
  }
  
  return { valid: true };
}

// ✅ 8.5: 完全検証 (重い)
const decodeResult = await validateAvroOCF(avroBytes, schemaJson);
// → avsc ライブラリで全レコード decode
// → schema conformance check
// → recordCount 記録
```

**D1 buffer_logs テーブル構造:**

```sql
CREATE TABLE buffer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,  -- ms since epoch
  data BLOB NOT NULL,          -- Avro OCF binary
  uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id),
  INDEX idx_buffer_dataset_table (dataset_id, table_name)
);
```

---

## 🚨 クリティカル問題チェックリスト

### ⚠️ 問題 1: `_dataset_id` フィールド汚染

**現象:** 
- Avro レコードに `_dataset_id` フィールドが存在する
- Avro decoder が失敗する可能性

**検証:**

```typescript
// ❌ 悪い例 (汚染)
const record = {
  cell_no: 1,
  battle_order: [...],
  _dataset_id: "user_hash",  // ← 不要! Avro スキーマにない
};

// ✅ 正しい例
const record = {
  cell_no: 1,
  battle_order: [...],
  // _dataset_id は含まない
};
```

**確認方法:** [FUSOU-WORKFLOW/test/verify-no-pollution.mjs](FUSOU-WORKFLOW/test/verify-no-pollution.mjs)

```bash
node test/verify-no-pollution.mjs
# 期待出力: ✅ No _dataset_id pollution detected
```

**検証チェック:**

| # | 場所 | 確認内容 |
|---|------|---------|
| 1.1 | FUSOU-APP (Rust) | `PortTable::encode()` で `_dataset_id` を追加していないか？ |
| 1.2 | FUSOU-WEB (TS) | バイナリ分割時に追加していないか？ |
| 1.3 | FUSOU-WORKFLOW (TS) | queue consumer で追加していないか？ |
| 1.4 | D1 buffer_logs | `data` BLOB に含まれていないか？ |

---

### ⚠️ 問題 2: スキーマバージョンミスマッチ

**現象:**
- Client: schema v1
- Server: schema v2
- → Decoder fail

**検証:**

```typescript
// ✅ 確認: client が送るバージョン
const schemaVersion = kc_api::SCHEMA_VERSION;  // e.g., "v1"

// ✅ 確認: server が受け取るバージョン
const receivedVersion = body.schema_version;  // e.g., "v1"

// ✅ 確認: 一致しているか？
assert_eq!(schemaVersion, receivedVersion);
```

---

### ⚠️ 問題 3: Offset メタデータ不一致

**現象:**
- Client が送るメタデータと実データがズレている
- → Server が間違ったバイト範囲を抽出

**検証:**

```typescript
// ✅ 確認: metadata の完全性
const totalDeclared = metadata.reduce((sum, m) => sum + m.byte_length, 0);
const totalActual = data.length;
assert_eq!(totalDeclared, totalActual, "Size mismatch");

// ✅ 確認: offset が連続か？
let pos = 0;
for (const m of metadata) {
  assert_eq!(m.start_byte, pos, "Gap detected");
  pos += m.byte_length;
}

// ✅ 確認: 重複がないか？
for (let i = 0; i < metadata.length - 1; i++) {
  const end1 = metadata[i].start_byte + metadata[i].byte_length;
  const start2 = metadata[i + 1].start_byte;
  assert!(end1 <= start2, "Overlap detected");
}
```

---

### ⚠️ 問題 4: Content Hash ミスマッチ

**現象:**
- Client: SHA256(binary) = "abc..."
- Server: バイナリ受信後に SHA256 計算 = "def..."
- → Upload rejected

**検証:**

```typescript
// ✅ Client-side
const contentHash = SHA256(concatenated);  // "abc123..."

// ✅ Server-side
const received = await request.arrayBuffer();
const receivedHash = SHA256(received);     // should be "abc123..."

// ✅ Token verification
if (contentHash !== receivedHash) {
  return error("Content hash mismatch");
}
```

---

### ⚠️ 問題 5: Empty Tables

**現象:**
- Client が空のテーブル (0 bytes) を送信
- Server が処理しない
- → データ損失？

**検証:**

```typescript
// ✅ Client-side: check
for (const [name, bytes] of tables {
  if (bytes.is_empty()) {
    console.warn("Empty table found:", name);
    // Option: skip or log
  }
}

// ✅ Server-side: validate
for (const entry of offsets) {
  if (entry.byte_length <= 0) {
    return error("Invalid byte_length");
  }
}
```

---

## 📈 パフォーマンス・スケール検証

### ベンチマーク目標

| メトリクス | 目標 | 許容範囲 |
|-----------|------|---------|
| バイナリ連結 (1MB) | < 100ms | 200ms |
| JSON メタデータパース | < 10ms | 50ms |
| Avro header validation | < 5ms | 20ms |
| Full Avro decode (1000 records) | < 500ms | 1s |
| Queue enqueue (batch 100 msgs) | < 100ms | 500ms |
| D1 bulk insert (100 rows) | < 200ms | 500ms |
| Total E2E (handshake → buffer) | < 2s | 5s |

### メモリ使用量チェック

| 処理 | メモリ上限 | Cloudflare制限 |
|-----|----------|-------|
| 連結バイナリ | 50MB | 512MB (Pages) / 128MB (Worker) |
| Queue message | 64KB | 100KB (WQ limit) |
| D1 bulk insert | 10MB | unlimited |

---

## 🧪 テストコマンド集

### 1. Client-side Avro generation

```bash
# FUSOU-APP ビルド & テスト
cd FUSOU-APP/src-tauri
cargo test --package kc-api-database -- avro

# ログ確認
tail -f ~/.config/[app-name]/logs/debug.log | grep "table_offsets"
```

### 2. Server-side validation

```bash
# FUSOU-WEB ローカル開発
cd FUSOU-WEB
npm run dev

# テスト upload
curl -X POST "http://localhost:3000/api/battle-data/upload" \
  -H "Authorization: Bearer $(echo -n 'test' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test_user",
    "table": "port_table",
    "kc_period_tag": "2025_12_23",
    "file_size": 1000,
    "binary": true,
    "table_offsets": "[{\"table_name\":\"env_info\",\"start_byte\":0,\"byte_length\":500,\"format\":\"avro\"}]",
    "content_hash": "abc123...",
    "path": "2025_12_23-port-1-1"
  }'
```

### 3. Worker-side queue consumer

```bash
# FUSOU-WORKFLOW ローカル開発
cd FUSOU-WORKFLOW
npx wrangler dev

# Queue シミュレート
curl -X POST "http://localhost:8787/__scheduled" \
  -H "X-Cron: * * * * *"

# ログ確認
tail -f logs/worker.log | grep "Consumer\|Buffer"
```

### 4. Avro binary inspection

```bash
# Avro ファイルのスキーマ抽出
npm run build && node -e "
import { extractSchemaFromOCF } from './dist/avro-validator.js';
const fs = require('fs');
const data = fs.readFileSync('./test/sample.avro');
console.log(extractSchemaFromOCF(data));
"

# Avro レコード count
npm install -g apache-avro-tools
avro-tools tojson sample.avro | wc -l
```

### 5. Pollution チェック

```bash
# _dataset_id フィールドの確認
node test/verify-no-pollution.mjs

# 期待出力:
# ✅ No _dataset_id pollution in 100 records
```

---

## 📋 最終チェックリスト

```markdown
### クライアント側 (FUSOU-APP)

- [ ] PortTable::encode() が 33個テーブルを encode
- [ ] 各テーブルが 0 bytes でない
- [ ] concatenated バイナリが offset と一致
- [ ] table_offsets JSON が valid か？
- [ ] content_hash が SHA-256 hex か？
- [ ] period_tag が YYYY_MM_DD 形式か？
- [ ] dataset_id が non-empty か？

### サーバー側 (FUSOU-WEB)

- [ ] JWT 認証が成功
- [ ] table_offsets JSON パース成功
- [ ] validateOffsetMetadata で errors なし
- [ ] 各スライスの OCF magic bytes が正しい
- [ ] schemaJson 抽出成功
- [ ] validateAvroOCF で decode 成功
- [ ] recordCount > 0
- [ ] Queue.sendBatch() 成功
- [ ] レスポンス 200 OK

### ワーカー側 (FUSOU-WORKFLOW)

- [ ] Queue message 受信
- [ ] Base64 デコード成功
- [ ] Avro header validation (軽量)
- [ ] Avro full decode validation
- [ ] schema extract 成功
- [ ] recordCount > 0
- [ ] D1 bulk insert SQL 生成
- [ ] D1 insert 成功 (success: true)
- [ ] Message ACK

### D1 データベース

- [ ] buffer_logs テーブル存在
- [ ] dataset_id 行が存在
- [ ] table_name が正しい
- [ ] period_tag が YYYY_MM_DD か？
- [ ] schema_version が "v1" か？
- [ ] data BLOB が non-null
- [ ] uploaded_by が記録されているか？

### 汚染チェック

- [ ] `_dataset_id` フィールドなし
- [ ] スキーマ以外のフィールドなし
- [ ] Avro decoder が失敗しない

### パフォーマンス

- [ ] E2E レイテンシ < 2s
- [ ] メモリ使用量 OK
- [ ] Queue throughput OK
```

---

## 🔗 参考ファイル一覧

**Client (FUSOU-APP):**
- [src-tauri/src/storage/submit_data.rs](FUSOU-APP/src-tauri/src/storage/submit_data.rs) - submit_port_table()
- [src-tauri/src/storage/providers/r2/provider.rs](FUSOU-APP/src-tauri/src/storage/providers/r2/provider.rs) - upload_to_r2()

**Server (FUSOU-WEB):**
- [src/server/routes/battle_data.ts](FUSOU-WEB/src/server/routes/battle_data.ts) - POST /upload
- [src/server/validators/offsets.ts](FUSOU-WEB/src/server/validators/offsets.ts) - validateOffsetMetadata()
- [src/server/utils/avro-validator.ts](FUSOU-WEB/src/server/utils/avro-validator.ts) - validateAvroOCF()
- [src/server/utils/upload.ts](FUSOU-WEB/src/server/utils/upload.ts) - handleTwoStageUpload()

**Worker (FUSOU-WORKFLOW):**
- [src/buffer-consumer.ts](FUSOU-WORKFLOW/src/buffer-consumer.ts) - handleBufferConsumer()
- [src/avro-validator.ts](FUSOU-WORKFLOW/src/avro-validator.ts) - validateAvroOCF()
- [src/avro-manual.ts](FUSOU-WORKFLOW/src/avro-manual.ts) - Avro manual implementation
- [test/verify-no-pollution.mjs](FUSOU-WORKFLOW/test/verify-no-pollution.mjs) - pollution check

**Database:**
- [docs/sql/d1/setup.sh](docs/sql/d1/setup.sh) - D1 table creation
- [docs/sql/d1/avro-schema.sql](docs/sql/d1/avro-schema.sql) - avro_files table

---

**最終更新:** 2025-12-26 by Copilot
