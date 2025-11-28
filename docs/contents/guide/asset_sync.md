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
2. プロキシは `asset_sync` ワーカーを通じて保存ディレクトリを監視し、新規ファイルを検知すると、まず `/api/asset-sync/upload` に JSON ボディで「サイン済みアップロード」をリクエストします。
3. FUSOU-WEB は Supabase トークンとファイルメタデータを検証したうえで、期限付きの署名付き URL (`token`, `expires`, `signature` クエリ) を返します。
4. ワーカーは同じエンドポイントへ **生のバイナリストリーム (推奨 `Content-Type: application/octet-stream`)** を送信し、ボディ全体を署名付き URL に対してストリーミングします。Authorization ヘッダーは両フェーズで必須です。
5. サーバーは署名と Supabase ユーザー ID を再検証しつつ、ストリームをそのまま Cloudflare R2 (`ASSET_SYNC_BUCKET`) に転送します。保存後はメタデータキャッシュを失効させます。

## サーバー側の準備 (FUSOU-WEB)

- Cloudflare Pages/Workers で R2 バケットをバインドし、変数名を `ASSET_SYNC_BUCKET` に設定します。
- Supabase の anon key (`PUBLIC_SUPABASE_ANON_KEY`) を環境変数で提供します。ユーザー検証は anon key だけで完結し、サービスロールキーは Supabase REST へのアップサート時にのみ使用します。
- `ASSET_UPLOAD_SIGNING_SECRET` と `FLEET_SNAPSHOT_SIGNING_SECRET` に 32 文字以上のランダム文字列 (Base64 推奨) を設定します。両 API は HMAC-SHA256 で署名された短命トークンを検証し、署名が無効な場合はアップロードを拒否します。
- `ASSET_SYNC_ALLOWED_EXTENSIONS` (カンマ区切り) で R2 に保存を許可する拡張子を定義します。未設定の場合は `png,jpg,jpeg,gif,webp,bmp,ico,json,txt,csv,zip,tar,gz,bz2,xz,bin,mp4,webm,m4v,m4a,aac,wav,flac,ogg,ogv,oga,pak,dat` のみが許可されます。追加で `ASSET_SYNC_SKIP_EXTENSIONS` を設定すると強制的に拒否したい拡張子を増やせます (デフォルトは空)。
- `astro.config.mjs` の Cloudflare アダプターを利用しているため、`wrangler pages dev` もしくは Cloudflare 実環境で API を実行してください。`astro dev` 単体では R2 バインディングがないため 503 を返します。
- `src/pages/api/asset-sync/upload.ts` が API エンドポイントです。POST だけでなく CORS 用の OPTIONS も用意されているため、今後ブラウザクライアントから叩く場合も追加設定なく利用できます。
- Supabase の `kc_period_tag` テーブルから最新の期間タグを取得し、1 日間キャッシュする `/api/kc-period/latest` も Cloudflare Pages 上に配置します。レスポンスは `{ tag, fetchedAt, cacheExpiresAt, cached }` で、`cache-control: public, max-age=86400` を付与しているためクライアントが同期間問い合わせを繰り返しても Supabase 側の負荷は最小限です。
- `/api/asset-sync/upload` は **許可リスト方式** で拡張子を検証します。Cloudflare Pages の `ASSET_SYNC_ALLOWED_EXTENSIONS` (カンマ区切り) で許可される拡張子を定義し、追加で `ASSET_SYNC_SKIP_EXTENSIONS` を設定すると禁止リストを上書きできます。クライアント側も `asset_skip_extensions` を参照し、アップロード前に同じルールを適用してください。

## サイン済みアップロードフロー

