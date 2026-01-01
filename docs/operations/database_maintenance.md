# Supabase データベース クリーンアップ ガイド

## 概要

Supabase を認証専用に統合するため、以下のテーブルと RPC 関数を削除します：

- `datasets` テーブル
- `processing_metrics` テーブル
- `compaction_history` テーブル
- `rpc_ensure_dataset()` RPC 関数

これらの機能は D1 にすべて統合されました（自動クリーンアップ機能付き）。

## 前提条件

- Supabase CLI をインストール済み: https://github.com/supabase/cli#install-the-cli
- Supabase プロジェクトへの管理者アクセス権限
- ローカル Supabase プロジェクトまたはリモートプロジェクト設定

## 手順 1: Supabase CLI ログイン

```bash
supabase login
```

## 手順 2: Supabase プロジェクト設定（リモート実行の場合）

```bash
# プロジェクトリストを表示
supabase projects list

# 指定したプロジェクトにリンク
supabase link --project-ref <PROJECT_ID>
```

## 手順 3: クリーンアップスクリプト実行

### オプション A: ローカル Supabase の場合

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU
supabase db push --file docs/sql/supabase/cleanup-schema.sql
```

### オプション B: リモート Supabase の場合（本番環境）

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU
supabase db push --file docs/sql/supabase/cleanup-schema.sql --linked
```

### オプション C: psql で直接実行（既存 Supabase コネクション使用）

```bash
PGPASSWORD="your_password" psql \
  -h db.supabase.co \
  -U postgres \
  -d postgres \
  -f docs/sql/supabase/cleanup-schema.sql
```

## クリーンアップ内容

削除されるオブジェクト（逆順実行）：

1. `rpc_ensure_dataset()` 関数
2. `compaction_history` テーブル
3. `processing_metrics` テーブル
4. `datasets` テーブル

## 検証コマンド

削除完了後、以下で検証：

```sql
-- テーブル確認（削除されているはず）
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- 関数確認（削除されているはず）
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'rpc_ensure_dataset';
```

## ロールバック方法

削除を間違えた場合：

```bash
# バックアップから復元
supabase db pull
git checkout docs/sql/supabase/schema.sql
supabase db push --file docs/sql/supabase/schema.sql
```

## D1 移行確認

削除後、以下で D1 移行を確認：

```bash
cd packages/FUSOU-WORKFLOW
npx wrangler d1 execute dev_kc_battle_index --remote --command "
  SELECT name FROM sqlite_master WHERE type='table';
"
```

## トラブルシューティング

### 「supabase コマンドが見つかりません」

```bash
# インストール方法（Linuxの場合）
curl https://dl.supabase.com/cli/release/latest/supabase_linux_amd64 -o /usr/local/bin/supabase
chmod +x /usr/local/bin/supabase
```

### 権限エラー

```bash
# サービスロールキーを使用
supabase link --project-ref <ID> --password "<SERVICE_ROLE_KEY>"
```

### 接続タイムアウト

リモート実行時は遅延が発生する場合があります（1-3 分）。

```bash
# 長時間タイムアウトで再実行
supabase db push --file docs/sql/supabase/cleanup-schema.sql --linked --timeout 600
```

## 次のステップ

1. ✅ Supabase テーブル・関数削除
2. ⏳ Workflow コード修正（D1 クエリに変更）
3. ⏳ WEB routes 修正（D1 クエリに変更）
4. ⏳ テスト・デプロイ

## 参考

- D1 スキーマファイル: `docs/sql/d1/schema.sql`
- Workflow コード: `packages/FUSOU-WORKFLOW/src/index.ts`
- Web routes: `packages/FUSOU-WEB/src/server/routes/battle_data.ts`
