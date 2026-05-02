# 任務ツリー推論 実装計画（単一条件 + 複合条件対応）

## 1. 目的

任務関連通信を収集し、次を追跡可能にする。

- 任務の開始/停止/完了
- 完了後の新規出現任務
- 単一前提（A -> C）と複合前提（A+B -> C）の両方
- 信頼度付き推論グラフ

本書は APP / WEB の責務、推論アルゴリズム、実装順序を統合した実装版である。

---

## 2. コンポーネント責務

### 2.1 FUSOU-APP（collector）

- `questlist`, `start`, `stop`, `clearitemget` を抽出
- `request_id`, `payload_hash` を生成
- 同一 ID + 同一値の送信スキップ
- 必要時のみ WEB ingest API へ送信

### 2.2 FUSOU-WEB（ingest/inference/query）

- ingest API で認証・バリデーション・冪等判定
- 正規化 delta 保存（snapshot/state/appearance）
- 状態再構築と推論入力セット生成
- 単一前提・複合前提の推論ジョブ実行
- edges/changes/graph API を提供

### 2.4 ワーカー配置方針（現時点）

- 当面は FUSOU-WEB 単一ワーカーで ingest と inference を統一運用する
- 実行分離は「同期経路」と「非同期タスク」で行い、プロセス分離は後続判断とする
- 将来、遅延・失敗率・タスク滞留が閾値超過した場合に inference を別ワーカーへ分離する

### 2.3 Storage

- R2: 差分イベント圧縮アーカイブ（raw payload は保存しない）
- D1: 推論・表示用の正規化テーブル
- KV/Cache（任意）: query キャッシュ

---

## 3. データソース

- `api_get_member/questlist`
- `api_req_quest/start`
- `api_req_quest/stop`
- `api_req_quest/clearitemget`

### 3.1 限定/通常分類の扱い（確定）

`start/stop/clearitemget` は `api_quest_id` 以外の分類キーを持たないため、
限定/通常は推定確定しない。

- `questlist` の `api_type` / `api_category` / `api_label_type` は hint 保存
- class は `normal|limited|unknown` とし、当面 `unknown` を正規値
- master 対応表導入まで確定判定は無効

---

## 4. 実行タイミングと送信抑止

### 4.1 APP 側トリガ

- 上記 4 endpoint の受信時のみ

### 4.2 APP 側送信前スキップ規則（必須）

比較キー:

- `dataset_id + endpoint + logical_id + payload_hash`

規則:

- 同一キーなら送信しない
- `period_tag` または `table_version` 更新時はローカルキャッシュを全クリアし、再送可

`logical_id`:

- questlist: `dataset_id + page_no`
- start/stop/clear: `dataset_id + quest_id + event_type`

---

## 5. E2E フロー（同期 ingest + 非同期 inference）

1. APP が payload を受信
2. APP が重複判定（同値なら送信スキップ）
3. WEB ingest API 受信
4. WEB が request 検証と冪等判定
5. WEB が payload を正規化し、必要フィールドのみ抽出
6. WEB が D1 transaction で ingest_event 保存
7. endpoint 別保存
  - questlist: `questlist_snapshots` 保存 -> 差分計算 -> `quest_appearance_events`
  - start/stop/clear: `quest_state_events`
8. WEB が `quest_inference_tasks` に dataset 単位タスクを enqueue
9. 非同期 worker が状態再構築 -> 前提集合生成 -> 推論テーブル更新
10. query キャッシュ無効化

### 5.2 初期状態不明（cold start）時の扱い

収集開始直後は「過去状態が不明」なため、以下のルールで動かす。

- dataset ごとに `bootstrap_phase` を持ち、最初の完全 questlist 観測まで推論を保留
- 最初の完全 questlist を `bootstrap_snapshot` として保存し、ここを時系列の起点とする
- 起点以前の因果（何を達成して現れたか）は不明として扱い、推論入力に入れない
- 起点後に発生した `complete -> appearance` のみ推論対象にする

これにより初期欠損を「誤った前提推定」に使わない。

### 5.3 収集中断・再開（別ツール移行含む）時の扱い

収集が停止し、再開までに空白期間がある場合は時系列を分割して扱う。

- `collection_session_id` を導入し、連続収集区間を明示する
- 空白時間が `gap_threshold_ms`（推奨: 30 分）を超えたら新 session を開始
- 推論は原則 session 内因果で集計し、session を跨ぐ推定は `low_confidence` 扱い
- 再開直後は 1 回以上 questlist を取得してから推論を再開する
- 別ツールを使っていた期間がある場合、その区間は `data_gap=true` として監査ログに残す

これにより「未観測期間の進捗」を誤因果として結び付けない。

