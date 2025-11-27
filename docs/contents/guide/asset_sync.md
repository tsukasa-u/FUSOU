---
title: Asset Sync Pipeline
description: FUSOU の非 kcsapi アセットを Cloudflare R2 に同期するための API 構成とクライアント要件のまとめ。
contributors: ["github-copilot"]
date: 2025-11-24
slug: guide/asset_sync
tags: [guide, storage]
---

FUSOU v0.4 では、艦これの非 kcsapi アセットを Cloudflare R2 に保存する際に、デスクトップアプリから直接 R2 API を叩くのではなく、FUSOU-WEB が提供する HTTPS API を経由するように変更しました。これにより、ユーザー環境に Cloudflare のシークレットを配置する必要がなくなり、アップロード処理に Supabase 認証を必須化できます。

## 全体像

1. FUSOU-APP が Supabase 認証を完了すると、Tauri プロセスがアクセストークンを `proxy-https` クレートへ渡します。
2. プロキシは `asset_sync` ワーカーを通じて保存ディレクトリを監視し、新規ファイルを検知すると `asset_sync_api_endpoint` へ multipart/form-data リクエストを発行します。
3. FUSOU-WEB の `/api/asset-sync/upload` ルートは Supabase トークンを検証し、Cloudflare R2 バケット (`ASSET_SYNC_BUCKET`) にオブジェクトを保存します。すでに存在するキーには 409 を返し、クライアント側で重複アップロードを防ぎます。

## サーバー側の準備 (FUSOU-WEB)

- Cloudflare Pages/Workers で R2 バケットをバインドし、変数名を `ASSET_SYNC_BUCKET` に設定します。
- Supabase のサービスロールキー、または anon key を `SUPABASE_SERVICE_ROLE_KEY` として環境変数にセットします (指定がない場合は `PUBLIC_SUPABASE_ANON_KEY` を使用)。
- `astro.config.mjs` の Cloudflare アダプターを利用しているため、`wrangler pages dev` もしくは Cloudflare 実環境で API を実行してください。`astro dev` 単体では R2 バインディングがないため 503 を返します。
- `src/pages/api/asset-sync/upload.ts` が API エンドポイントです。POST だけでなく CORS 用の OPTIONS も用意されているため、今後ブラウザクライアントから叩く場合も追加設定なく利用できます。
- Supabase の `kc_period_tag` テーブルから最新の期間タグを取得し、1 日間キャッシュする `/api/kc-period/latest` も Cloudflare Pages 上に配置します。レスポンスは `{ tag, fetchedAt, cacheExpiresAt, cached }` で、`cache-control: public, max-age=86400` を付与しているためクライアントが同期間問い合わせを繰り返しても Supabase 側の負荷は最小限です。
- `/api/asset-sync/upload` は `.mp3` など音声拡張子をサーバー側で遮断します。Cloudflare Pages の `ASSET_SYNC_SKIP_EXTENSIONS` (カンマ区切り) で拒否リストを上書きでき、クライアント側は `configs` の `skip_extensions` を参照してローカルで除外します (デフォルトはどちらも `mp3`)。

### 既存キーキャッシュ / `/api/asset-sync/keys`

- `src/pages/api/asset-sync/keys.ts` は R2 バケット内のオブジェクトキーを全件列挙し、6 時間キャッシュした JSON を返します。
- キャッシュは同ディレクトリの `cache-store.ts` でインメモリ保持しており、レスポンスにも `cache-control: public, max-age=21600` と `ETag` を付与してブラウザ/CDN 側で再利用できます。クライアントは `If-None-Match` を付与することで変更がない場合は 304 を受け取り、レスポンスボディを省略できます。
- `/api/asset-sync/upload` が新規オブジェクトを保存すると `invalidateAssetKeyCache()` を呼び出し、次回の GET リクエストで必ず再スキャンが走るようになっています (アップロード完了イベントのみで失効)。
- レスポンスフォーマットは次の通りです。

| フィールド | 説明 |
| --- | --- |
| `keys` | 取得した R2 オブジェクトキー配列 |
| `total` | キー数 (keys.length) |
| `refreshedAt` | Cloudflare Pages 上で一覧を取得した時刻 (ISO8601) |
| `cacheExpiresAt` | キャッシュ有効期限 (ISO8601)。クライアントはこれを TTL として利用します |
| `cached` | 今回のレスポンスがキャッシュヒットかどうか |

クライアントは `cacheExpiresAt` までローカルにキャッシュし、期限切れでなおかつ「今からアップロード/スキャンが必要」というタイミングに限って再フェッチします。これにより Cloudflare Pages / R2 へのアクセス回数を大幅に削減できます。さらに、FUSOU-PROXY はキャッシュが切れた直後に最大 5 秒間のジッターを入れてから `/keys` を呼び出すため、複数クライアントが同時にキャッシュ無効化を検知しても一斉アクセスを避けられます。

