# Hot/Cold アーキテクチャの明確化

## ❗️重要な誤解の訂正

### Q: 新しい形式ではAvroは使っていない？

**A: いいえ、Avroは引き続き使います！使う場所が違うだけです。**

## 📊 データフロー全体像

```
┌─────────────────────────────────────────────────────────────┐
│ 1. FUSOU-APP (Rust Client)                                  │
│    ├─ ゲームからAPIレスポンス受信                            │
│    ├─ Avroバイナリ生成 ✅ (現在と同じ)                       │
│    │   例: battle.avro (1000レコード, 50KB)                 │
│    │                                                         │
│    └─【変更点】Queue転送方法                                 │
│       ├─ 旧: Avro base64で送信 ❌                           │
│       └─ 新: JSONレコード配列で送信 ✅                       │
│           payload: {                                        │
│             tables: {                                       │
│               "battle": [{...}, {...}],  // 1000 records    │
│               "own_ship": [{...}],       // 4 records       │
│               ...                                           │
│             }                                               │
│           }                                                 │
└─────────────────────────────────────────────────────────────┘
                            ↓ 【1 HTTP リクエスト】
┌─────────────────────────────────────────────────────────────┐
│ 2. Cloudflare Queue                                         │
│    ├─ JSON形式で受信（パース不要、高速）                     │
│    └─ テーブルごとにメッセージ分割                           │
│       例: 10テーブル → 10メッセージ                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. buffer-consumer (D1 Writer)                              │
│    ├─ JSONレコードをそのまま D1 に INSERT                    │
│    └─ buffer_logs テーブル (Hot Storage)                    │
│       ├─ 検索・クエリ用にJSON保存                           │
│       └─ 保持期間: 数時間～数日                             │
└─────────────────────────────────────────────────────────────┘
                            ↓ 【定期Cron (1時間ごと)】
┌─────────────────────────────────────────────────────────────┐
│ 4. archival-worker (Cold Writer)                            │
│    ├─ D1からJSONレコード読み取り                             │
│    ├─ Avro OCF形式に変換 ✅ (ここでAvro生成!)                │
│    │   - Deflate圧縮（70%削減）                              │
│    │   - ユーザーごとに独立ブロック                          │
│    └─ R2 に保存 (Cold Storage)                              │
│       例: avro/2025-12-24/dataset_abc123.avro               │
│           ├─ Block 0: User A (1000 records)                 │
│           ├─ Block 1: User B (500 records)                  │
│           └─ Block Index in D1 (Range読み取り用)             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Reader (Hot + Cold マージ)                               │
│    ├─ 最新データ: D1 buffer_logs から読み取り (JSON)        │
│    ├─ 過去データ: R2 から Range読み取り (Avro)              │
│    │   Block Index使用 → ユーザーブロックのみ取得           │
│    └─ 透過的にマージして返却                                │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Avroの役割

### ✅ Avroを使う場所

1. **R2 Cold Storage** (メイン用途)
   - 長期保存の圧縮形式
   - Deflate圧縮で70%削減
   - Block単位のRange読み取り

2. **FUSOU-APP内部処理** (現在と同じ)
   - ゲームデータをAvro形式でシリアライズ
   - テーブルごとにAvroバイナリ生成

### ❌ Avroを使わない場所

1. **Queue転送** (新しい変更点)
   - 理由: JSONの方が処理が速い（パース不要）
   - デバッグが簡単（ログで内容確認可能）

2. **D1 Hot Storage**
   - 理由: SQLクエリにはJSON型が便利
   - 検索・集計がしやすい

## 🚀 一括送信の実装

### Rust側（FUSOU-APP）

```rust
use apache_avro::Reader;
use std::collections::HashMap;

impl R2StorageProvider {
    pub fn write_port_table<'a>(...) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            // Step 1: 全テーブルのAvroをJSONに変換
            let mut all_tables: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
            
            for (table_name, avro_data) in get_all_port_tables(table) {
                if avro_data.is_empty() {
                    continue;
                }
                
                // Avroバイナリ → JSONレコード配列
                let records = decode_avro_to_json(&avro_data)?;
                all_tables.insert(table_name, records);
                
                tracing::info!("Decoded {}: {} records", table_name, records.len());
            }
            
            // Step 2: 一括送信（1 HTTPリクエスト）
            send_batch_to_queue(
                dataset_id,
                period_tag,
                all_tables,
                user_id
            ).await?;
            
            Ok(())
        })
    }
}