### 5.1 正規化ルール（raw 廃止）

保存前に次の変換を必須とする。

- 不要フィールド除外: 解析に不要な全文 payload を破棄
- 型正規化: quest_id, page_no, timestamp を固定型に変換
- ID 安定化: request_id と event_id を分離
- ハッシュ化: 比較用 `payload_hash` は保持するが payload 本体は保持しない

R2 保存対象（最小）:

- `event_id`
- `dataset_id`
- `endpoint`
- `quest_id`（存在時）
- `event_type`
- `timestamp_ms`
- `period_tag`
- `table_version`
- `payload_hash`

---

## 6. 推論モデル（単一 + 複合）

### 6.1 用語

- target quest: 出現側任務（C）
- prerequisite set: 前提候補集合（P）
- occurrence: C が `hidden -> visible` へ遷移した1事例

### 6.2 事例生成

各 C 出現時点について、同一 dataset の直前状態から次を作る。

- `completed_set`: 出現直前に claimed だった quest 集合
- `recent_completed_set`: window（例 10 分）以内に complete した quest 集合
- `period_tag`, `table_version`

`completed_set` を主集合、`recent_completed_set` を補助特徴として保存する。

### 6.3 候補生成（過学習抑制）

候補集合サイズは段階導入で制限する。

- v1: サイズ1（単一）
- v2: サイズ2（複合 AND）
- v3: 必要時のみサイズ3

サイズ2候補は、同一事例内で同時に出現した上位頻度 quest の組み合わせのみ対象。

### 6.4 統計量

target=C, candidate=P に対し以下を保持する。

- support: `count(P and C)`
- exposure: `count(P observed)`
- confidence: `support / exposure`
- lift: `confidence / base_rate(C)`
- penalty_ambiguity: 同時 complete 数が多い事例ほど減点

### 6.5 スコア（採用判定）

最終スコアを次で定義する。

`score = confidence_shrunk * lift * freshness_weight * ambiguity_weight`

`confidence_shrunk` は小標本過大評価回避のためベイズ平滑化を使う。

`confidence_shrunk = (support + alpha) / (exposure + alpha + beta)`

推奨初期値: `alpha=1`, `beta=3`

### 6.6 単一 vs 複合の採択

同一 target C で単一候補 A と複合候補 A+B が競合する場合:

- `score(A+B -> C)` が `score(A -> C)` と `score(B -> C)` を共に閾値以上で上回る
- かつ `support(A+B -> C) >= min_obs_pair`

を満たすとき、複合候補を primary に採択する。

推奨初期閾値:

- `min_obs_single=8`
- `min_obs_pair=6`
- `min_conf_single=0.55`
- `min_conf_pair=0.65`

### 6.7 出力カテゴリ

- `accepted_primary`: 主前提（UI 表示対象）
- `accepted_secondary`: 補助前提（UI 省略可）
- `candidate_hold`: 観測不足で保留
- `rejected`: 閾値未達

---

## 7. キャッシュ戦略

### 7.1 APP ローカル

- `RECENT_REQUEST_IDS`（LRU, 10k, TTL 10 分）
- `LAST_QUESTLIST_HASH_BY_DATASET`（TTL 5 分）

### 7.2 WEB query

- `GET /api/quest-tree/edges`
  - key: `quest:edges:{target}:{period_tag}:{version}:{min_score}`
  - TTL: 60 秒
- `GET /api/quest-tree/rules`
  - key: `quest:rules:{target}:{period_tag}:{version}`
  - TTL: 60 秒
- `GET /api/quest-tree/graph`
  - key: `quest:graph:{dataset_id}:{period_tag}:{version}`
  - TTL: 60 秒

無効化:

- ingest 成功時
- inference task 完了時

---

## 8. 保存モデル

### 8.1 R2

`quest_tree_delta/{table_version}/{period_tag}/{yyyyMMdd}/{dataset_id}/{endpoint}/{hh}/events-{chunk_id}.ndjson.gz`

raw ではなく正規化 delta のみ保存する。

### 8.2 D1（ingest 基盤）

- `quest_ingest_events`
- `questlist_snapshots`
- `quest_state_events`
- `quest_appearance_events`
- `quest_state_latest`
- `quest_collection_sessions`
  - `collection_session_id`, `dataset_id`, `started_at_ms`, `ended_at_ms`, `start_reason`, `has_data_gap`

### 8.3 D1（推論基盤）

- `quest_inference_tasks`
  - `task_id`, `dataset_id`, `from_ts`, `to_ts`, `status`, `retry_count`
- `quest_occurrence_contexts`
  - `occurrence_id`, `dataset_id`, `collection_session_id`, `target_quest_id`, `occurred_at_ms`, `period_tag`, `is_bootstrap_unknown`
