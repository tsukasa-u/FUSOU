# Ship Growth データフロー仕様書（詳細版）

作成日: 2026-04-09  
最終更新日: 2026-04-10

この文書は、艦成長データが

- 何を収集し
- どこへ送信し
- サーバーで何を計算し
- どのテーブルにどのルールで保存されるか

を、実装ベースで詳細に説明する。

## 0. 現状の結論

現時点の仕様判断は次のとおり。

- パラメータの根本変化は period_tag 切替時に起きる前提で扱う。
- クライアントの送信抑制は `exp / 裸パラメータ / 最大値` を分離して行う。
- サーバーへ送る `payload_hash` は、アップロード完全性確認（content hash）とは別の payload 識別子として維持する。
- exp 系は `exp_current + exp_to_next` から境界値を構成し、`ship_level_exp_pairs` には境界値として `exp_current` を保存する。
- exp 入力は厳格（`exp_to_next` 必須・非負）とし、同一境界レベルで不一致があれば受信を拒否する。
- local pending はクライアント再送キューであり、サーバーの派生データ保存そのものとは役割が異なる。

## 1. 対象システムと責務

### 1.1 クライアント（FUSOU-APP）

責務:

- ゲーム API 由来の観測値を ShipGrowthSnapshot として構築する。
- 送信重複を抑制する。
- 2段階アップロードで ship-growth ingest へ送る。
- 失敗時は pending に退避し、retry で再送する。

主な実装:

- packages/FUSOU-APP/src-tauri/src/ship_growth_sender.rs
- packages/FUSOU-APP/src-tauri/src/storage/retry_handler.rs
- packages/fusou-upload/src/uploader.rs
- packages/fusou-upload/src/pending_store.rs
- packages/fusou-upload/src/retry_service.rs

### 1.2 サーバー（FUSOU-WEB）

責務:

- 認証、トークン検証、ボディ検証、ハッシュ検証。
- master data と synergy データを取得。
- naked 値の正規化計算を実施。
- D1 へトランザクション保存。

主な実装:

- packages/FUSOU-WEB/src/server/routes/ship_growth.ts

### 1.3 永続ストア

- SHIP_GROWTH_DB（D1）: サーバー派生値（exp/bounds/caps）と archive 保存。
- MASTER_DATA_INDEX_DB（D1）: master data のメタインデックス。
- MASTER_DATA_BUCKET（R2）: Avro OCF（mst_slotitem）と synergy JSON。
- クライアントローカルディスク: pending bin/json（再送キュー）。

## 2. 入力データ（クライアントが送る内容）

クライアントの ingest body の主要フィールド:

- dataset_id: ユーザー識別（ハッシュ済み）
- request_id: 1リクエスト一意 ID
- payload_hash: ships 配列の正規化ハッシュ
- event_type: snapshot 固定
- timestamp_ms: クライアント生成時刻
- period_tag: 期間タグ（YYYY-MM-DD）
- table_version: テーブル版
- ships: 艦配列

### 2.1 ships 要素（ShipEntry）

各艦要素に含まれる主な値:

- 識別・進行:
  - master_id
  - lv
  - exp_current
  - exp_to_next（必須, 0以上）
- 観測値（装備込み）:
  - kaihi_observed
  - taisen_observed
  - sakuteki_observed
- cap 値:
  - kaihi_max
  - taisen_max
  - sakuteki_max
- 装備・補正関連:
  - kyouka
  - slots（slotitem_id, locked, level, alv）
  - exslot（同構造、任意）
  - sp_effect_items_json

注記:

- クライアント側に kaihi_naked / taisen_naked / sakuteki_naked フィールドはあるが、最終採用値はサーバーで再計算した値。

### 2.2 クライアント送信抑制（現状）

現状実装:

- クライアント抑制は 3 系統に分離している。
- `LocalRequestSuppressionCache.should_skip(key, hash)` に対し、ship_growth_sender は次を個別判定する。
  - `snapshot:exp`
  - `snapshot:bounds`
  - `snapshot:caps`

意味:

- `snapshot:exp`
  - 境界レベル（`lv+1`） -> `exp_current + exp_to_next` の境界観測が変わったときだけ送る。