fn decode_avro_to_json(avro_data: &[u8]) -> Result<Vec<serde_json::Value>, StorageError> {
    let reader = Reader::new(avro_data)
        .map_err(|e| StorageError::Operation(format!("Avro decode: {}", e)))?;
    
    let mut records = Vec::new();
    for value in reader {
        let value = value.map_err(|e| 
            StorageError::Operation(format!("Read value: {}", e))
        )?;
        
        // apache_avro::types::Value → serde_json::Value
        let json = serde_json::to_value(&value)
            .map_err(|e| StorageError::Operation(format!("To JSON: {}", e)))?;
        
        records.push(json);
    }
    
    tracing::info!("Decoded {} records from Avro", records.len());
    Ok(records)
}

async fn send_batch_to_queue(
    dataset_id: &str,
    period_tag: &str,
    tables: HashMap<String, Vec<serde_json::Value>>,
    user_id: &str,
) -> Result<(), StorageError> {
    let configs = configs::get_user_configs_for_app();
    let endpoint = configs.database.r2.get_queue_endpoint()?;
    
    // 一括送信ペイロード
    let payload = serde_json::json!({
        "dataset_id": dataset_id,
        "period_tag": period_tag,
        "tables": tables,  // HashMap<String, Vec<Value>>
        "uploaded_by": user_id
    });
    
    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|e| StorageError::Operation(format!("HTTP error: {}", e)))?;
    
    if !response.status().is_success() {
        return Err(StorageError::Operation(
            format!("Queue send failed: {}", response.status())
        ));
    }
    
    tracing::info!(
        "Sent batch to queue: {} tables, total {} records",
        tables.len(),
        tables.values().map(|v| v.len()).sum::<usize>()
    );
    
    Ok(())
}
```

### サーバー側（FUSOU-WEB）

新規エンドポイント `/api/queue/batch-send`:

```typescript
// src/server/routes/queue.ts
import { Hono } from 'hono';

const app = new Hono();

app.post('/batch-send', async (c) => {
  const { dataset_id, period_tag, tables, uploaded_by } = await c.req.json();
  
  // バリデーション
  if (!dataset_id || !tables || typeof tables !== 'object') {
    return c.json({ error: 'Invalid format' }, 400);
  }
  
  // テーブルごとにキューメッセージ作成
  const messages = [];
  for (const [table_name, records] of Object.entries(tables)) {
    if (!Array.isArray(records) || records.length === 0) {
      continue;
    }
    
    messages.push({
      body: {
        dataset_id,
        table: table_name,
        period_tag,
        records,
        uploaded_by
      }
    });
  }
  
  if (messages.length === 0) {
    return c.json({ error: 'No valid tables' }, 400);
  }
  
  // 一括送信（Queueのバッチ機能使用）
  await c.env.COMPACTION_QUEUE.sendBatch(messages);
  
  console.log(`Queued ${messages.length} tables with ${
    messages.reduce((sum, m) => sum + m.body.records.length, 0)
  } total records`);
  
  return c.json({ 
    success: true, 
    queued_tables: messages.length 
  });
});

export default app;
```

## 📈 パフォーマンス比較

### 旧実装（Avro base64）

```
クライアント → サーバー
  ├─ Avro binary (50KB)
  ├─ Base64エンコード (67KB) ❌ 33%増加
  └─ Queue転送

サーバー側
  ├─ Base64デコード
  ├─ Avroパース ❌ CPU消費
  └─ JSONに変換
```

**問題点:**
- ネットワーク帯域浪費（base64で33%増加）
- サーバーCPU消費（全ユーザー分のAvroパース）
- デバッグ困難（バイナリデータ）

### 新実装（JSON batch）

```
クライアント → サーバー
  ├─ Avroデコード（クライアント側）
  ├─ JSON生成 (80KB) ✅ 可読性向上
  └─ 一括送信（1リクエスト）

サーバー側
  ├─ JSONパース（高速）
  └─ そのままQueue転送 ✅ CPU消費なし
```

**メリット:**
- サーバー負荷ゼロ（転送のみ）
- デバッグ簡単（JSONログ）
- スケーラブル（クライアント側で分散処理）

## 🔧 設定ファイル変更

### configs.toml

```toml
[database.r2]
# 旧: バイナリアップロード用
upload_endpoint = "https://dev.fusou.pages.dev/api/battle-data/upload"

# 新: JSONバッチ送信用（追加）
queue_endpoint = "https://fusou-workflow.ogu-hide-u-425.workers.dev/api/queue/batch-send"
```

## ✅ まとめ

| 項目 | 旧実装 | 新実装 |
|------|--------|--------|
| Avro生成 | ✅ クライアント | ✅ クライアント（同じ） |
| Queue転送 | Avro base64 | JSON配列 |
| 送信方式 | テーブルごと | **一括送信** |
| D1保存 | JSON | JSON（同じ） |
| R2保存 | - | ✅ Avro OCF（新規） |
| 圧縮率 | - | **70%削減** |
| デバッグ | 困難 | 容易 |

**Avroは消えていません！R2での長期保存で重要な役割を果たします。**
