# kc_api: カスタム cfg(since/until) 時系列レイアウト再現 実装計画

- 作成日: 2026-06-22
- 最終更新: 2026-07-01（現行実装同期）
- 対象: `packages/kc_api`（workspace 全体）
- 目的: 日付ターゲット指定により、当時未実装/廃止済みフィールドをコンパイル時に完全除去し、仕様時点の構造体を再現する

## 0. 値の分類

この計画書では、数値や日付を次の3種類に分けて扱う。

- 現行実値: すでにリポジトリ内で使われている値
- 要件の例示値: ユーザー提示プロンプトに出てくるサンプル値
- 実装値: この計画で実際に採用する値

| 値 | 分類 | 意味 |
| --- | --- | --- |
| `20250627` | 現行実値 | 既存 `kc_api` で使われている日付 feature / 境界日 |
| `from20250627` | 現行実値 | 既存の加法的 feature 名 |
| `1750993200` | 現行実値 | 既存テストで使われている Unix 秒境界。`2025-06-27 00:00:00 UTC` 相当 |
| `target_20200101` | 要件の例示値 | ユーザー提示プロンプト内の例。kc_api 本計画では採用しない |
| `target_20220101` | 要件の例示値 | 同上 |
| `target_20250101` | 要件の例示値 | 同上 |
| `genesis` | 実装値 | 既存境界 `20250627` より前の実装系を表す基点 target（旧 `not(feature = "20250627")` 相当） |
| `epoch_20250627` | 実装値 | 既存境界 `20250627` 以降の実装系を表す target（旧 `feature = "20250627"` 相当） |
| `20250627` | 実装値 | `since/until` の最初の基準日として採用 |
| `99999999` | 要件の例示値 | 以前案の番兵値。単一 target 強制方針に変更するため本計画では採用しない |

補足:

- この計画では、既存日付 feature から逆算した日付のみを target として採用する
- 現行コードの `20250627` 系 feature は、移行期間中は残すが、最終的には `genesis` / `epoch_YYYYMMDD` に寄せる
- target feature は `genesis` または `epoch_YYYYMMDD` のどれか1つだけ指定する。0個または2個以上は build.rs でコンパイルエラーにする

## 0.1 命名規約（確定）

- `2025-06-27` より前の系統は `genesis` を使う
- `2025-06-27` 以降は `epoch_YYYYMMDD` を使う
- 新しい仕様変更日が増えるたびに `epoch_YYYYMMDD` を追加する
- `target_YYYYMMDD` という接頭辞は採用しない

例:

- `--features genesis`
- `--features epoch_20250627`
- 将来 `2026-01-15` が境界になるなら `--features epoch_20260115`

## 0.2 現在の実装状況（2026-07-01）

- `kc-api-build-config` と各対象 crate の `build.rs` は導入済み（`emit_epoch_cfg()` を使用）
- `genesis` / `epoch_20250627` の単一 epoch 制約は build.rs で有効（複数 epoch は panic）
- 現状の互換運用として、複数 crate の default feature に `genesis` が含まれている
  - そのため、`epoch_20250627` を明示指定する検証は `--no-default-features` 前提
- `kc-api-database` の仕様により schema feature は必須
  - `kc-api` 検証では `schema_v0_5` 併記を必須とする

## 1. 結論（実装可能性の検証結果）

結論として、提案方式は **実装可能**。ただし、以下の条件を満たす設計に修正しないと、workspace では破綻する。

- 条件1: `build.rs` は「各対象 crate」に必要（1 crate だけでは伝播しない）
- 条件2: ターゲット feature は「各対象 crate」に同名で定義し、上位 crate から明示転送する
- 条件3: `cfg(since/until)` のチェック許可（`rustc-check-cfg`）を各対象 crate で設定する
- 条件4: 「メモリレイアウト完全再現」の定義を明確化する（Rust の `repr(Rust)` は厳密 ABI を保証しない）

## 2. 検証で確認した事実（根拠）

### 2.1 カスタム cfg 生成自体は成立

最小 PoC で以下を確認済み。