- `snapshot:bounds`
  - 同一 period_tag 内では `master_id + lv` が同じなら、裸パラメータ学習対象としては再送しない。
- `snapshot:caps`
  - `master_id + 各最大値` が変わったときだけ送る。
- period_tag 切替時は suppression scope が切り替わるため、新周期として再送対象になる。

補足:

- サーバー側での受信判定は 2 段階 upload token（JWT + content_hash + declared_size）の整合で担保する。
- 3 系統のいずれか 1 つでも変化していれば upload は実行される。

## 3. アップロードプロトコル（2段階）

### 3.1 Stage 1: handshake

受信要件:

- Authorization: Bearer JWT 必須
- body 検証（dataset_id, request_id, payload_hash, event_type, period_tag, table_version, ships）
- content_hash 必須
- file_size > 0 必須

サーバー動作:

- JWT を検証
- signed upload token を生成（TTL 300 秒）
- uploadUrl と token を返却

### 3.2 Stage 2: upload

受信要件:

- Authorization: Bearer JWT
- X-Upload-Token 必須
- body バイナリ長が declared_size と一致
- SHA-256(body) が content_hash と一致

サーバー動作:

- トークン claim と body の dataset_id/request_id/event_type 整合確認
- processShipGrowthIngest を実行

補足（現実装の重要点）:

- サーバー側で `request_id` を永続化して重複排除する仕組みは現在持たない。
- Stage 2 で保証しているのは「トークン発行時に合意した body 条件」との整合であり、
  同一 payload の再送短絡（旧 payload_registry 相当）は行わない。

## 4. サーバー計算ロジック（naked 算出）

### 4.1 前提データ読込

1. mst_slotitem 読込

- MASTER_DATA_INDEX_DB から
  - period_tag
  - table_version
  - table_name = mst_slotitem
    で最新版（period_revision DESC）を解決。
- R2 オブジェクトを読み、Avro OCF を decode。
- slotitem_id -> { houk, tais, saku } の Map を作成。
- キャッシュ TTL: 5 分。

2. synergy データ読込

- synergy_manifest から completed の最新 period_revision を取得。
- manifest から sp_effect JSON キーを構築して R2 取得。
- effects / cross_effects を Map 化。
- キャッシュ TTL: 5 分。

### 4.2 1艦あたりの計算

まず対象スロット:

- allSlots = slots + exslot（存在時）

1. slot 補正の合計

- slotKaihi = sum(houk)
- slotTaisen = sum(tais)
- slotSakuteki = sum(saku)

2. sp_effect 補正

- spEffectKaihi = sum(api_kaih)

3. synergy 補正

- single synergy
  - item ごとの装備数 count
  - star10 有無
  - ship 条件一致 rule を選択
  - b/l/c2/c3 ルールで合計
- cross synergy
  - 装備ペアごとに rule を参照
  - ship 条件一致分を加算
- totalSynergy = single + cross

4. naked 値

- kaihi_naked = max(0, kaihi_observed - slotKaihi - spEffectKaihi - totalSynergy.kaihi)
- taisen_naked = max(0, taisen_observed - slotTaisen - totalSynergy.taisen)
- sakuteki_naked = max(0, sakuteki_observed - slotSakuteki - totalSynergy.sakuteki)

5. 内訳保持

- removed.slot
- removed.spEffect
- removed.synergy.single/cross/total
- sp_effect_items 正規化配列

### 4.3 計算失敗条件

- slotitem_id が mst_slotitem に存在しない場合:
  - 500 を返し、保存しない。
- master data / synergy が未準備:
  - 503 を返し、保存しない。

## 5. SHIP_GROWTH_DB への保存仕様

保存は BEGIN IMMEDIATE から COMMIT までの単一トランザクションで実行。
失敗時は ROLLBACK。

ここで重要なのは、サーバー保存と local pending は役割が別という点である。

- local pending:
  - クライアントが送信失敗時に一時退避する再送キュー
- SHIP_GROWTH_DB:
  - サーバーが正規化計算した結果と、学習済み境界値を保持する保存先

