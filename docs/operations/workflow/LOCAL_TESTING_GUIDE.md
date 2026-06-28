# Hot/Cold Architecture - ローカルテストガイド

## ✅ テストの準備完了

### 1. コンパイル済み
```bash
✓ TypeScript → JavaScript (dist/)
✓ すべてのモジュールがインポート可能
✓ Avro生成動作確認済み
```

### 2. D1スキーマ適用済み
```bash
✓ buffer_logs (Hot Storage)
✓ archived_files (Cold File Registry)
✓ block_indexes (Range Request Index)
```

## 🚀 ローカルテスト手順

### Step 1: Wrangler Dev起動
```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-WORKFLOW
npx wrangler dev --local
```

### Step 2: Buffer Consumer テスト (Hot Storage)

**POST リクエスト送信:**
```bash
curl -X POST http://localhost:8787/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test-user-001",
    "table": "battle",
    "records": [
      {"timestamp": 1703302800000, "api_no": 1, "result": "S", "data": "test1"},
      {"timestamp": 1703302860000, "api_no": 2, "result": "A", "data": "test2"},
      {"timestamp": 1703302920000, "api_no": 3, "result": "B", "data": "test3"}
    ],
    "uploaded_by": "local-test"
  }'
```

**D1で確認:**
```bash
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT COUNT(*) as count, dataset_id, table_name FROM buffer_logs GROUP BY dataset_id, table_name"
```

### Step 3: Archiver テスト (Hot → Cold)

**手動トリガー:**
```bash
curl http://localhost:8787/__scheduled?cron=*
```

または、Archiverを直接呼び出すエンドポイントを作成:
```typescript
// cron.ts に追加
export default {
  async fetch(request: Request, env: Env) {
    if (request.url.endsWith('/archive')) {
      await handleArchiver(env);
      return new Response('Archival complete', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  },
  scheduled: handleArchiver
};
```

**アーカイブ確認:**
```bash
# archived_files テーブル確認
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT id, file_path, file_size, compression_codec FROM archived_files"

# block_indexes テーブル確認
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT dataset_id, table_name, file_id, record_count, start_byte, length FROM block_indexes"

# buffer_logs クリーンアップ確認
npx wrangler d1 execute dev_kc_battle_index --local \
  --command="SELECT COUNT(*) as remaining FROM buffer_logs"
```

### Step 4: Reader テスト (Hot + Cold Merge)

**新しいHotデータ追加:**
```bash
curl -X POST http://localhost:8787/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "test-user-001",
    "table": "battle",
    "records": [
      {"timestamp": 1703303000000, "api_no": 4, "result": "S", "data": "test4"}
    ],
    "uploaded_by": "local-test"
  }'
```

**Hot + Cold 読み取り:**
```bash
curl "http://localhost:8787/v1/read?dataset_id=test-user-001&table_name=battle"
```

**期待される結果:**
```json
{
  "records": [
    {"timestamp": 1703302800000, "api_no": 1, "result": "S", "data": "test1"},
    {"timestamp": 1703302860000, "api_no": 2, "result": "A", "data": "test2"},
    {"timestamp": 1703302920000, "api_no": 3, "result": "B", "data": "test3"},
    {"timestamp": 1703303000000, "api_no": 4, "result": "S", "data": "test4"}
  ],
  "record_count": 4,
  "hot_count": 1,
  "cold_count": 3
}
```

## 📊 データフロー確認

### 完全なワークフロー
```
1. POST /v1/ingest → buffer_logs (Hot)
2. Scheduled Worker → Hot → Cold
   - R2: battle/YYYYMMDD_HH.avro
   - D1: archived_files + block_indexes
   - D1: DELETE FROM buffer_logs
3. GET /v1/read → merge(Hot, Cold)
```

### 診断クエリ

**Hot/Cold データ統計:**
```sql
SELECT * FROM hot_cold_summary;
```

**アーカイブ効率:**
```sql
SELECT * FROM archive_efficiency;
```

**特定データセットのブロック:**
```sql
SELECT 
  bi.id, bi.table_name, bi.record_count,
  bi.start_byte, bi.length,
  af.file_path, af.compression_codec
FROM block_indexes bi
JOIN archived_files af ON bi.file_id = af.id
WHERE bi.dataset_id = 'test-user-001'
ORDER BY bi.start_timestamp;
```

## 🧪 FUSOU-DATABASEのAvroデータを使ったテスト

### Avroファイルから実データをロード

```bash
# FUSOU-DATABASEのパス確認
ls -la /home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-DATABASE/fusou/2025-11-05/master_data/
```

利用可能なテストデータ:
- `mst_ships.avro` - 艦船マスターデータ
- `mst_slot_items.avro` - 装備マスターデータ
- `mst_map_infos.avro` - 海域マスターデータ

### Node.jsでAvroをJSONに変換してPOST

```javascript
// test/load-fusou-data.mjs
import { readFileSync } from 'fs';
import avroLib from 'avro-js';
const avro = avroLib;

const avroFile = '/home/ogu-h/Documents/GitHub/FUSOU/packages/FUSOU-DATABASE/fusou/2025-11-05/master_data/mst_ships.avro';
const data = readFileSync(avroFile);
const decoder = avro.createFileDecoder(data);

const records = [];
for (const record of decoder) {
  records.push(record);
}

// POST to buffer consumer
await fetch('http://localhost:8787/v1/ingest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dataset_id: 'fusou-master',
    table: 'ships',
    records: records.slice(0, 100), // 最初の100件
    uploaded_by: 'test-loader'
  })
});
```

## 🎯 テスト成功基準

- [ ] Buffer Consumer: POSTで`buffer_logs`に挿入される
- [ ] Archiver: `buffer_logs` → R2 + `block_indexes` → `buffer_logs`が空
- [ ] Reader: Hot + Coldをマージして正しい件数を返す
- [ ] 圧縮: R2ファイルサイズがdeflate圧縮されている
- [ ] Range Request: 複数ブロックがある場合、並列取得される
- [ ] Deduplication: 同じ`content-hash`のレコードが重複しない

## 🔍 トラブルシューティング

### モジュールインポートエラー
```bash
# TypeScript再コンパイル
npx tsc --outDir dist
```

### D1テーブル未作成
```bash
# スキーマ再適用
npx wrangler d1 execute dev_kc_battle_index --local \
  --file=../../docs/sql/d1/schema.sql
```

### R2オブジェクト未作成
- Archiverが実行されているか確認
- `archived_files`テーブルに`file_path`が登録されているか確認

### Range Requestエラー
- `block_indexes`の`start_byte`と`length`が正しいか確認
- R2ファイルサイズと合致しているか確認

## 📝 次のステップ

1. **wrangler.tomlの更新**
   - Hot/Cold用のQueue binding追加
   - Scheduled Worker設定 (Archiver)

2. **本番デプロイ準備**
   - リモートD1スキーマ適用
   - R2バケット作成
   - 環境変数設定

3. **モニタリング設定**
   - Cloudflare Analytics
   - D1 query metrics
   - R2 storage metrics