- `quest_occurrence_prerequisites`
  - `occurrence_id`, `quest_id`, `is_recent`, `is_completed`
- `quest_rule_candidates`
  - `target_quest_id`, `prereq_set_hash`, `prereq_set_json`, `set_size`, `support`, `exposure`, `confidence`, `lift`, `score`, `period_tag`
- `quest_rule_edges`
  - `rule_id`, `target_quest_id`, `prereq_set_json`, `set_size`, `class`, `support`, `confidence`, `lift`, `score`, `period_tag`, `is_primary`

### 8.5 欠損耐性フラグ

推論結果に次を付与する。

- `has_bootstrap_unknown`: 初期状態不明データを含む可能性
- `has_cross_session_inference`: session 跨ぎで算出された可能性
- `quality_tier`: `high|medium|low`

`quality_tier=low` は UI 既定で非表示にし、API オプションでのみ返す。

### 8.4 D1 状態遷移モデル（quest_id 単位）

状態:

- `hidden`
- `visible_inactive`
- `active`
- `completed_unclaimed`
- `claimed`
- `expired_or_reset`

確定ソース:

- `start` -> `active`
- `stop` -> `visible_inactive`
- `clearitemget` -> `claimed`
- `questlist` 差分 -> `hidden/visible/completed` 補正

---

## 9. 実装手順（この順序で実施）

### Phase 0: スキーマ準備

1. D1 migration で 8.2/8.3 の新規テーブル作成
2. 必須 index 作成
  - `quest_appearance_events(dataset_id, appeared_at_ms)`
  - `quest_occurrence_contexts(target_quest_id, period_tag)`
  - `quest_rule_candidates(target_quest_id, set_size, period_tag)`
  - `quest_collection_sessions(dataset_id, started_at_ms)`

### Phase 1: ingest 安定化

1. 既存 ingest から `quest_inference_tasks` enqueue
2. 同一 dataset の短時間重複タスクを merge
3. `gap_threshold_ms` 超過時に `quest_collection_sessions` をローテーション
4. 再開直後は bootstrap 完了まで推論タスクを `pending_bootstrap` にする

### Phase 2: occurrence 生成 worker

1. タスク区間の appearance を走査
2. 出現時点ごとに prerequisite 集合を生成
3. `quest_occurrence_contexts` / `quest_occurrence_prerequisites` 保存
4. bootstrap 未確定区間・session 跨ぎ区間には品質フラグを設定

### Phase 3: ルール集計 worker

1. set_size=1 を集計して `quest_rule_candidates` 更新
2. set_size=2 を集計して `quest_rule_candidates` 更新
3. スコア計算後に `quest_rule_edges` upsert

### Phase 4: primary 決定 worker

1. target ごとに候補を score 降順で取得
2. 複合候補が優位条件を満たせば primary 採択
3. 単一候補は secondary 降格または reject

### Phase 5: API 提供

1. `GET /api/quest-tree/rules?target=...`
2. `GET /api/quest-tree/graph?dataset_id=...`
3. `GET /api/quest-tree/changes?since=...`

### Phase 6: 運用と再計算

1. 日次 incremental 推論
2. 週次 full recompute（period 単位）
3. `period_tag` 更新時は旧 period と混ぜず新規集計

---

## 10. 省容量運用

- raw payload を保存しない（常時）
- questlist は差分のみ長期保持
- R2 は ndjson.gz 日次ローテーション
- `quest_occurrence_prerequisites` は 90 日で圧縮要約
- `quest_rule_edges` は無期限（履歴列を別管理）

---

## 11. 障害運用

- D1 transaction 失敗時は ingest 全体失敗（部分成功禁止）
- D1 成功 + R2 失敗は `archive_pending` で再試行
- inference worker 失敗は `quest_inference_tasks.status=failed` とし指数バックオフ再実行
- 連続失敗閾値超過で admin 再計算ジョブを発火
- 長時間 gap 後の再開では自動的に bootstrap 再判定を行う

監視:

- ingest p95
- task backlog 件数
- inference 成功率
- primary ルール変動率
- archive_pending 件数

---

## 12. 受け入れ基準

1. 同一 ID + 同一値の送信が APP 側で抑止される
2. `period_tag` / `table_version` 更新時に再送される
3. 単一前提と複合前提の両方が保存される
4. 複合候補が優位な場合に primary として採択される
5. query キャッシュ無効化が正しく動作する
6. raw payload を保存せずに再構築できる
7. D1/R2 不整合を補修できる
8. 初期状態不明期間が推論に混入しても `quality_tier` で識別できる
9. 収集中断・再開時に session 分割され、誤った跨ぎ因果を primary に採用しない