現行ではサーバー側の生イベント監査/グローバル dedupe は廃止し、
必要最小限の派生データ管理に絞っている。

### 5.1 ship_level_exp_boundaries（物理テーブル: ship_level_exp_pairs）

役割:

- レベルに対応する経験値境界を保持する。
- 現在実装は「そのレベル到達時の推定境界値」を主に扱う。

主要列:

- period_tag TEXT NOT NULL
- table_version TEXT NOT NULL
- lv INTEGER NOT NULL
- exp_current INTEGER NOT NULL

主キー:

- PRIMARY KEY(period_tag, table_version, lv)

更新ルール:

- ingest 時は `lv = current_lv + 1` の境界行を扱う。
- 未登録行は INSERT する。
- 既存行がある場合は `existing == incoming` の一致のみ許可する。
- 既存行と不一致なら 409 で受信拒否し、DB 更新はロールバックする。

解釈:

- exp_current:
  - `lv` 到達境界（`current_lv = lv-1` からのレベルアップ境界）に対応する累積経験値

注意:

- `exp_to_next` は入力で必須だが、DB には境界値（`exp_current`）のみを保存する。
- 「次レベル必要量」は必要時に差分計算で導出する。

### 5.2 ship_growth_bounds

役割:

- master_id + lv ごとの裸ステータス下限を保持。

主要列:

- period_tag TEXT NOT NULL
- table_version TEXT NOT NULL
- master_id INTEGER NOT NULL
- lv INTEGER NOT NULL
- kaihi_naked INTEGER NOT NULL
- taisen_naked INTEGER NOT NULL
- sakuteki_naked INTEGER NOT NULL

主キー:

- PRIMARY KEY(period_tag, table_version, master_id, lv)

更新ルール:

- upsert で MIN を採用（より低い観測を保持）

### 5.3 ship_growth_caps

役割:

- master_id ごとの cap 上限を保持。

主要列:

- period_tag TEXT NOT NULL
- table_version TEXT NOT NULL
- master_id INTEGER NOT NULL
- kaihi_max INTEGER NOT NULL
- taisen_max INTEGER NOT NULL
- sakuteki_max INTEGER NOT NULL

主キー:

- PRIMARY KEY(period_tag, table_version, master_id)

更新ルール:

- upsert で MAX を採用（より高い cap を保持）

### 5.4 ship_growth_archive（R2 archive object）

役割:

- period/version 更新時に、旧 `ship_growth_bounds` / `ship_growth_caps` の値を R2 に退避する。
- 退避後は旧 period/version の対象レコードを active テーブルから削除する。
- これにより active テーブルは現 period/version 中心に保ち、履歴は R2 archive object に残す。

オブジェクトキー形式:

- `ship-growth/archive/{period_tag}/{table_version}/{archived_at}-{hash16}-{uuid}.json`

主な payload:

- `period_tag_new`
- `table_version_new`
- `archived_at`
- `rows.bounds[]`（旧 bounds 行）
- `rows.caps[]`（旧 caps 行）

現状:

- archive 候補行を先に収集し、R2 archive object を `put()` する。
- DB 側の prune は、archive 済みとして確定した `rowid` のみを対象に削除する。
- `SHIP_GROWTH_ARCHIVE_BUCKET` 未設定時は 503 を返し、DB更新は行わない。

### 5.5 トランザクション順序（実コード準拠）

`processShipGrowthIngest` の DB 更新順序は次の固定順序。

1. ingest payload を `master_id/lv`（bounds）, `master_id`（caps）, `lv+1`（exp 境界）で集約する
2. 集約キーに対応する旧 period/version 行を取得する（archive 対象）
3. R2 (`SHIP_GROWTH_ARCHIVE_BUCKET`) に archive object を `put()`
4. `BEGIN IMMEDIATE`
5. archive 対象として確定した `rowid` のみ prune (`DELETE ... WHERE rowid = ?`)
6. `ship_level_exp_pairs` を挿入/整合確認（既存値と不一致なら 409 で失敗）
7. `ship_growth_bounds` を upsert（各裸値 `MIN`）
8. `ship_growth_caps` を upsert（各 cap 値 `MAX`）
9. `COMMIT`

