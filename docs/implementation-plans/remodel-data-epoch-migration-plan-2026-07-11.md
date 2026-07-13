# Remodel Data Epoch Migration Plan (2026-07-11)

## 1. 背景

改修データ収集は、これまで `api_req_kousyou@remodel_slotlist` / `api_req_kousyou@remodel_slotlist_detail` を前提に、
FUSOU-APP で parse -> interface 変換 -> sender 送信し、FUSOU-WEB 側の ingest API に格納する方式で動作していた。

しかし、まず顕在化している一次障害は、`api_req_kousyou/remodel_slotlist` の
`api_req_slot_id` / `api_req_slot_num` 欠落ケースを必須フィールドとしてパースしていることであり、
`missing field 'api_req_slot_id'` で失敗して改修データ収集が停止している。
その上で、2026-06 前後に改修導線そのものも変化しているため、短期修正と中長期対応の二段構えが必要。

この計画書は以下を目的とする。
1. 既存フローを明文化する
2. FUSOU-PROXY-DATA の観測から変更時期を確定する
3. 構造体の epoch 管理方針を定義する
4. 収集方式の変更方針を段階的に実装可能な形で示す

## 2. 調査サマリ

### 2.1 code-review-graph で確認した現行フロー

- APP 受信起点:
  - `FUSOU-APP/src-tauri/src/json_parser.rs::struct_selector_response`
  - `FUSOU-APP/src-tauri/src/json_parser.rs::struct_selector_resquest`
- parser 層:
  - `kc_api/crates/kc-api-parser/src/parser.rs::response_parser`
  - `kc_api/crates/kc-api-parser/src/parser.rs::request_parser`
- remodel emit:
  - `kc_api/crates/kc-api-interface-adapter/src/convert_trait/api_req_kousyou.rs`
    - `remodel_slotlist::Res` -> `Set::RemodelSlotList`
    - `remodel_slotlist_detail::{Req, Res}` -> `Set::RemodelDetail`
- APP 送信:
  - `FUSOU-APP/src-tauri/src/json_parser.rs` で `Set::RemodelSlotList` / `Set::RemodelDetail` を `remodel_sender` に dispatch
  - `FUSOU-APP/src-tauri/src/senders/remodel_sender.rs`
    - payload 作成
    - suppression cache
    - upload handshake/execution
- WEB 受信/格納:
  - `FUSOU-WEB/src/server/routes/remodel_data.ts`
    - `/ingest` で schema validation
    - D1 (`remodel_slotlist_entries`, `remodel_detail_entries`) へ保存

### 2.2 FUSOU-PROXY-DATA で確認した時系列と欠落フィールド実態

観測方法: `packages/FUSOU-PROXY-DATA` のファイル名タイムスタンプと endpoint 名を集計。

- 旧 endpoint の最終観測帯:
  - `2026-05-29/kcsapi/*@api_req_kousyou@remodel_slotlist`
  - `2026-05-29/kcsapi/*@api_req_kousyou@remodel_slotlist_detail`
- 以降 (2026-06-26, 2026-07-08 フォルダ) の改修系観測:
  - `api_req_kaisou@remodeling` は存在
  - `api_req_kousyou@remodel_slotlist*` は見当たらない

追加検証 (実データ全件走査):
- `S@api_req_kousyou@remodel_slotlist` 18 ファイル中、全 18 ファイルで
  `api_req_slot_id` / `api_req_slot_num` 欠落エントリを確認。
- これは 2025-11-05 サンプルにも存在し、直近導線変更以前から起きうる。

結論:
- 一次障害の根本原因は **DTO 必須化ミス (optional 欠落未対応)**。
- 導線切替の観測とは独立に、まずこのパース耐性を最優先で修正すべき。
- その上で、収集前提の変化時期は **2026-05-29 〜 2026-06-26** の間と扱う。

注意:
- `FUSOU-PROXY-DATA` は git 追跡履歴ではなくスナップショット集積が中心のため、厳密な commit 単位ではなく観測窓として扱う。

## 3. 問題の本質