- `build.rs` から `cargo:rustc-cfg=since="YYYYMMDD"` と `cargo:rustc-cfg=until="YYYYMMDD"` を発行可能
- `#[cfg(since = "...")]` / `#[cfg(until = "...")]` によるフィールドのコンパイル除去は成立
- 単一 epoch feature 指定で `build.rs` が `since/until` を正しく発行できることは成立
- 複数 epoch feature 指定は設計方針として禁止し、コンパイルエラー化する
- `cargo:rustc-env=SELECTED_DATE=...` で `env!("SELECTED_DATE")` 埋め込み可能

### 2.2 重要な落とし穴: cfg は依存 crate に伝播しない

PoC（2 crate workspace）で以下を確認済み。

- crate A の `build.rs` で発行した `cfg(since=...)` は crate B には効かない
- よって、`kc-api` だけに `build.rs` を置く構成では、`kc-api-interface` / `kc-api-dto` / `kc-api-interface-adapter` 側の `#[cfg(since/until)]` は機能しない

### 2.3 現行 kc_api は既に日付 feature 依存が強い

現行コードは `feature = "20250627"` / `feature = "from20250627"` で複数 crate が連動している。

- 既存 feature 依存箇所:
  - `crates/kc-api/Cargo.toml`
  - `crates/kc-api-interface/Cargo.toml`
  - `crates/kc-api-dto/Cargo.toml`
  - `crates/kc-api-interface-adapter/Cargo.toml`
  - 関連 Rust ソース多数（`#[cfg(feature = "20250627")]` 等）

このため、新方式は「単独差し替え」ではなく「段階移行」が必要。

## 3. 提案プロンプトの実装要件に対する適合性評価

### 3.1 Cargo.toml 要件

要件: `target_YYYYMMDD` をフラットに列挙、加法依存なし。

評価:

- 単一 crate ではそのまま可能
- workspace では上位 crate だけの feature だと伝播しないため、対象 crate 全てに同名 feature を定義し、上位 crate から転送が必要
- 「feature 間依存を持たせない」は維持可能（各 `target_x` は空配列で良い）

### 3.2 build.rs 要件

要件: `CARGO_FEATURE_TARGET_<YYYYMMDD>` を拾って `since/until` 発行、`SELECTED_DATE` を埋め込み。

評価:

- 実装可能
- ただし各対象 crate に同等 `build.rs` が必要
- `rustc-check-cfg` 設定をしないと warning が増えるため必須

### 3.3 lib.rs 要件

要件: `GameEntityNode` に共通/追加/廃止フィールド、`new` と `deserialize_and_verify`。

評価:

- 実装可能
- `deserialize_and_verify` は「先に JSON から `data_version` を取り出して照合し、その後に本体デシリアライズ」が安全
  - 直接 `from_str::<GameEntityNode>` すると、構造不一致でバージョン照合まで到達しない場合がある

### 3.4 「メモリレイアウト完全再現」の解釈

要件文の「完全再現」は注意が必要。

- `cfg` によるフィールド除去で「フィールド集合」は時点再現できる
- ただし Rust の `repr(Rust)` は厳密な ABI・パディング配置を保証しない
- 本当にバイト配置まで固定したいなら `#[repr(C)]` 等の設計統制が必要
- ただし `repr(C)` 導入は既存型・派生・シリアライズ方針との整合を検証要

本計画では「当時存在したフィールド集合をコンパイル時に一致させる」を第一義とし、ABI 厳密再現は別トラックで扱う。

## 4. 実装時に問題になる箇所と対策

### 4.1 問題A: crate 間で日付選択が不一致になる

症状:

- 一部 crate だけ `epoch_20250627`、他 crate は `genesis` など別 epoch、という不一致ビルドが起きうる

対策:

- 対象 crate 全てで同じ epoch feature セット（`genesis`, `epoch_YYYYMMDD`）を定義
- ルート `crates/kc-api` から依存 crate feature を全面転送
- CI で「単一 target のみ指定」チェックを導入

### 4.2 問題B: build.rs 重複実装で保守コスト増