失敗時:

- `SHIP_GROWTH_ARCHIVE_BUCKET` 未設定時は `503` を返し、DB更新は開始しない。
- それ以外の DB 失敗は `500` で `ROLLBACK`。

### 5.6 archive / prune 条件の詳細

archive 挿入対象:

- 対象キーは ingest payload を集約した一意集合:
  - bounds: `(master_id, lv)`
  - caps: `master_id`
- かつ `(period_tag != current OR table_version != current)` を満たす行のみ。

archive に入る値:

- old 側の裸値行（bounds）
- old 側の cap 値行（caps）
- `period_tag_new`, `table_version_new`, `archived_at`

prune 対象:

- `ship_growth_bounds`: archive 済みとして確定した `rowid` の行のみ削除
- `ship_growth_caps`: archive 済みとして確定した `rowid` の行のみ削除

注意点:

- prune は `rowid` 固定で行うため、archive 収集後に新規挿入された旧 period/version 行を誤って削除しない。
- archive object は key に `archived_at + hash + uuid` を含むため、同一内容でも別実行で別オブジェクトとして保存される。

### 5.7 冪等性と重複受信の現状

旧構成との違い:

- `ship_growth_ingest_events` 削除により `request_id + payload_hash` のサーバー永続冪等判定は廃止。
- `ship_growth_payload_registry` 削除によりグローバル payload dedupe も廃止。

現在の重複抑制:

- 主にクライアント側 suppression（`exp / bounds / caps` の3系統）
- サーバー側でも ingest payload を以下の自然キーで集約してから upsert する
  - bounds: `(master_id, lv)`
  - caps: `master_id`
  - exp: `boundary_lv = current_lv + 1`
- DB 側は
  - bounds: MIN 学習
  - caps: MAX 学習
  - exp: 一致必須（不一致拒否）

意味:

- 同一 payload が届いても、上限/下限学習テーブルは原則値が悪化しない。
- exp は固定テーブル前提で不一致を拒否するため、誤学習を防止する。
- ただし「受信回数そのものの短絡」はしないため、受信コスト最適化はクライアント抑制依存になる。

## 6. 失敗時の pending 保存と retry 保存先

### 6.1 何を保存するか

クライアントローカルに 2 ファイル保存:

- {id}.bin
  - 実送信予定データ本体
- {id}.json
  - target_url
  - headers
  - created_at
  - attempt_count
  - last_attempt_at
  - context（operation, endpoint, payload_hash など）

### 6.2 どのコンテキストで再送できるか

retry_handler が対応する operation/provider:

- provider: r2
- operation: quest_ingest
- operation: ship_growth_ingest
- operation: upload（gdrive feature 時）

## 7. retry スケジューリング詳細

### 7.1 起動条件

- 失敗直後に trigger_retry
- 起動時バックグラウンド loop
- interval_seconds ごとの定期 trigger
- Settings 手動ボタンで force trigger

### 7.2 due 判定（通常 retry）

- reference = last_attempt_at があればそれ、なければ created_at
- base_wait = interval_seconds \* 2^attempt_count
- jitter_wait = base_wait に決定論的ジッター（-20% ～ +20%）
- now >= reference + jitter_wait で送信対象

### 7.3 認証失敗

- 401/403 系は auth_backoff_seconds 待機後にサイクル終了。
- attempt_count は増やさない。

### 7.4 削除条件

- max_attempts 到達で削除
- ttl_seconds 超過で削除（サイクル開始時 cleanup）

## 8. 現在の標準 retry 設定

設定ファイル:

- packages/configs/configs.toml

現行値:

- max_attempts = 10
- ttl_seconds = 2592000（30日）
- interval_seconds = 900（15分）
- auth_backoff_seconds = 600

## 9. 監視 UI（Settings）

UI で確認できる情報:

- total pending
- due now
- max attempts
- base interval
- ttl
- next due at
- item ごとの
  - attempt
  - next due
  - remaining
  - expires

バックエンドコマンド:

- get_pending_upload_retry_status
- retry_pending_uploads_now

## 10. 再起動時の挙動

