# Ship-Growth Cross Rules Compatibility Plan (2026-07-10)

## 背景
- 現在の `ship-growth` 推定処理は `cross_rules[].pairs` 前提でクロスシナジーを読み込んでいる。
- 新しいシナジー生成物は `cross_rules` を `category_pools` / `item_pool` / `implicants` などの圧縮形式で保持しており、`pairs` を持たない。
- この不整合により、ship-growth 側でクロスシナジー差し引きが欠落し、推定値（回避/対潜/索敵/運）が過大化するリスクがある。

## Goals
- `ship-growth` 側で新旧 `cross_rules` の両形式を解釈し、クロスシナジー差し引きを正しく適用する。
- 既存の `pairs` 形式も後方互換として維持する。
- 変更範囲を `packages/FUSOU-WEB/src/server/routes/ship_growth.ts` に極力限定する。

## Non-Goals
- シナジー生成器 (`equip_synergy_detector`) の仕様再変更は行わない。
- ship-growth の DB スキーマ変更は行わない。
- UI/表示ロジックのリファクタは行わない。

## 実装方針
1. データモデル拡張
- `ParsedSynergyPayload.cross_rules` の型を `pairs` 前提から、`item_pool` / `fixed_items` / `free_pool` / `category_pools` / `implicants` / `combos_*` を含む union 的な形へ拡張する。
- ship-growth 用の内部表現として、
  - 既存の `crossByPair`（高速経路）
  - 汎用評価用 `crossRules`（新形式含む）
  を保持する。

2. ルール評価器追加
- 装備カウントマップ（重複装備含む）に対し、ルールが何回成立するかを返すヘルパを追加する。
- 対応対象:
  - `pairs`
  - `item_pool`
  - `fixed_items + free_pool`（必要なら `free_pool_with_replacement`/`free_pick_count`）
  - `category_pools`
  - `implicants`
- `combos_*` は ship-growth の推定で当面必須でない可能性が高いが、型受理と安全な no-op / 明示ログで事故を防ぐ。

3. 差し引きロジック統合
- 既存ペア差し引きは維持。
- 新形式ルール群を追加で評価し、成立回数 × synergy を `crossSynergyTotals` に加算する。
- ship 単位適用条件（`ships`）は現行の `hasShipRule` を使い統一する。

4. 観測可能性
- 無効ルール/未知形式の件数を period 単位で warn ログ出力（過剰ログは抑制）。
- デバッグしやすいように「スキップ理由」を最小限で残す。

## 検証計画
- 静的検証:
  - `pnpm run astro check`
- データ整合確認（ローカルJSON）:
  - 新形式 `cross_rules` を含む出力に対して、ship-growth ローダで `crossRules` が 0 件にならないことを確認。
- 回帰確認:
  - `pairs` 形式データ（旧出力）でも推定が継続動作することを確認。

## ロールアウト/ロールバック
- ロールアウト:
  - サーバールート単独パッチとして適用。
- ロールバック:
  - `ship_growth.ts` の該当コミットを revert すれば復旧可能。

## 実装タスクチェックリスト
- [x] `cross_rules` 型を新形式対応に拡張
- [x] ship-growth 内部データセットに汎用 `crossRules` を追加
- [x] ルール成立回数評価ヘルパ実装
- [x] `deriveServerNakedStats` へ新形式評価を統合
- [x] 旧 `pairs` 形式後方互換を確認
- [x] `pnpm run astro check` 実行
- [x] 影響範囲と残リスクを報告
