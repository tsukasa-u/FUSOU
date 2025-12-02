# R2とD1の同期API

## 概要

`/api/admin/sync-r2-to-d1` は、R2バケット（`ASSET_SYNC_BUCKET`）内の全オブジェクトをスキャンし、D1データベース（`ASSET_INDEX_DB`）に不足しているエントリを自動的に補完する管理用APIです。

## 用途

- R2バケットとD1データベースの不整合を修正
- 手動アップロードやバックアップからの復元後のインデックス再構築
- 定期的な同期チェックとメンテナンス

## エンドポイント

```
POST /api/admin/sync-r2-to-d1
```

## 認証

### 環境変数の設定

```bash
ADMIN_API_SECRET=your-secret-key-here
```

この環境変数はCloudflare Pagesまたはローカル環境で設定する必要があります。

### リクエストヘッダー

```
Authorization: Bearer <ADMIN_API_SECRET>
```

認証に失敗した場合は `401 Unauthorized` が返されます。

## 動作フロー

1. **D1から既存キーを読み込み**
   - `files` テーブルから全ての `key` を取得
   - `Set<string>` に格納して高速な検索を可能にする

2. **R2バケット全体をスキャン**
   - 最大10,000件ずつページングしながら全オブジェクトをリスト
   - カーソルベースのページングで全件を取得

3. **不足エントリの特定**
   - R2に存在するがD1に存在しないキーをフィルタリング

4. **メタデータの取得と挿入**
   - 各不足キーについてR2から `head` でメタデータを取得
   - D1の `files` テーブルに挿入
   - レースコンディション対策として挿入前に再度存在チェック

5. **キャッシュのパージ**
   - `/api/asset-sync/keys` のキャッシュを削除

## レスポンス形式

### 成功時

```json
{
  "scanned": 1523,
  "existing": 1200,
  "inserted": 320,
  "failed": 3,
  "errors": [
    {
      "key": "broken/file.png",
      "error": "Object not found in R2 (deleted after listing?)"
    }
  ],
  "duration": 45231
}
```

#### フィールド説明

| フィールド | 型 | 説明 |
|----------|---|------|
| `scanned` | number | R2バケット内でスキャンされた総オブジェクト数 |
| `existing` | number | 既にD1に存在していたキーの数 |
| `inserted` | number | 正常にD1に挿入されたキーの数 |
| `failed` | number | 挿入に失敗したキーの数 |
| `errors` | array | 失敗したキーとエラーメッセージの配列 |
| `duration` | number | 処理にかかった時間（ミリ秒） |

### エラー時

```json
{
  "error": "Error message here"
}
```

## 使用例

### curl

```bash
curl -X POST https://your-domain.com/api/admin/sync-r2-to-d1 \
  -H "Authorization: Bearer your-admin-secret-key" \
  -H "Content-Type: application/json"
```

### JavaScript/TypeScript

```typescript
const response = await fetch('https://your-domain.com/api/admin/sync-r2-to-d1', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-admin-secret-key',
    'Content-Type': 'application/json',
  },
});

const result = await response.json();
console.log(`Inserted: ${result.inserted}, Failed: ${result.failed}`);
```

### Python

```python
import requests

response = requests.post(
    'https://your-domain.com/api/admin/sync-r2-to-d1',
    headers={
        'Authorization': 'Bearer your-admin-secret-key',
        'Content-Type': 'application/json',
    }
)

result = response.json()
print(f"Inserted: {result['inserted']}, Failed: {result['failed']}")
```

## エラーコード

| ステータスコード | 説明 |
|-------------|------|
| `200` | 同期成功（部分的な失敗を含む場合あり） |
| `401` | 認証失敗（無効または欠落したAdmin Secret） |
| `500` | D1クエリ失敗またはその他のサーバーエラー |
| `503` | 環境変数またはバインディングが未設定 |

## 必要な環境設定

### Cloudflare Pages

```toml
# wrangler.toml または Pages設定
[env.production]
ADMIN_API_SECRET = "your-secret-key"

[[env.production.r2_buckets]]
binding = "ASSET_SYNC_BUCKET"
bucket_name = "your-r2-bucket-name"

[[env.production.d1_databases]]
binding = "ASSET_INDEX_DB"
database_name = "your-d1-database-name"
database_id = "your-d1-database-id"
```

### ローカル開発

```bash
# .env
ADMIN_API_SECRET=your-local-secret-key
```

## D1テーブルスキーマ

APIは以下のD1テーブル構造を想定しています：

```sql
CREATE TABLE IF NOT EXISTS files (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  content_type TEXT,
  uploader_id TEXT,
  finder_tag TEXT,
  metadata TEXT
);
```

## 保存されるメタデータ

R2オブジェクトの `customMetadata` から以下の情報が取得されます：

- `uploaded_by` → `uploader_id`
- `finder_tag` → `finder_tag`
- `file_name` → `metadata.file_name`
- `declared_size` → `metadata.declared_size`

さらに同期情報として以下が追加されます：

```json
{
  "file_name": "example.png",
  "declared_size": 12345,
  "synced_from_r2": true,
  "synced_at": 1701504000000
}
```

## 注意事項

### パフォーマンス

- 大量のオブジェクトがある場合、処理に時間がかかる可能性があります
- R2の `list` APIは最大10,000件ずつ取得
- 各不足エントリに対して `head` と `INSERT` が実行されます

### レースコンディション

- 挿入前に再度D1で存在チェックを行うため、同時実行しても重複挿入は発生しません
- ただし、同時に複数回実行すると無駄な `head` リクエストが発生する可能性があります

### エラー処理

- 個別のキーの挿入失敗は `failed` カウントと `errors` 配列に記録されます
- 一部のキーが失敗しても処理は継続されます
- D1クエリの初期失敗（SELECT失敗）は即座に500エラーを返します

## セキュリティ

- `ADMIN_API_SECRET` は強力なランダム文字列を使用してください
- このAPIは管理者のみがアクセスすべきです
- 本番環境では環境変数として安全に管理してください
- CORSヘッダーが含まれていますが、認証が必須のため安全です

## トラブルシューティング

### `503 Admin API is not configured`

- `ADMIN_API_SECRET` 環境変数が設定されていません

### `503 ASSET_SYNC_BUCKET is not configured`

- Cloudflare PagesのR2バケットバインディングが正しく設定されていません

### `503 ASSET_INDEX_DB is not configured`

- Cloudflare PagesのD1データベースバインディングが正しく設定されていません

### `401 Unauthorized: Invalid admin secret`

- `Authorization` ヘッダーが欠落しているか、シークレットキーが間違っています

### 挿入が遅い

- R2の `head` とD1の `INSERT` が逐次実行されるため、大量のエントリがある場合は時間がかかります
- バッチ処理の実装を検討してください（現在は単一エントリずつ処理）

## 関連ファイル

- **実装:** `packages/FUSOU-WEB/src/pages/api/admin/sync-r2-to-d1.ts`
- **アップロードAPI:** `packages/FUSOU-WEB/src/pages/api/asset-sync/upload.ts`
- **キーリストAPI:** `packages/FUSOU-WEB/src/pages/api/asset-sync/keys.ts`
- **型定義:** `packages/FUSOU-WEB/src/pages/api/asset-sync/types.ts`