1. クライアントは `Authorization: Bearer <Supabase access token>` ヘッダーを付けて `/api/asset-sync/upload` へ JSON を送信します。ボディには `key`, `relative_path`, `file_size`, `content_type`, `finder_tag` などのメタデータを含めます。
2. API は Supabase アクセストークンを検証し、Cloudflare R2 に同名のオブジェクトが存在しないかをチェックします。問題がなければ `createSignedToken()` で HMAC-SHA256 署名済みトークンを生成し、120 秒間有効な `uploadUrl` を返します。レスポンスは `{ uploadUrl, expiresAt, fields }` 形式です。
3. クライアントは `uploadUrl` に含まれる `token`, `expires`, `signature` クエリを保持したまま、**リクエストボディ全体をバイトストリームとして送信**します。`Content-Type: application/octet-stream` を推奨しますが、`image/png` など実ファイルの MIME を設定しても構いません (multipart/form-data は拒否されます)。Authorization ヘッダーも再送が必要です。
4. API は署名パラメータと Supabase ユーザー ID を再検証し、ストリームをそのまま Cloudflare R2 (`put`) に転送します。完了後は `{ key, size }` を返し、既存キーキャッシュを失効させます。

この 2 フェーズ構成により、デスクトップアプリは Cloudflare シークレットを保持せずにアップロードでき、リクエスト改ざん (key の書き換え、他ユーザー ID への上書きなど) を HMAC で防止できます。

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

#### フェーズ 1: サイン済みアップロード要求 (JSON)

| フィールド | 説明 |
| --- | --- |
| `Authorization` ヘッダー | `Bearer <Supabase access token>` を必須化。 |
| `key` | R2 に保存するオブジェクトキー。`asset_key_prefix` を付けた値を送信。 |
| `relative_path` | ローカル保存時の相対パス。R2 メタデータとして保存。 |
| `file_size` | クライアント推定のファイルサイズ。200MiB を超える値は拒否。 |
| `finder_tag` | (任意) 収集元タグ。レスポンス `fields.finder_tag` に反映。 |
| `content_type` | (任意) MIME タイプ。省略時は `application/octet-stream`。 |

レスポンスは `{ uploadUrl, expiresAt, fields }`。`uploadUrl` に `token`, `expires`, `signature` が含まれ、2 分で失効します。

#### フェーズ 2: 実データアップロード (バイトストリーム)

| フィールド | 説明 |
| --- | --- |
| `Authorization` ヘッダー | サイン済み要求と同じ Supabase アクセストークンを再送。 |
| クエリ `token/expires/signature` | フェーズ 1 のレスポンスをそのまま利用。改ざん・失効時は 403。 |
| `Content-Type` | `application/octet-stream` など単一ファイルの MIME タイプ。`multipart/form-data` は拒否されます。 |
| `Content-Length` | 可能な限り送信してください (200MiB 超の値は 413)。 |
| リクエストボディ | ファイル本体をそのままストリーミング。追加フィールドは不要。 |

レスポンスは `{ key, size }`。既存キーには 409、Supabase トークン不一致には 403、拡張子制約違反は 415、サイズ超過は 413 を返します。

## プロキシ設定 (configs)

`packages/configs/configs.toml` の `[app.asset_sync]` ブロックで以下を指定します。

```toml
[app.asset_sync]
asset_upload_enable = true
scan_interval_seconds = 30
asset_upload_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/asset-sync/upload"
fleet_snapshot_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/fleet/snapshot"
kc_period_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/kc-period/latest"
asset_existing_keys_endpoint = "https://save-data-on-r2.fusou.pages.dev/api/asset-sync/keys"
asset_skip_extensions = ["mp3"]
asset_key_prefix = "assets"
```

`asset_upload_enable` が `true` の場合に限り、Tauri 側で `asset_sync` ワーカーが起動します。

`asset_upload_endpoint` は FUSOU-WEB 側でホストするアップロード URL を指します。Tauri アプリは Supabase セッションを獲得しない限りアップロードを開始しません。

`asset_existing_keys_endpoint` は前述の `/api/asset-sync/keys` を指します。値が空の場合、プロキシは従来通り 409 レスポンスに頼って重複検知を行いますが、指定すると起動直後に既存キーのセットを取得し、R2 にアクセスする前にクライアント側で「既に存在するか」を判定できます。