現行実装は「特定 endpoint + 固定 DTO 形状」に強く依存している。

依存点:
1. endpoint 名依存 (`api_req_kousyou/remodel_slotlist*`)
2. DTO 必須フィールド依存 (i64 固定)
3. emit 経路依存 (`Set::RemodelSlotList`, `Set::RemodelDetail` のみ)
4. WEB ingest 側の固定 validation (`event_type` と旧 payload 項目)

このため、
- endpoint 移動
- フィールド名変更
- optional 化/ネスト変更
のいずれでも収集が止まりうる。

特に今回の障害は、`api_req_slot_id` / `api_req_slot_num` の欠落を
nullable として受理していないことが直接原因。

## 3.1 最優先ホットフィックス

目的: `Failed to parse Res JSON("/kcsapi/api_req_kousyou/remodel_slotlist")` を即時解消。

作業:
1. `kc-api-dto` の `remodel_slotlist::ApiData`
  - `api_req_slot_id: i64` -> `Option<i64>`
  - `api_req_slot_num: i64` -> `Option<i64>`
2. `kc-api-interface-adapter` の変換
  - 欠落時は `unwrap_or(0)` で後方互換値に正規化
3. 単体確認
  - 欠落フィールドを含む実データで deserialize 成功すること

完了条件:
- 上記 parse error が再現しない
- 既存フィールドありケースの挙動を維持

## 4. Epoch 管理方針

## 4.1 epoch 定義

改修データに `schema_epoch` を導入する。

- `remodel_v1_kousyou_slotlist_detail`
  - 旧経路: `api_req_kousyou@remodel_slotlist*`
- `remodel_v2_post_kousyou`
  - 新経路: 2026-06 以降に観測される改修導線 (現時点では候補: `api_req_kaisou@remodeling` と追加探索 endpoint)

実装上は enum + 永続文字列で管理:
- Rust: `enum RemodelSchemaEpoch`
- Payload/Web: string literal (`"remodel_v1_kousyou_slotlist_detail"`, `"remodel_v2_post_kousyou"`)

## 4.2 どこに保持するか

- APP 内部:
  - interface 変換時に epoch 判定し、emit payload に付与
- APP -> WEB payload:
  - すべての remodel ingest payload に `schema_epoch` を追加
- WEB D1:
  - 両テーブルに `schema_epoch TEXT NOT NULL` を追加
  - 既存データは backfill で `remodel_v1_kousyou_slotlist_detail`

## 4.3 互換ポリシー

- WEB ingest は当面 `v1` と `v2` を受理
- 集計 API は `schema_epoch` でフィルタ可能にする
- 既存機能互換のためデフォルト集計は `v1 + v2` 合算、必要に応じて epoch 指定で切り分け

## 5. 収集変更方針

## 5.1 Phase A: 観測強化 (先行)

目的: v2 の実データ形状を先に確定する。

作業:
1. parser error の可観測性を追加
   - 現在 `json_parser.rs` は parse error を握りつぶすため、endpoint/path と error を warning 出力する
2. 改修関連 endpoint の raw 保存を拡張
   - `api_req_kaisou@remodeling` 前後で同時発火する endpoint を探索
3. FUSOU-PROXY-DATA 収集手順に「改修画面操作シナリオ」を固定化
   - 曜日差、秘書艦差、改修段階差を含む

完了条件:
- v2 の Req/Res サンプルを最低 3 セッション分取得
- 形状差分表 (v1 vs v2) を docs 化

## 5.2 Phase B: DTO/Adapter の epoch 対応

目的: v1 と v2 を同時に parse/emit 可能にする。

作業:
1. `kc-api-dto` に v2 用構造体を追加 (または既存に後方互換 optional を追加)
2. `kc-api-interface-adapter` に epoch 判定付き変換を追加
3. `Set::Remodel*` に epoch 情報を載せる
4. v1 パスは現状維持で回帰防止

完了条件:
- v1 サンプルで既存テスト green
- v2 サンプルで parse/emit 可能

## 5.3 Phase C: Sender/Web ingest の拡張

目的: epoch 付きで安全に蓄積する。