### リクエスト仕様

| フィールド | 説明 |
| --- | --- |
| `Authorization` ヘッダー | `Bearer <Supabase access token>` を必須化 |
| `file` | バイナリアセット (最大 200MiB) |
| `key` | R2 に保存するオブジェクトキー。`app.asset_sync.key_prefix` が付与された値が送信されます |
| `relative_path` | ローカル保存時の相対パス。R2 メタデータとして格納されます |
| `file_size` | (任意) クライアント推定のファイルサイズ。ずれがある場合はサーバーログに警告 |
| `finder_tag` | (任意) クライアント側で識別した収集元タグ |

レスポンスは JSON `{ key, size }` を返します。既存キーには 409、認証失敗には 401 を返します。

## プロキシ設定 (configs)

`packages/configs/configs.toml` の `[app.asset_sync]` ブロックで以下を指定します。

```toml
[app.asset_sync]
enable = true
require_supabase_auth = true
scan_interval_seconds = 30
asset_sync_api_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/asset-sync/upload"
asset_sync_period_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/kc-period/latest"
asset_sync_existing_keys_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/asset-sync/keys"
skip_extensions = ["mp3"]
key_prefix = "assets"
```

`asset_sync_api_endpoint` は FUSOU-WEB 側でホストするアップロード URL を指します。Tauri アプリは Supabase セッションを獲得しない限りアップロードを開始しません。

`existing_keys_endpoint` は前述の `/api/asset-sync/keys` を指します。値が空の場合、プロキシは従来通り 409 レスポンスに頼って重複検知を行いますが、指定すると起動直後に既存キーのセットを取得し、R2 にアクセスする前にクライアント側で「既に存在するか」を判定できます。

`period_endpoint` は Supabase の `kc_period_tag` (カラム: `id`, `tag TIMESTAMPTZ`) の最新値を返す API です。値が更新されるとクライアント側の `asset_sync` ワーカーが内部キャッシュ (`PROCESSED_KEYS`) をクリアし、過去に送信済みのキーでも再アップロードを許可します。Cloudflare Pages 側は 1 日キャッシュなので、日次 (24 時間ごと) でタグを更新する運用を前提にしています。

## クライアント側の振る舞い (FUSOU-APP)

- Supabase 認証画面 (ブラウザ or ローカル auth) で取得した access/refresh token を Tauri コマンド `set_supabase_session` に送信し、`asset_sync` ワーカーへ共有します。
- サインアウト時は `clear_supabase_session` が呼ばれ、ワーカーがアップロードを一時停止します。
- `proxy_server_https` が `asset_sync` を起動すると、ローカル保存ディレクトリをスキャンし新規ファイルのアップロードを順次試みます。409 を受け取ったファイルは `DashSet` で記録され、重複送信を抑止します。
- 追加で `existing_keys_endpoint` が設定されている場合、ワーカーは起動直後に 1 回だけリモートキーを取得し、その後は「アップロード対象ファイルを処理する直前」に限って TTL を確認し再取得します。成功したアップロードはローカルキャッシュへ即反映されるため、他クライアントへ同期要求を送らずに単方向で最新状態を維持できます。
- キャッシュが失効または `invalidateAssetKeyCache()` により無効化された直後の再フェッチでは、クライアントごとに 0〜5 秒のランダム遅延を挟んで `existing_keys_endpoint` を呼ぶようにしており、同時多発的なリクエスト集中を避けています。
- `period_endpoint` が設定されている場合、ワーカーはアップロード前に最新の `kc_period_tag` を取得し、値が変わったタイミングで `DashSet` をクリアして「再アップロードウィンドウ」を開きます。API 応答がキャッシュ済みの間は追加アクセスを行わないため、Supabase へのクエリは最大で 1 日に 1 回です。
- `skip_extensions` に含まれる拡張子 (`mp3` など音声ファイル) はクライアント側で検知するとアップロード対象から除外されます。Cloudflare Pages 側の `ASSET_SYNC_SKIP_EXTENSIONS` も設定しておくと、同じリストでサーバーが二重に検証します。

## トラブルシューティング

| 症状 | 確認ポイント |
| --- | --- |
| 401 Unauthorized | Supabase アクセストークンが期限切れ。FUSOU-APP が Supabase セッションを更新しているかを確認 |
| 503 Storage binding missing | Cloudflare Pages 側で `ASSET_SYNC_BUCKET` が未バインド。ダッシュボードでバケットを関連付ける |
| 413 Payload Too Large | `file_size` が 200MiB を超えている。今後分割アップロードを実装予定 |

この構成により、ユーザー環境に Cloudflare API キーを配置することなく、安全にアセット同期を行えます。