`kc_period_endpoint` は Supabase の `kc_period_tag` (カラム: `id`, `tag TIMESTAMPTZ`) の最新値を返す API です。値が更新されるとクライアント側の `asset_sync` ワーカーが内部キャッシュ (`PROCESSED_KEYS`) をクリアし、過去に送信済みのキーでも再アップロードを許可します。Cloudflare Pages 側は 1 日キャッシュなので、日次 (24 時間ごと) でタグを更新する運用を前提にしています。

`asset_skip_extensions` には拡張子 (ピリオドなし) の配列を列挙します。クライアントはここに含まれる拡張子をローカルで除外し、サーバーも同じリストを上書きすることで二重チェックを実施します。

`fleet_snapshot_endpoint` は艦隊スナップショット JSON をアップロードする `/api/fleet/snapshot` を指します。こちらもサイン済み URL フローを採用しており、`FLEET_SNAPSHOT_SIGNING_SECRET` と Supabase 認証の両方が必要です。

> [!NOTE]
> スナップショット API も JSON ボディをそのまま Cloudflare Worker で受け取り、**2MB のサイズ制限付きストリーム**として読み取ります。`Content-Length` ヘッダーは参考値として扱われますが、実際には本体を読みながら検証するため、クライアントは圧縮前の JSON を 2MB 未満に収める必要があります。大きな配列や余計なフィールドはクライアント側で省き、必要最小限のデータのみを送信してください。

## クライアント側の振る舞い (FUSOU-APP)

- Supabase 認証画面 (ブラウザ or ローカル auth) で取得した access/refresh token を Tauri コマンド `set_supabase_session` に送信し、`asset_sync` ワーカーへ共有します。
- サインアウト時は `clear_supabase_session` が呼ばれ、ワーカーがアップロードを一時停止します。
- `proxy_server_https` が `asset_sync` を起動すると、ローカル保存ディレクトリをスキャンし新規ファイルのアップロードを順次試みます。409 を受け取ったファイルは `DashSet` で記録され、重複送信を抑止します。
- 追加で `asset_existing_keys_endpoint` が設定されている場合、ワーカーは起動直後に 1 回だけリモートキーを取得し、その後は「アップロード対象ファイルを処理する直前」に限って TTL を確認し再取得します。成功したアップロードはローカルキャッシュへ即反映されるため、他クライアントへ同期要求を送らずに単方向で最新状態を維持できます。
- キャッシュが失効または `invalidateAssetKeyCache()` により無効化された直後の再フェッチでは、クライアントごとに 0〜5 秒のランダム遅延を挟んで `asset_existing_keys_endpoint` を呼ぶようにしており、同時多発的なリクエスト集中を避けています。
- `kc_period_endpoint` が設定されている場合、ワーカーはアップロード前に最新の `kc_period_tag` を取得し、値が変わったタイミングで `DashSet` をクリアして「再アップロードウィンドウ」を開きます。API 応答がキャッシュ済みの間は追加アクセスを行わないため、Supabase へのクエリは最大で 1 日に 1 回です。
- `asset_skip_extensions` に含まれる拡張子 (`mp3` など音声ファイル) はクライアント側で検知するとアップロード対象から除外されます。Cloudflare Pages 側の `ASSET_SYNC_SKIP_EXTENSIONS` も設定しておくと、同じリストでサーバーが二重に検証します。

## トラブルシューティング

| 症状 | 確認ポイント |
| --- | --- |
| 401 Unauthorized | Supabase アクセストークンが期限切れ。FUSOU-APP が Supabase セッションを更新しているかを確認 |
| 503 Storage binding missing | Cloudflare Pages 側で `ASSET_SYNC_BUCKET` が未バインド。ダッシュボードでバケットを関連付ける |
| 413 Payload Too Large | `file_size` が 200MiB を超えている。今後分割アップロードを実装予定 |

この構成により、ユーザー環境に Cloudflare API キーを配置することなく、安全にアセット同期を行えます。
