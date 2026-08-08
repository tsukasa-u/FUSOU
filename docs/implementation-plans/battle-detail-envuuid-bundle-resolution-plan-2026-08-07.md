# 戦闘詳細 env_uuid 一括解決 実装計画書 (2026-08-07)

## 背景
- 現在の FUSOU-WEB 戦闘詳細は、テーブルごとに複数回の探索が発生しやすく、同一出撃内データの重複デコードが起きる。
- 出撃単位の識別は env_uuid であり、まず出撃単位で一括取得してから戦闘行を確定するのが自然である。
- 既存実装では battle_index の扱いが曖昧で、選択規則が統一されていない。

## 事実確認 (UUID 生成方式の調査結果)
### 1. env_uuid
- PortTable 生成時に 1 回だけ作成され、同一出撃データへ伝播される。
- 根拠: kc_api/crates/kc-api-database/src/table.rs

### 2. battle.uuid
- Cells::new_ret_option 内で new_battle を 1 回生成し、同一 cells 入力内の全 battle 行へ同じ uuid を付与している。
- 根拠: kc_api/crates/kc-api-database/src/models/cell.rs
- したがって battle.uuid は battle 行の一意キーではない。

### 3. battle.index
- Battle::new_ret_option の index 引数がそのまま battle.index に保存される。
- 根拠: kc_api/crates/kc-api-database/src/models/battle.rs
- 同一出撃内の battle 行識別は battle.index を正とする。

### 4. 詳細テーブル側の uuid
- hougeki_list/hougeki、opening_taisen_list/opening_taisen 等は battle 行から参照される別 uuid を持つ。
- 根拠: kc_api/crates/kc-api-database/src/models/battle.rs
- つまり、出撃の取得キーは env_uuid、戦闘行の識別キーは battle.index、詳細本体の参照キーは battle 行の参照列、という三層構造である。

## 問題定義
- 現在の /detail は取得経路が混在し、同一出撃データへの再探索が多い。
- battle.uuid を戦闘行識別に使うと一意性が崩れる。
- battle_index が任意扱いだと、決定規則が不安定になる。

## 必須要件 (Hard Rules)
1. 解決はサーバー側で完結する。クライアントに UUID 解決を持たせない。
2. 取得は env_uuid 一括取得を主軸にする。
3. 戦闘行識別は battle_index のみを使用する。
4. battle_index は必須パラメータとする。
5. battle.uuid は戦闘行識別に使用しない。
6. battle_index 欠落または不正時は HTTP 400。
7. env_uuid 内で battle_index 一致が無い場合は HTTP 404。

## Goals
- 同一テーブルの重複探索を削減する。
- 戦闘詳細の選択を決定的にする。
- 既存 UI が必要とする出力形を維持する。
- 変更範囲を FUSOU-WEB 戦闘詳細ルートに集中させる。

## Non-Goals
- マスターデータ保管方式の再設計。
- 戦闘詳細以外の画面刷新。
- 収集パイプラインの意味論変更。

## 識別ポリシー
- 出撃識別: env_uuid
- 戦闘行識別: battle_index
- 参照解決: battle 行の参照列 (hougeki, opening_taisen など)

## API 仕様 (新)
### エンドポイント
- /api/battle-data/detail

### 必須クエリ
- env_uuid
- battle_index

### 任意クエリ
- period_tag
- table_version

### エラー
- env_uuid または battle_index 欠落: 400
- battle_index が数値でない: 400
- 該当 battle_index が env_uuid 内に存在しない: 404

## 解決アルゴリズム
1. 入力検証
- env_uuid 非空チェック。
- battle_index を 0 以上整数として検証。
- period_tag/table_version 正規化。

2. 出撃バンドル一括取得
- env_uuid で必要テーブルを並列取得。
- 同一テーブルは 1 リクエスト内で 1 回のみ取得。

3. メモリ内インデックス作成
- byUuid[table][uuid] -> rows[]
- byIndex[table][index] -> rows[]
- byEnv[table] -> rows[]

4. 戦闘アンカー確定
- battle テーブルから battle.index = battle_index を厳密一致で 1 件取得。
- 複数件ヒット時は timestamp 昇順で最初を採用し、異常ログを必ず残す。

5. フェーズ解決順序
- 優先 A: battle 行の参照列で直接解決。
- 優先 B: list -> detail 参照を解決。
- 優先 C: 参照欠落時のみ同一 env_uuid 内で index 一致補完。
- 優先 D: なお欠落なら null とし、推測補完しない。

6. 艦隊解決
- 味方: deck 参照から own_deck -> own_ship -> own_slotitem を解決。
- 敵: e_deck_id から enemy_deck -> enemy_ship -> enemy_slotitem を解決。
- フォールバックは同一 env_uuid のみ許可。

7. 出力正規化
- battle, linked, refs, derived を組み立てる。
- support 系、friendly_force 系、night_support 系は表示側が追加解決不要な形で返す。

8. 観測性
- 取得テーブル数、補完発生数、未解決項目数、index 重複件数を構造化ログへ出力。

## 実装方針
1. battle_data ルートに sortie バンドルローダを追加
- fetchSortieBundleByEnvUuid を新設。

2. /detail を全面置換
- 既存の段階的再取得を廃止。
- 一括取得済みバンドルからのみ解決する。

3. battle_index 必須化
- バリデーション、エラーコード、メッセージを統一。

4. UI 呼び出し契約の固定
- 詳細遷移時は必ず env_uuid と battle_index を渡す。
- どちらか欠落時は遷移させず明示エラーを出す。

5. フォールバック境界の固定
- 同一 env_uuid 以外の探索は禁止。

## 検証計画
1. 静的検証
- pnpm run astro check

2. 機能検証
- 正常系: env_uuid + battle_index で決定的に同一結果を返す。
- 異常系: battle_index 欠落 400、型不正 400、未存在 404。

3. 整合検証
- 旧実装と新実装で同一入力比較:
  - phase 件数
  - 与被ダメ集計
  - support/friendly/night_support 表示有無

4. 性能検証
- リクエストあたりのテーブル探索回数
- デコード時間
- レイテンシ
- 旧実装比の改善率

## ロールアウト
1. フラグ導入
- USE_SORTIE_BUNDLE_DETAIL_RESOLVER で切替可能にする。

2. 段階適用
- まず比較ログを収集し、差分が許容内であることを確認後に既定有効化。

3. 旧経路撤去
- 安定後に旧ロジックを削除。

## ロールバック
- フラグ OFF で旧経路へ即時切戻し。

## リスクと対策
1. 同一 env_uuid 内の index 重複
- 対策: 決定規則を固定し警告ログを必ず出す。

2. 参照欠落を過補完するリスク
- 対策: 同一 env_uuid かつ index 一致以外では補完しない。

3. UI 側が battle_index を渡せないケース
- 対策: 一覧 API/遷移時 state を先に整備し、欠落時は遷移拒否。

## 実装タスクチェックリスト
- [ ] sortie バンドルローダ追加
- [ ] メモリ内 index マップ追加
- [ ] /detail の一括解決化
- [ ] battle_index 必須化
- [ ] UI 遷移契約の env_uuid + battle_index 必須化
- [ ] 観測ログ追加
- [ ] astro check 実行
- [ ] サンプル出撃で旧新比較
- [ ] 性能改善値の記録