症状:

- crate ごとに同じ `build.rs` ロジックをコピペするとドリフト

対策:

- `crates/kc-api-build-config`（新規）を build-dependency 用 helper crate として追加
- 各 `build.rs` は helper の 1 関数呼び出しに集約

### 4.3 問題C: 既存 feature (`20250627`, `from20250627`) との共存

症状:

- 一括置換すると既存テストや依存コードが壊れる

対策:

- 段階移行:
  - Phase 1: 新 feature/cfg を追加し、既存 feature も維持
  - Phase 2: コード側を `cfg(since/until)` へ移行
  - Phase 3: 旧 feature を deprecate

### 4.4 問題D: データ整合性チェックの誤判定

症状:

- `data_version` が一致しても、実データの schema 差分で失敗する可能性
- 逆に `data_version` 不一致を見落とす可能性

対策:

- `deserialize_and_verify` で:
  - Step 1: `serde_json::Value` へ読み込み
  - Step 2: `data_version` を文字列で厳密比較
  - Step 3: 一致時のみ型デシリアライズ
- エラー型を `VersionMismatch`, `MissingVersion`, `InvalidPayload` に分離

## 5. 実装アーキテクチャ（採用案）

## 5.1 対象 crate

最低限、日付依存の型/変換を持つ以下を対象にする。

- `crates/kc-api`
- `crates/kc-api-interface`
- `crates/kc-api-dto`
- `crates/kc-api-interface-adapter`
- `crates/kc-api-integration-test`

## 5.2 feature 命名

- 初期導入時の実装値:
  - `genesis`（20250627 より前の系統）
  - `epoch_20250627`（20250627 以降の系統）
- 将来追加は、実際の仕様変更日が確定した時点で `epoch_YYYYMMDD` を追加する

## 5.3 build.rs 共通仕様

- 入力:
  - `CARGO_FEATURE_GENESIS`
  - `CARGO_FEATURE_EPOCH_YYYYMMDD`
- 制約: target feature は必ず1つだけ選択されていること
- エラー条件:
-  0個: `panic!("Exactly one epoch feature must be selected (genesis or epoch_YYYYMMDD)")`
-  2個以上: `panic!("Multiple epoch features are not allowed")`
- 選択:
  - `genesis` 選択時: `target_date = 0`
  - `epoch_YYYYMMDD` 選択時: `target_date = YYYYMMDD`
- 発行:
  - `cargo:rustc-cfg=since="DATE"`（`target_date >= DATE`）
  - `cargo:rustc-cfg=until="DATE"`（`target_date < DATE`）
  - `cargo:rustc-env=SELECTED_DATE=...`
  - `cargo:rustc-check-cfg=cfg(since, values(...))`
  - `cargo:rustc-check-cfg=cfg(until, values(...))`

feature 解析ロジック（実装必須）:

1. `std::env::vars()` から `CARGO_FEATURE_` で始まる key を抽出
1. `GENESIS` は `genesis` として扱う
1. `EPOCH_` で始まるものは後続を日付として parse（`u32`）
1. `genesis` と `epoch_*` の合計件数が 1 以外なら panic
1. 選択結果を `cargo:rustc-env=SELECTED_EPOCH=...` としても出力（`genesis` または `epoch_YYYYMMDD`）

累積上書きルール:

- 日付が古い順に A, B, C の仕様変更がある場合、target=C では A と B までの変更が累積適用される
- 競合する実装は「新しい日付側が勝つ」ように `until` で範囲を閉じる
- 例:
  - 旧実装: `#[cfg(all(since = "A", until = "B"))]`
  - 新実装: `#[cfg(since = "B")]`
- これにより target=C では新実装（B 側）が有効になり、旧実装は無効になる

## 5.5 `since` / `until` キーワード衝突調査結果

調査対象:

- `packages/kc_api` 全体で `since` / `until` の出現箇所を確認
- 既存の JSON 描画・構造解析コード（regex/syn パーサ）への影響を確認

調査結果:

