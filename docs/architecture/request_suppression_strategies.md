# Request Suppression Strategies (ship_growth / remodel / quest_tree)

Last updated: 2026-04-18

このドキュメントは、FUSOU-APP の 3 送信系 (`ship_growth`, `remodel`, `quest_tree`) におけるリクエスト抑制戦略を、実装コードに沿って整理したものです。

## 1. 共通基盤: LocalRequestSuppressionCache

3 送信系はいずれも `fusou-upload/src/request_suppression_cache.rs` の `LocalRequestSuppressionCache` を利用します。

### 1.1 データ構造

- `key -> { hash, expires_at }` を保持。
- `scope` を別管理。
- 永続化ファイルに `scope` と `entries` を保存。

### 1.2 should_skip の意味

`should_skip(key, hash)` は以下の動作をします。

1. 既存エントリが期限切れ、または hash 不一致なら削除して `false` を返す（送信側へ進む）。
2. 既存エントリが有効かつ hash 一致なら `true` を返す（抑制）。
3. エントリが存在しない場合は `false`（送信側へ進む）。

つまり「同一 key で、かつ hash 一致、かつ TTL 有効」のときだけ抑制されます。

### 1.3 scope 回転

`rotate_scope(new_scope)` で scope が変わった場合、全エントリをクリアします。

- period や table version の切替時に「新しい観測フェーズ」として再送可能にする目的。

### 1.4 mark_processed のタイミング

`mark_processed` は「アップロード成功時」にのみ呼ばれます。

- 失敗時は mark しないため、次回再送の余地が残ります。

---

## 2. ship_growth の抑制戦略

対象実装: `packages/FUSOU-APP/src-tauri/src/senders/ship_growth_sender.rs`

ship_growth は要件上、以下 3 種を明確に分離して扱っています。

- 経験値境界 (exp)
- パラメータ増分/境界 (bounds)
- パラメータ上限 (caps)

さらに現在は、送信取りこぼし回避のために `payload` 判定を追加しています。

### 2.1 キャッシュ分割

- `bounds_cache`:
  - 用途: bounds と payload
  - scope: `"{period_tag}:{table_version}"`
- `version_cache`:
  - 用途: exp と caps
  - scope: `"{table_version}"`

TTL はどちらも 7 日です。

### 2.2 4 種の hash

- `exp_hash`:
  - 入力: `boundary_lv = lv + 1` の集合（重複除去）
  - 意味: 経験値テーブル境界の観測状態
- `bounds_hash`:
  - 入力: `(master_id, lv)` の集合（重複除去）
  - 意味: レベルごとのパラメータ境界の観測状態
- `caps_hash`:
  - 入力: `master_id` の集合（重複除去）
  - 意味: 上限値観測対象の網羅状態
- `payload_hash`:
  - 入力: `(master_id, lv)` のリスト（重複保持、ソート）
  - 意味: 実スナップショット差分（要件: `master_id + lv` を監視）

注記: `payload_hash` には現在、`kaihi_observed` 等の変動値は含めない実装になっています。

### 2.3 抑制条件

以下 4 条件がすべて true のときのみ suppressed。

- `should_skip("snapshot:exp", exp_hash)`
- `should_skip("snapshot:bounds", bounds_hash)`
- `should_skip("snapshot:caps", caps_hash)`
- `should_skip("snapshot:payload", payload_hash)`

どれか 1 つでも false なら送信します。

### 2.4 成功/失敗時の扱い

- 成功時: 4 キーすべて `mark_processed`
- 失敗時: `mark_processed` しない、retry service を trigger

### 2.5 ログ

- INFO: `event started`
- INFO: `event completed (sent|suppressed|failed)`

`enqueue_snapshot called` は DEBUG です（開始ログとの混同防止）。

---

## 3. remodel の抑制戦略

対象実装: `packages/FUSOU-APP/src-tauri/src/senders/remodel_sender.rs`

### 3.1 キー設計

- slotlist: `slotlist:{secretary_ship_master_id}:{weekday_jst}`
- detail: `detail:{slotitem_master_id}:{remodel_id}`

### 3.2 hash 設計

- `payload_hash = sha256(serde_json(packet))`
- packet 全体を JSON 化して hash するため、内容差分には高感度。

### 3.3 scope

- `table_version` のみで rotate。
- period 切替では無効化しない（cross-period 扱い）。

### 3.4 抑制条件

- 単一条件: `should_skip(key, payload_hash)` が true なら抑制。

### 3.5 成功/失敗時

- 成功時のみ `mark_processed(key, hash)`
- 失敗時は retry service を trigger

---

## 4. quest_tree の抑制戦略

対象実装: `packages/FUSOU-APP/src-tauri/src/senders/quest_tree_sender.rs`

### 4.1 キー設計

- event: `{event_type}:{quest_id}`
- snapshot: `snapshot:{page_no}`

### 4.2 hash 設計

- event:
  - `QuestIngestEvent` をそのまま hash
  - `timestamp_ms` を含むため、同じ quest_id でも時刻差で hash が変わり得る
- snapshot:
  - `QuestIngestSnapshot` を hash
  - `timestamp_ms` は 0 にしてから hash（時刻揺れを抑制）

### 4.3 scope

- `table_version` のみで rotate。
- period 切替では無効化しない（cross-period 扱い）。

### 4.4 抑制条件

- 単一条件: `should_skip(key, payload_hash)` が true なら抑制。

### 4.5 成功/失敗時

- 成功時のみ `mark_processed(key, hash)`
- 失敗時は retry service を trigger

---

## 5. サーバー側重複抑制との関係

3 送信系はいずれも `Uploader::upload` を経由します。

- リクエストヘッダに `content-hash` を付与。
- ハンドシェイク/アップロードで `409 Conflict` を受けた場合は `UploadResult::Skipped` 扱い。

このため、ローカル抑制を抜けた場合でも、サーバー側で最終的に重複排除される層があります。

---

## 6. キャッシュファイル保存先

起動時に `ROAMING_DIR/cache/request_suppression/...` 配下へ永続化されます。

- quest_tree: `quest_tree_sender/quest_request_suppression_cache.json`
- ship_growth:
  - `ship_growth_sender/ship_growth_bounds_suppression_cache.json`
  - `ship_growth_sender/ship_growth_version_suppression_cache.json`
- remodel: `remodel_sender/remodel_request_suppression_cache.json`

---

## 7. ship_growth 戦略の要点（要件との対応）

要件: `master_id` と `lv`（および period）を監視したい。

現行実装での対応:

- `master_id + lv`:
  - `bounds_hash`（集合）
  - `payload_hash`（重複保持リスト）
- period:
  - `bounds_cache` の scope `period_tag:table_version`
- 三種類（経験値・増分・上限）:
  - `exp_hash` / `bounds_hash` / `caps_hash` で独立判定

以上により、ship_growth は三種類の本質データを分離して見つつ、`master_id + lv + period` の監視軸を満たす構成になっています。