作業:
1. `FUSOU-APP/src-tauri/src/senders/remodel_sender.rs`
   - handshake body / payload に `schema_epoch` 追加
2. `FUSOU-WEB/src/server/routes/remodel_data.ts`
   - validation に `schema_epoch` を追加
   - epoch ごとの差分フィールド許容を実装
3. D1 migration
   - `schema_epoch` カラム追加
   - index (`period_tag`, `table_version`, `schema_epoch`) を追加

完了条件:
- v1/v2 の ingest 両立
- summary API の返却に epoch 情報を含められる

## 5.4 Phase D: 集計/利用系の調整

目的: データ欠損・混在を運用上扱えるようにする。

作業:
1. summary/check script に epoch 切り分けを追加
2. 画面/API で epoch を指定可能にする (内部向けでも可)
3. 運用ダッシュボードで epoch 別件数を監視

## 6. 変更対象ファイル (予定)

APP:
- `packages/FUSOU-APP/src-tauri/src/json_parser.rs`
- `packages/FUSOU-APP/src-tauri/src/senders/remodel_sender.rs`

kc_api:
- `packages/kc_api/crates/kc-api-dto/src/endpoints/api_req_kousyou/remodel_slotlist.rs`
- `packages/kc_api/crates/kc-api-dto/src/endpoints/api_req_kousyou/remodel_slotlist_detail.rs`
- `packages/kc_api/crates/kc-api-dto/src/endpoints/api_req_kaisou/remodeling.rs`
- `packages/kc_api/crates/kc-api-interface-adapter/src/convert_trait/api_req_kousyou.rs`
- `packages/kc_api/crates/kc-api-interface-adapter/src/convert_trait/api_req_kaisou.rs`
- `packages/kc_api/crates/kc-api-interface/src/remodel.rs`
- `packages/kc_api/crates/kc-api-interface/src/interface.rs` (必要なら)

WEB:
- `packages/FUSOU-WEB/src/server/routes/remodel_data.ts`
- `packages/FUSOU-WEB/migrations/remodel-index/*.sql` (新規 migration)
- `packages/FUSOU-WEB/scripts/check-experimental-data.mjs`

Docs:
- `docs/implementation-plans/remodel-data-epoch-migration-plan-2026-07-11.md` (本書)
- 必要なら `docs/architecture/remodel_data_cloudflare_implementation_plan.md` に追記

## 7. テスト計画

最小確認:
1. Rust 側 DTO/adapter テスト
   - remodel 関連 endpoint の deserialize test
   - v1/v2 サンプル双方
2. APP 側送信
   - epoch 付き payload 生成
   - suppression cache への影響確認
3. WEB 側
   - `/api/remodel-data/ingest` で v1/v2 を受理
   - D1 insert 成功
   - summary/check script が epoch 別件数を表示

推奨コマンド:
- `pnpm -C packages/FUSOU-WEB run astro check`
- `pnpm -C packages/FUSOU-WEB run check:experimental-data:remodel`
- `cargo test` (kc_api 関連 crate を対象限定)

## 8. ロールアウトとロールバック

ロールアウト:
1. 観測強化のみ先行デプロイ
2. v2 parse を shadow 有効化 (保存はするが利用しない)
3. 集計/UI を epoch aware 化
4. 必要に応じて v2 をデフォルト反映

ロールバック:
- feature flag で remodel ingest を停止
- ingest 受理 epoch を v1 のみに制限
- v2 集計表示を無効化

## 9. リスクと対策

リスク:
1. v2 形状確定前に実装を進めると再崩壊する
2. epoch 混在で集計が二重計上される
3. parse error が黙殺されると再発検知が遅れる

対策:
1. Phase A 完了を実装開始条件にする
2. epoch を PK/UNIQUE 設計に含める
3. parse error ログを必須化し、件数監視を追加する

## 10. 実施順序 (短期)

1. 観測強化 PR
2. epoch カラム追加 migration PR
3. DTO/adapter v2 対応 PR
4. sender + ingest 対応 PR
5. 集計/運用整備 PR

以上。