1. Rust コンパイラ観点:
  - `cfg(since = "...")` / `cfg(until = "...")` は custom cfg 名として使用可能
  - Rust の予約語衝突は発生しない
1. 既存コード観点:
  - `kc-api-dto/src/endpoints/api_start2/get_data.rs` に `#[deprecated(since = "0.4.0")]` が既に存在
  - これは `deprecated` 属性の named argument であり、`cfg(since)` とは名前空間が異なる
  - 直接のコンパイル衝突はないが、grep/解析時の可読性は下がる
1. 既存描画システム観点:
  - `check_struct_dependency.rs` / `check_struct_dependency_syn.rs` は `cfg(feature = "...")` 前提の抽出実装
  - `cfg(since/until)` をそのまま導入すると、フィールド有効条件の解析が壊れる

結論:

- コンパイラ衝突はないため `since/until` を採用可能
- ただし可視化・JSON出力系の解析ロジックは必ず改修が必要

## 5.4 API レベル設計（サンプル構造体）

`GameEntityNode` 仕様:

- 常時: `data_version: String`, `base_firepower: i32`
- 2025-06-27 以降: `new_synergy_factor: f64`
- 2025-06-27 より前: `obsolete_mechanic_id: i32`

`new`:

- `env!("SELECTED_DATE")` を `data_version` に埋め込み
- 引数も `#[cfg]` で同条件制御

`deserialize_and_verify`:

- 先に `data_version` を抽出比較
- 不一致なら `VersionMismatchError`

## 6. 具体的変更ファイル案

### 6.1 追加

- `packages/kc_api/crates/kc-api/build.rs`
- `packages/kc_api/crates/kc-api-interface/build.rs`
- `packages/kc_api/crates/kc-api-dto/build.rs`
- `packages/kc_api/crates/kc-api-interface-adapter/build.rs`
- `packages/kc_api/crates/kc-api-integration-test/build.rs`
- （推奨）`packages/kc_api/crates/kc-api-build-config/`（build helper）

### 6.2 更新

- 各対象 crate の `Cargo.toml`:
  - `build = "build.rs"`
  - `features` に `genesis`, `epoch_YYYYMMDD` 追加
  - 現状は互換性維持のため default feature に `genesis` を含む crate がある（段階的移行中）
  - `epoch_*` 検証時は `--no-default-features` で default の `genesis` を無効化して実行する
- 日付条件分岐を持つ Rust ファイル:
  - `#[cfg(feature = "20250627")]` などを `#[cfg(since = "...")]` / `#[cfg(until = "...")]` へ段階移行

### 6.3 JSON保存・描画（構造可視化）系の必須改修

対象:

- `packages/kc_api/crates/kc-api-dto/tests/check_struct_dependency.rs`
- `packages/kc_api/crates/kc-api-dto/tests/check_struct_dependency_syn.rs`
- `packages/kc_api/crates/kc-api-dto/tests/test.rs`
- （必要に応じて）`packages/kc_api/crates/kc-api-database/tests/check_database_dependency_syn.rs`

必須改修内容（具体）:

1. フィールド条件抽出のデータ構造を拡張する
  - 現状: `type CfgCondition = Option<(String, bool)>`（feature 有無のみ）
  - 変更後: `CfgPredicate` enum を導入して `since` / `until` / `all` / `any` / `not` を表現
  - 例:
    - `Always`
    - `Since(u32)`
    - `Until(u32)`
    - `Not(Box<CfgPredicate>)`
    - `All(Vec<CfgPredicate>)`
    - `Any(Vec<CfgPredicate>)`

1. `check_struct_dependency.rs` の regex パーサを置換または補強する
  - 現状 regex は `cfg(feature = ...)` と `cfg(not(feature = ...))` のみ対応
  - `cfg(since/until)` と `cfg(all(...))` が解析できないため、次のいずれかを実施
    - A案（推奨）: `check_struct_dependency_syn.rs` を正本にして `check_struct_dependency.rs` を廃止
    - B案: regex を全面改修し `since/until/all/any/not` を解釈（保守性が低いため非推奨）