1. pending はローカルファイルなので保持される。
2. 起動時に retry loop が再開する。
3. last_attempt_at を使って due 判定を継続する。
4. 手動ボタンで due を待たず即時再開できる。

## 11. 保存データの要約

### 11.1 クライアント側に残るもの

- pending `.bin`
  - 再送対象の元データ
- pending `.json`
  - 再送メタ情報（context, attempt, last_attempt_at など）

### 11.2 サーバー側に残るもの

- ship_level_exp_pairs
  - レベル境界（`lv = current_lv+1`）の `exp_current`
- ship_growth_bounds
  - master_id + lv ごとの裸ステータス下限
- ship_growth_caps
  - master_id ごとの cap 上限
- SHIP_GROWTH_ARCHIVE_BUCKET（R2）
  - period/version 更新時に退避された旧 bounds/caps archive object

### 11.3 保存しないもの

- クライアント側 pending の内容をそのままサーバーへ蓄積する仕組みはない。
- server prerequisite 不足で 503 を返したケースは、サーバー側では未保存のまま終わる。
- `ship_growth_ingest_events` / `ship_growth_payload_registry` は現在保存しない。

- クライアント一時保存:
  - 送信失敗 payload 本体とメタ情報
- サーバー永続保存:
  - レベル経験値対応
  - 裸ステータス下限
  - cap 上限
  - 旧 period/version の archive
- 計算出力:
  - naked（kaihi, taisen, sakuteki）
  - removed 内訳（slot, spEffect, synergy）

## 12. 運用手順（migration 適用と確認）

### 12.1 適用コマンド

ship-growth DB に migration を適用:

```bash
cd packages/FUSOU-WEB
npx wrangler d1 migrations apply SHIP_GROWTH_DB --remote
```

### 12.2 適用確認クエリ

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute SHIP_GROWTH_DB --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

期待:

- `ship_growth_payload_registry` が存在しない
- `ship_growth_ingest_events` が存在しない
- `ship_growth_bounds` / `ship_growth_caps` / `ship_level_exp_pairs` が存在する

### 12.3 必須 binding

ship growth archive を有効化するには Worker に次が必要:

- `SHIP_GROWTH_ARCHIVE_BUCKET`（R2）

未設定時、ingest は 503 を返し archive/prune は実行されない。

