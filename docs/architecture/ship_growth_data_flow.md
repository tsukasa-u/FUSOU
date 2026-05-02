# Ship Growth データフロー仕様書（詳細版）

作成日: 2026-04-09  
最終更新日: 2026-04-10

この文書は、艦娘成長データが

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
- ships: 艦娘配列

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
- base_wait = interval_seconds * 2^attempt_count
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