1. `check_struct_dependency_syn.rs` の `extract_cfg_condition` を再実装
  - 現状は `feature` / `not(feature)` だけを返す
  - 変更後は `syn::Meta` を再帰的に走査して `since/until/all/any/not` を `CfgPredicate` に変換

1. 条件評価関数を追加
  - `fn eval_predicate(pred: &CfgPredicate, target_date: u32) -> bool`
  - ルール:
    - `Since(d) => target_date >= d`
    - `Until(d) => target_date < d`
    - `All(xs) => xs.iter().all(...)`
    - `Any(xs) => xs.iter().any(...)`
    - `Not(x) => !eval_predicate(x, target_date)`

1. アクティブepoch解決ロジックを feature 名ベースへ変更
  - 現状: `resolve_default_features()` が Cargo.toml default を展開
  - 変更後: `resolve_selected_epoch()` を導入して `cfg!(feature = "genesis")` / `cfg!(feature = "epoch_YYYYMMDD")` から単一epochを確定
  - 0個/複数は `panic!` で失敗させる

1. JSON 出力スキーマを更新
  - `feature_variants.json` を `epoch_variants.json` にリネーム
  - メタ情報に `selected_epoch` と `selected_date` を追加
  - 差分キーを `field_diffs_by_epoch` に変更

1. 可視化アーティファクトの生成結果を安定化
  - 出力先は既存維持:
    - `../../tests/struct_dependency_dot/all.dot`
    - `../../tests/struct_dependency_json/all.json`
  - ただし、同一入力・同一epochで出力が deterministic になるよう並び順を固定（BTreeMap/BTreeSet 使用）

## 7. 移行手順（段階実装）

1. 準備フェーズ

- `genesis` / `epoch_YYYYMMDD` を対象 crate 全てに追加
- build helper + 各 crate `build.rs` を導入
- 既存機能に影響しない状態で `cargo check` を通す

2. 併用フェーズ

- 代表構造体（例: `MstEquipShip`, `ApiMstEquipShip`）を `since/until` へ移行
- 既存 feature 条件と併記して差分検証

3. 切替フェーズ

- `feature = "20250627"` 依存を順次削除
- integration test を `genesis` / `epoch_YYYYMMDD` 基準へ統一
- DTO 構造可視化の JSON/DOT 生成テストを `since/until` 解釈対応へ切替

4. 整理フェーズ

- 旧 feature の deprecate / 削除
- ドキュメント・CI ジョブ名を更新

## 8. 検証計画（必須）

実装後は、以下の順で「ビルドできるか」「cfg が効いているか」「バージョン照合が効いているか」を確認する。

## 8.1 コンパイルマトリクス

- `genesis`
- `epoch_20250627`
- 複数指定時にコンパイルエラーになること
- `--no-default-features` で target 未指定時にコンパイルエラーになること

推奨コマンド:

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/kc_api
cargo check -p kc-api --no-default-features --features genesis,schema_v0_5
cargo check -p kc-api --no-default-features --features epoch_20250627,schema_v0_5
cargo check -p kc-api --no-default-features --features genesis,epoch_20250627,schema_v0_5
cargo check -p kc-api --no-default-features --features schema_v0_5
cargo check -p kc-api
```

確認観点:

- 単一指定の2パターンは成功すること
- 複数指定は build.rs の panic で失敗すること
- `--no-default-features` + schema のみ指定時は build.rs の panic で失敗すること
- default feature では `genesis + schema_v0_5` で成功すること
- `build.rs` の `SELECTED_DATE` が単一指定に追従すること

## 8.2 構造体検証

- `std::mem::size_of::<T>()` と `serde_json` キー集合を target ごとに比較
- 期待:
  - `genesis`: 旧系統のフィールド集合
  - `epoch_20250627`: 新系統のフィールド集合
  - target が新しくなるほど、古い実装は `until` で無効化され、新しい実装へ上書きされる

推奨コマンド:

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/kc_api
cargo test -p kc-api --no-default-features --features genesis,schema_v0_5
cargo test -p kc-api --no-default-features --features epoch_20250627,schema_v0_5
```