index 確認:

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute SHIP_GROWTH_DB --remote --command "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name IN ('ship_growth_bounds','ship_growth_caps','ship_level_exp_pairs') ORDER BY tbl_name, name"
```

期待:

- `ship_growth_bounds` / `ship_growth_caps` / `ship_level_exp_pairs` の index が表示される

## 13. R2 スナップショット事前生成・Zero-D1 高速配信アーキテクチャ（2026-10 実装）

### 13.1 背景と課題
従来のパラメータ推移（ship-growth）API は、リクエストごとに D1（`SHIP_GROWTH_DB`）に対して bounds / caps / exp を動的クエリ（またはオンデマンド集約）していたため、以下の問題が発生していた。
1. **レイテンシの増大**: D1 のクエリと集約により 500ms〜2000ms の遅延が発生し、初期表示がもたつく。
2. **D1 のリソース消費**: 公開ダッシュボードで複数ユーザーがアクセスすると D1 の読み取り行数が急増する。
3. **過去期間のアーカイブ分断**: 過去期間のデータは `SHIP_GROWTH_ARCHIVE_BUCKET`（R2）の個別アーカイブ JSON に退避されていたため、過去全期間の横断集約（all-periods / cumulative）を行うには多数の R2 オブジェクトを走査する必要があった。
4. **テーブルバージョンの不統一**: 過去アーカイブ内で `"0.5"` と `"0.5.0"` が混在し、期間リストで重複表示される不整合が存在した。

### 13.2 R2 スナップショットの設計（Zero-D1 配信）
戦闘データと同様に、**「事前に計算・集約した JSON を R2 に配置し、Worker は R2 から直接高速配信する（Zero-D1）」** アーキテクチャへと刷新。

#### スナップショットのキー体系
- プレフィックス: `snapshots/ship_growth/`
- 期間サマリ: `snapshots/ship_growth/summary.json.br`
- 累積パラメータ: `snapshots/ship_growth/cumulative.json.br`
- 全期間比較: `snapshots/ship_growth/all_periods.json.br`
- 期間別 bounds: `snapshots/ship_growth/bounds/{period_tag}_{table_version}.json.br`
- 期間別 exp: `snapshots/ship_growth/exp/{period_tag}_{table_version}.json.br`

#### テーブルバージョンの完全正規化（`0.5` → `0.5.0`）
- `normalizeTableVersion(version: string)` を導入し、`"0.5"` の表記をすべてセマンティックバージョニング標準の `"0.5.0"` に一本化。
- アーカイブ集約時に `0.5` と `0.5.0` を同一期間（例: `2026-07-08/0.5.0`）としてマージ。
- R2 上の旧形式キー `*_0.5.json.br` は自動削除しない。manifest 移行後は参照されず、必要な旧オブジェクトを誤削除しない。
- API エンドポイント（`/bounds`, `/exp`）に `table_version=0.5` が渡された場合も、サーバー側で自動的に `0.5.0` のスナップショットキーへ解決して即座に応答（後方互換ガード）。

### 13.3 ブラウザ透過伸長と平文 JSON 返却の原則
Worker からブラウザへスナップショットを配信する際、以下の重大な落とし穴を解消した。
- **問題**: Worker 内で R2 の Brotli バイナリに手動で `Content-Encoding: br` ヘッダーを付けてストリーム返却すると、ブラウザ Fetch API / `cachedFetch`（内部で `res.clone().text()` を実行）で透過解凍が行われず、生バイナリ（`~ D5n...`）が渡って `Failed to execute 'json' on 'Response': Unexpected token ... is not valid JSON` のクラッシュが発生する。
- **対策**: Worker レベルでは `Content-Encoding: br` を一切付与しない。Worker 内で native zlib（`brotliDecompressAsync`）を用いて平文 JSON 文字列へと解凍し、`Content-Type: application/json; charset=utf-8` で返却する。
- クライアントとエッジ間の gzip/br 圧縮は Cloudflare CDN のネイティブ透過的圧縮に任せることで、ブラウザの HTTP スタックが確実に自動解凍を行い、100% 安定した JSON パースを保証する。

### 13.4 再構築・バックフィル用内部 API
- 設定済みの `ADMIN_TOKEN` と `INTERNAL_COMPACTION_TOKEN` のいずれかを既存の timing-safe helper で照合する。無認証ではストレージにアクセスしない。
- エンドポイント: `POST /api/ship-growth/internal/rebuild-snapshots`
- 認証: `Authorization: Bearer <ADMIN_TOKEN>`（タイミングセーフ検証）
- 動作:
  1. `SHIP_GROWTH_ARCHIVE_BUCKET` 内の全 `ship-growth/archive/` オブジェクトを走査。
  2. バージョンを `0.5.0` に正規化しながら、bounds（最小値 MIN）および caps（最大値 MAX）を集約。
  3. D1 に最新期間が存在する場合は最新期間のスナップショットも生成。
  4. `generations/{generation}/` に `summary`, `cumulative`, `all_periods` および各期間の bounds/exp を保存する。
  5. 全入力・全保存が成功した場合だけ `manifest.json` を ETag 条件付きで切り替える。欠落・不正な入力、D1/R2 例外、競合があれば旧世代を維持して失敗を返す。

### 13.5 クライアントの鮮度とエラー表示（2026-10-27 監査）

- `cachedFetch` のメモリ鮮度は最大10分とし、HTTP `max-age` / `Age` が示す残存時間を超えて延長しない。IndexedDB の7日は保存・オフライン利用の上限であり、未検証で配信し続ける期間ではない。
- 「更新」は `cache: "reload"` で現在表示中の exp / bounds / cumulative / all-periods を再取得する。これはサーバー側の再構築や CDN キャッシュ削除を実行する操作ではない。
- AbortSignal を持つ呼び出しは通信を共有せず、一方のキャンセルを別の画面へ伝播させない。同じ URL の古い通信は、新しい更新結果や明示的なキャッシュ消去を上書きしない。
- JSON として不正なレスポンスは保存しない。中断をオフライン成功に置き換えず、保存上限を超えた IndexedDB データも復活させない。
- 累積・期間比較で最新期間の bounds 取得が失敗した場合、成功扱いで欠落させずエラーを表示する。読込失敗後は、前の期間のグラフを新しい期間の結果として表示しない。
- 最新期間はサマリ配列の先頭ではなく期間タグとテーブルバージョンで選択する。caps の短縮キーは共通正規化処理を通し、明示的な `0` を保持する。

### 13.6 世代公開・更新・リソース上限

- 論理キーは13.2のままとし、`snapshots/ship_growth/manifest.json` が各論理キーから世代別の実体キーを参照する。manifest がない環境では従来の固定キーを読み、段階移行を可能にする。
- 完成済み世代の実体が欠落・破損している場合は503とし、別世代やD1への暗黙の切替で成功に見せない。manifest がない、または対象の論理キーが存在しない場合の既存フォールバックは維持する。
- 読取は manifest と実体を R2 から解決し、古い HTTP キャッシュより優先する。スナップショット応答は `max-age=0, must-revalidate` とし、固定 URL の CDN / メモリ鮮度で更新を隠さない。ヒット時は D1 binding 自体を必要としない。
- ingest のD1コミット成功後、バックグラウンドで対象期間の bounds/exp と summary/cumulative/all-periods を更新する。既存の集計をマージし、全アーカイブを再走査しない。並行更新は manifest の ETag 条件で検出し、最大3回まで最新入力から再計算する。初回の manifest 作成だけは全再構築になる。
- バックグラウンド公開の失敗はログへ明示する。ingest の保存成功と公開完了は別であり、waitUntil の中断や失敗後は内部APIによる再構築が必要になる場合がある。
- `0.5` と `0.5.0` のD1行は両方を読み、正規化した同一期間として一度だけ保存する。過去の EXP は bounds とは独立して検出する。bounds の `0` は従来仕様どおり未観測であり、正の観測の最小値を消さない。
- JSONは1件16 MiB以下、圧縮入力も16 MiB以下とする。Brotli解凍には `maxOutputLength` を指定する。超過時は切捨てず失敗する。これは isolate 全体のメモリやCPU時間の保証ではなく、全再構築で保持するMapや並行要求の負荷測定・将来の分割生成は引き続き必要。
- [Cloudflare公式制限](https://developers.cloudflare.com/workers/platform/limits/#memory)（2026-10-27確認）では通常のWorkersはFree/Paidとも isolate あたり128 MB、JSヒープとWasmを含み並行要求と共有する。CPUはFree HTTPで10 ms、Paid HTTPは既定30秒・設定で最大5分であり、50 msをFreeの前提にしない。

### 13.7 運ステータス（lucky_naked）およびレベル別パラメータ一覧表示

- **運のデータ特性**:
  - D1 の `ship_growth_bounds` テーブルおよび R2 スナップショット（`bounds`）に保存されている `lucky_naked`（裸の運ステータス）を可視化。
  - 運は通常レベルアップで成長せず初期値固定（まるゆ改修等で上昇）のため、未改修の初期運が下限値（最小観測値）として記録される。
  - 2026年4〜5月の初期アーカイブなど、`lucky_naked` カラムが存在しない旧データに対しては、Zod スキーマ（`ShipGrowthArchiveBoundsRowSchema` / `ShipGrowthBoundSchema`）で `optional().default(0)` フォールバックを提供し、下位互換性を確保する。
- **UI表示**:
  - 折れ線グラフ（Chart.js）にアンバー色（`rgb(234, 179, 8)`）の「運(naked)」系列を追加。
  - 全期間比較モード（`all_periods=1`）では、4系列（回避・対潜・索敵・運）× 期間数として描画され、新旧に応じた不透明度グラデーションと履歴期間数計算（データセット数 ÷ 4）を適用。
  - 単一期間モードでは折れ線グラフ直下に「レベル別パラメータ一覧 (naked)」テーブル（DaisyUI `table table-pin-rows`）を配置し、Lvごとの回避・対潜・索敵・運の数値を一覧確認可能。
