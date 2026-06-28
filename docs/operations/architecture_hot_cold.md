# Hot/Cold Architecture - Implementation Guide

## ✅ 実装完了コンポーネント

### 1. D1 Schema

- **File:** `docs/sql/d1/schema.sql`
- **Tables:** `buffer_logs`, `archived_files`, `block_indexes`
- **Views:** `hot_cold_summary`, `archive_efficiency`

### 2. Buffer Consumer (Queue → D1 Hot Storage)

- **File:** `packages/FUSOU-WORKFLOW/src/buffer-consumer.ts`
- **Features:**
  - Bulk Insert 最適化 (100+ records/query)
  - Chunked 処理 (大規模バッチ対応)
  - 高速 ACK (レスポンス時間 < 500ms)

### 3. Archiver (Cron Worker: Hot → Cold)

- **File:** `packages/FUSOU-WORKFLOW/src/cron.ts`
- **Features:**
  - Manual Avro Block Construction
  - Byte-level indexing
  - 圧縮サポート (deflate)
  - 安全なバッファクリーンアップ

### 4. Compression Utilities

- **File:** `packages/FUSOU-WORKFLOW/src/utils/compression.ts`
- **Codecs:** deflate (snappy 対応準備済み)
- **API:** async/sync, streaming 対応

### 5. Reader API (Hot + Cold Merge)

- **File:** `packages/FUSOU-WORKFLOW/src/reader.ts`
- **Features:**
  - R2 Range Request 最適化
  - 並列ブロック取得
  - Hot/Cold マージ・重複排除
  - キャッシュヘッダー最適化

---

## 🚀 デプロイ手順

### Step 1: D1 スキーマ適用

```bash
cd packages/FUSOU-WORKFLOW

# Local環境
npx wrangler d1 execute dev_kc_battle_index --local \
  --file=../../docs/sql/d1/schema.sql

# Remote環境
npx wrangler d1 execute dev_kc_battle_index --remote \
  --file=../../docs/sql/d1/schema.sql
```

### Step 2: wrangler.toml 設定

`packages/FUSOU-WORKFLOW/wrangler.toml`に以下を追加:

```toml
# ✅ Already present: compatibility_flags = ["nodejs_compat"]

# Scheduled Worker (Archiver - 毎時実行)
[triggers]
crons = ["0 * * * *"]  # Every hour at minute 0

# Queue Consumer (Buffer Writer)
[[queues.consumers]]
queue = "dev-kc-buffer-queue"
max_batch_size = 100
max_batch_timeout = 2
max_retries = 3
dead_letter_queue = "dev-kc-buffer-dlq"
```

### Step 3: メイン Worker への統合

`packages/FUSOU-WORKFLOW/src/index.ts`に追加:

```typescript
import BufferConsumer from "./buffer-consumer";
import Archiver from "./archiver";
import Reader from "./reader";

export default {
  // 既存のfetchハンドラ
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Reader API
    if (url.pathname.startsWith("/v1/read")) {
      return await Reader.fetch(request, env);
    }

    // 既存のハンドラ...
    return new Response("Not Found", { status: 404 });
  },

  // Queue Consumer (Buffer Writer)
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await BufferConsumer.queue(batch, env);
  },

  // Scheduled Worker (Archiver)
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await Archiver.scheduled(event, env, ctx);
  },
};
```

### Step 4: Queue 作成

```bash
# Buffer Queue
npx wrangler queues create dev-kc-buffer-queue

# Dead Letter Queue
npx wrangler queues create dev-kc-buffer-dlq
```

### Step 5: デプロイ

```bash
cd packages/FUSOU-WORKFLOW
npx wrangler deploy
```

---

## 🧪 テスト

### 1. Buffer Writer テスト (Hot Storage)

```bash
# Ingest APIにデータ送信
curl -X POST http://localhost:8787/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test-user-001",
    "table": "battle",
    "records": [
      {"timestamp": 1703001600000, "api_no": 1, "data": "test1"},
      {"timestamp": 1703001660000, "api_no": 2, "data": "test2"}
    ]
  }'

# D1でバッファ確認
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT COUNT(*) FROM buffer_logs"
```

### 2. Archiver テスト (Hot → Cold)

```bash
# 手動トリガー (Cron待たずにテスト)
npx wrangler dev
# Then visit: http://localhost:8787/__scheduled?cron=0+*+*+*+*

# R2でアーカイブ確認
npx wrangler r2 object list dev-kc-battle-data --prefix="battle/"

# D1でインデックス確認
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT * FROM block_indexes LIMIT 5"
```

### 3. Reader API テスト (Hot + Cold Merge)

```bash
# Hot + Coldデータ取得
curl "http://localhost:8787/v1/read?dataset_id=test-user-001&table_name=battle&from=1703001600000&to=1703005200000"

# レスポンス例:
# {
#   "dataset_id": "test-user-001",
#   "table_name": "battle",
#   "record_count": 42,
#   "hot_count": 10,
#   "cold_count": 32,
#   "records": [...]
# }
```

---

## 📊 モニタリング

### Hot/Cold 分布確認

```sql
SELECT * FROM hot_cold_summary;
```

### 圧縮効率確認

```sql
SELECT * FROM archive_efficiency ORDER BY compression_ratio DESC;
```

### 古い Hot データ検出 (2 時間以上)

```sql
SELECT COUNT(*) FROM buffer_logs
WHERE created_at < (strftime('%s', 'now') * 1000) - (2 * 60 * 60 * 1000);
```

---

## ⚠️ 注意事項

### 1. 既存システムとの共存

- **現在の`avro_files`/`avro_segments`テーブルは削除しない**
- Hot/Cold システムは**並行運用**
- 段階的移行: 新規データ → Hot/Cold、既存データ → 従来システム

### 2. コスト最適化

- **D1 Writes:** Bulk Insert 必須 (1 件ずつ禁止)
- **R2 Reads:** Range Request 必須 (全ファイルダウンロード禁止)
- **圧縮:** deflate 推奨 (2-5x 削減)

### 3. パフォーマンス目標

| 操作                    | 目標レイテンシ |
| ----------------------- | -------------- |
| Hot Read (D1)           | < 50ms         |
| Cold Read (1 block)     | < 200ms        |
| Cold Read (multi-block) | < 500ms        |
| Archival (hourly)       | < 5 minutes    |

---

## 🔄 次のステップ

### Phase 1 (完了 ✅)

- [x] D1 スキーマ設計
- [x] Buffer Consumer 実装
- [x] Archiver 実装
- [x] Reader API 実装
- [x] 圧縮ユーティリティ

### Phase 2 (未実装)

- [ ] 既存`avro_files`との統合
- [ ] Durable Object Cache for Block Index
- [ ] Snappy 圧縮サポート
- [ ] Analytics Dashboard

### Phase 3 (最適化)

- [ ] Auto-scaling Archiver (負荷に応じて頻度調整)
- [ ] Multi-region R2 Replication
- [ ] Advanced Caching Strategy

---

## 📖 参考資料

- [Architecture Design](../ARCHITECTURE_HOT_COLD.md)
- [D1 Schema](../sql/d1/schema.sql)
- [Avro Manual Construction](./src/avro-manual.ts)
- [Compression Utilities](./src/utils/compression.ts)

---

**Status:** Implementation Complete ✅  
**Ready for:** Testing & Deployment  
**Estimated Cost Reduction:** 60-80% (vs. direct R2 full-file access)