確認観点:

- target ごとに `GameEntityNode` のフィールド数が変わること
- `serde_json::to_string` のキー集合が target ごとに一致すること
- `std::mem::size_of::<GameEntityNode>()` が target ごとに変化すること

## 8.3 バージョン照合検証

- 一致時: デシリアライズ成功
- 不一致時: `VersionMismatchError`
- `data_version` 欠落: `MissingVersion`

推奨コマンド:

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/kc_api
cargo test -p kc-api --no-default-features --features genesis,schema_v0_5 deserialize_and_verify
```

確認観点:

- 現在の `SELECTED_DATE` と一致する JSON は通ること
- 古い/新しい `data_version` を入れた JSON は拒否されること
- `data_version` が欠ける JSON は別エラーになること

## 8.4 既存回帰検証

- 既存 integration test（特に `from20250627` 前提テスト）の移行後挙動確認
- データセット時系列境界（20250627）での期待差分確認

推奨コマンド:

```bash
cd /home/ogu-h/Documents/GitHub/FUSOU/packages/kc_api
cargo test -p kc-api-interface
cargo test -p kc-api-dto
cargo test -p kc-api-interface-adapter
cargo test -p kc-api-integration-test

# JSON保存・描画系（構造依存）
cargo test -p kc-api-dto check_struct_dependency --features graphviz,cytoscape,genesis
cargo test -p kc-api-dto check_struct_dependency --features graphviz,cytoscape,epoch_20250627
```

確認観点:

- 既存の `20250627` / `from20250627` 系テストが壊れないこと
- 移行中は旧 feature と新 feature が共存してもビルドできること
- DOT/JSON 生成物が epoch ごとに期待通り変化し、フォーマットが壊れないこと

## 9. 実装完了の判定基準

この計画書では、次の全てを満たした時点を「実装完了」とする。

1. `kc_api` workspace で `genesis` / `epoch_20250627` の各ビルドが成功する
1. 代表構造体で epoch ごとのフィールド消去が期待通りに働く
1. `SELECTED_DATE` がビルド時に埋め込まれ、`data_version` に反映される
1. `deserialize_and_verify` が version mismatch を確実に拒否する
1. epoch 複数指定と `--no-default-features` での epoch 未指定で、意図したコンパイルエラーが出る
1. 構造可視化テスト（DOT/JSON 生成）が `since/until` 解釈後も成功する
1. 旧 `20250627` 系の既存回帰テストが移行範囲で壊れない
1. docs に実装手順と確認コマンドが残る

## 10. リスクと緩和

- リスク: 依存 crate の epoch 指定漏れ
  - 緩和: ルート crate feature 転送 + CI マトリクス強制
- リスク: 旧 feature と新 cfg の二重条件で可読性低下
  - 緩和: 併用期間を短く区切り、段階ごとに削除
- リスク: 「完全メモリレイアウト」期待と実際の ABI 差
  - 緩和: 要件文で「フィールド集合再現」と「ABI 固定」を分離定義

## 11. 受け入れ基準（Definition of Done）

- 単一 epoch 指定時のみ workspace 主要 crate がビルド成功
- epoch 複数指定 / `--no-default-features` での未指定は明示的にビルド失敗
- 代表構造体でフィールド存在条件が期待通り
- `deserialize_and_verify` が不一致を確実に拒否
- 既存回帰テストが epoch 移行後に安定
- JSON保存・描画（struct/database dependency）が `genesis` / `epoch_*` の両方で成立
- docs に運用ルール（target 追加手順、境界日更新手順）が追記済み

## 12. 補足: 提示プロンプトの「完全コード出力」要件について

提示プロンプトの出力形式（`Cargo.toml`, `build.rs`, `src/lib.rs` の完全コード）は、

- PoC / 単一 crate の技術検証用途としては有効
- しかし `kc_api` の実運用では multi-crate feature 伝播と段階移行設計が不可欠

したがって、本プロジェクトでは「まず本計画に従って基盤移行」を実施し、その後に対象構造体ごとの具体コード反映を行う。
