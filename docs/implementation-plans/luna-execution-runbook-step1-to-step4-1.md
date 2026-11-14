# LUNA / SOL 実装エージェント向け 完全実装仕様書・テスト手順書（Step 1.1 〜 Step 4.1）

作成日: 2026-11-12  
関連計画書: `docs/implementation-plans/fusou-comprehensive-audit-and-quest-d1-optimization-plan-2026-11-12.md`

> **実装エージェント（LUNA / SOL）への絶対ルール**:
> 1. 各 Step を順番に実装し、**各 Step の末尾に記載されたテスト・検証コマンドを必ず実行して PASS することを確認してから**次の Step に進むこと。
> 2. 既存の型定義やテストを壊さないこと。新規ロジックには必ず単体テストを追加すること。
> 3. ファイル編集時は指定された行番号付近をまず `read_file` で確認してから `edit_file` を適用すること。

---

## Phase 1: Quest ワークフロー D1 パンク根絶 & データ消失/破損バグの緊急修正

### Step 1.1: Quest ワークフロー D1 読み書き爆発の根絶

#### 1.1.1 D1 マイグレーションの追加
* **新規作成**: `packages/FUSOU-WEB/migrations/quest-index/0008_optimize_quest_inference_indexes.sql`
* **内容**:
```sql
-- ============================================================================
-- Migration: Optimize quest-tree inference indexes to eliminate full table scans
-- Date: 2026-11-12
-- ============================================================================

-- getExposureForPrereq / 一括集計で quest_id から occurrence_id を高速逆引きする複合インデックス
CREATE INDEX IF NOT EXISTS idx_qopr_quest_completed_occ
  ON quest_occurrence_prerequisites(quest_id, is_completed, occurrence_id);

-- period_tag + table_version で有効な occurrence を絞り込むカバリングインデックス
CREATE INDEX IF NOT EXISTS idx_qocc_period_ver_boot_occ
  ON quest_occurrence_contexts(period_tag, table_version, is_bootstrap_unknown, occurrence_id);

-- 同一 dataset_id + period_tag で同じ target_quest_id が重複して出現登録されるのを防ぐユニークインデックス
CREATE UNIQUE INDEX IF NOT EXISTS idx_qappear_dataset_target_period_unique
  ON quest_appearance_events(dataset_id, target_quest_id, period_tag, table_version);
```

#### 1.1.2 `kc_api` と `FUSOU-APP` における `api_tab_id=0`（全任務）と `api_tab_id=1`（デイリー）の混同修正
* **対象1**: `packages/kc_api/crates/kc-api-database/src/models/quest.rs` (62行目付近)
  * **現状**: `page_no: if snapshot.page_no <= 0 { 1 } else { snapshot.page_no },`
  * **問題**: `api_tab_id = 0`（全任務タブ）が `1` に変換され、`api_tab_id = 1`（デイリータブ）と衝突する。
  * **修正**: `page_no: snapshot.page_no.max(0),` に変更（`0` = 全任務タブとして保持する）。
* **対象2**: `packages/FUSOU-WEB/src/server/schemas/quest-tree.ts`
  * `page_no` のバリデーションが `.int().positive()`（`>= 1`）になっている箇所を確認し、`0`（`api_tab_id = 0`）を許容するよう `.int().min(0)`（または `.nonnegative()`）に変更する。
* **対象3**: `packages/FUSOU-WEB/src/server/routes/quest_tree.ts`
  * `toInt(body.page_no) ?? 1`（323行目、677行目、762行目付近）で `0` が falsy 扱いされないため `?? 0` に統一する。

#### 1.1.3 `FUSOU-WEB` Ingest 処理の最適化（偽出現防止・タスクデバウンス・不要プリウォーム撤廃）
* **対象**: `packages/FUSOU-WEB/src/server/routes/quest_tree.ts`
* **修正内容**:
  1. **全任務タブ（`pageNo === 0` または旧クライアント互換でクエスト数が多い場合）でのみ新規出現判定・Bootstrap完了判定を実施（700〜816行目）**:
     * 部分タブ（`pageNo > 0`：デイリー `1`、ウィークリー `2`、遂行中 `9` 等）のスナップショットでは `upsertQuestMasterEntries` のみ（またはスキップ）とし、`questlist_snapshots` の比較による `setDiff`（新規出現判定）や `markBootstrapCompleted` は **`pageNo <= 1`**（特に全任務タブ）かつ前回も同じ `page_no` のスナップショットと比較するように修正する。
     * より確実にするため、`previousSnapshots` から `previousGlobalVisible` を構築する際、別タブの部分リストで全リストが上書きされて縮退しないよう、**そのセッション内で観測されたすべての `visible_quest_ids_json` の和集合（Union）**、または直近10件のスナップショットの和集合を `previousGlobalVisible` とする（`SELECT page_no, visible_quest_ids_json FROM questlist_snapshots WHERE dataset_id = ? AND collection_session_id = ? ORDER BY captured_at_ms DESC LIMIT 20` に `LIMIT 20` を追加）。
     * `questlist_snapshots` への INSERT 時、`snapshot_json` には巨大な全文 JSON ではなく `'[]'` を入れて D1 ストレージと書き込み量を節約する。
  2. **推論タスク (`enqueueTask`) の起票条件とデバウンス（341〜345行目、615〜647行目）**:
     * `processIngestEvents` の戻り値を `{ bootstrapNowCompleted: boolean; appearedCount: number }` に変更する。
     * `shouldEnqueueTask` を `const shouldEnqueueTask = appearedCount > 0;` に変更する（`start` / `stop` / `complete` 単体や、新規出現が0件の `snapshot` では推論タスクを起票しない）。
     * `enqueueTask` 内で、すでに同一 `dataset_id` かつ `collection_session_id` で `status = 'pending'` のタスクが存在する場合は新規 INSERT せず、既存タスクの `to_ts = MAX(to_ts, ?), updated_at = ?` を UPDATE して1つのタスクにマージする：
       ```ts
       const existingTask = await db
         .prepare(
           `SELECT task_id, from_ts FROM quest_inference_tasks
            WHERE dataset_id = ? AND collection_session_id = ? AND status = 'pending'
            ORDER BY created_at DESC LIMIT 1`
         )
         .bind(datasetId, sessionId)
         .first<{ task_id: string; from_ts: number }>();
       if (existingTask?.task_id) {
         await db
           .prepare(
             `UPDATE quest_inference_tasks
              SET to_ts = MAX(to_ts, ?), updated_at = ?
              WHERE task_id = ?`
           )
           .bind(atMs + 1, atMs, existingTask.task_id)
           .run();
         return existingTask.task_id;
       }
       ```
  3. **Ingest 時の不要な `/graph` プリウォーム削除と `probeWhenFresh: false` 化（1144〜1173行目、1200行目、1332行目）**:
     * 1144〜1173行目の Ingest 直後のキャッシュ無効化＆`app.request("/graph?...")` 呼び出しを削除する（Ingest 時点ではまだ非同期推論タスクは実行されておらず `quest_rule_edges` は変化していないため、ここでの無効化と全件 SELECT は100%無駄な D1 Read を生んでいる）。
     * 1200行目（`/rules`）および 1332行目（`/graph`）の `probeWhenFresh: true` を `probeWhenFresh: false` に変更する（KV キャッシュの TTL 内で毎回 D1 に SELECT を投げるのを防ぐ）。

#### 1.1.4 `FUSOU-WORKFLOW` 推論処理 (`quest_tree_inference.ts`) の抜本的高速化（N+1 と 5,000回ループの撤廃）
* **対象**: `packages/FUSOU-WORKFLOW/src/quest_tree_inference.ts`
* **修正内容**:
  1. **前提候補の保存数上限と絞り込み（`processTask` 470〜527行目）**:
     * `getCompletedAndRecentSets` で取得した完了任務のうち、`quest_occurrence_prerequisites` に保存する対象を「直近完了任務（`sets.recent`）」または「同セッション内で完了した任務（直近最大20件）」に限定する（数ヶ月前に完了した100件以上の過去任務すべてを毎回 INSERT しない）。
  2. **`recomputeRulesForTarget` の N+1 クエリと `getExposureForPrereq` ループの完全撤廃（186〜448行目）**:
     * **変更前**:
       * `for (const { occurrence_id } of occurrences)` で $O$ 回個別 SELECT。
       * 単一候補＋ペア候補すべて（最大5,050回）に対してループ内で `await getExposureForPrereq(...)` を直列実行。
     * **変更後**:
       1. 対象 `targetQuestId` のすべての `(occurrence_id, quest_id, is_recent)` を **1回の JOIN クエリ** で取得する：
          ```sql
          SELECT o.occurrence_id, p.quest_id, p.is_recent
          FROM quest_occurrence_contexts o
          LEFT JOIN quest_occurrence_prerequisites p
            ON p.occurrence_id = o.occurrence_id AND p.is_completed = 1
          WHERE o.target_quest_id = ?
            AND o.period_tag = ?
            AND o.table_version = ?
            AND o.is_bootstrap_unknown = 0
          ORDER BY o.occurrence_id, p.quest_id ASC
          ```
       2. メモリ上で `occurrence_id` ごとの `quest_id` リストを集計し、`singleCount` と `pairCount` を計算する。このとき、**ペア候補 `combinationsOfTwo` に含めるクエストは、単一出現回数（または recent カウント）が上位15個以内のクエスト同士のみ**に制限する（これによりペア候補数は最大でも $\binom{15}{2} = 105$ 個以下に抑えられる）。
       3. さらに `support < 2` のペア候補は Exposure 計算前に足切りする（ただし観測数が少ない初期段階のために単一候補の上位10件は残す）。
       4. 残ったユニークな候補クエスト ID 集合 `candidateQuestIds` に対して、**たった1回の SQL クエリ** で「どの `occurrence_id` でどの候補 `quest_id` が完了していたか」を取得し、メモリ上で単一 Exposure とペア Exposure の両方を計算する：
          ```sql
          SELECT p.quest_id, p.occurrence_id
          FROM quest_occurrence_prerequisites p
          JOIN quest_occurrence_contexts o ON o.occurrence_id = p.occurrence_id
          WHERE o.period_tag = ?
            AND o.table_version = ?
            AND o.is_bootstrap_unknown = 0
            AND p.is_completed = 1
            AND p.quest_id IN (${placeholders})
          ```
          * メモリ上で `questId -> Set<occurrence_id>` の Map（`occSetByQuest`）を作れば：
            * 単一候補 `[q1]` の Exposure は `Math.max(1, occSetByQuest.get(q1)?.size ?? 0)`
            * ペア候補 `[q1, q2]` の Exposure は `occSetByQuest.get(q1)` と `occSetByQuest.get(q2)` の積集合（Intersection）のサイズ `Math.max(1, intersectionSize(set1, set2))`
            として **DBクエリ0回・マイクロ秒単位** で厳密に求まる！（`getExposureForPrereq` 関数自体が不要になり、5,050回のD1クエリが **1回のクエリ** に削減される）。
       5. `quest_rule_candidates` および `quest_rule_edges` に保存する候補を、スコア上位 30 件（または `support >= 2`）のみに絞り込み、100文ずつチャンク分割して `db.batch()` を実行する。
  3. **`runQuestInferenceTasks` におけるバッチ単位での `touchedTargets` 集約（529〜622行目）**:
     * `processTask(db, task)` は `recomputeRulesForTarget` を直接呼ばず、`Promise<Set<string>>`（触られた `${targetQuestId}:${periodTag}:${tableVersion}` の Set）を返すように変更する。
     * `runQuestInferenceTasks` の `for (const task of tasks)` ループ内で全タスクの `touchedTargets` を1つの `allTouchedTargets = new Set<string>()` にマージし、**全タスクの `occurrence` 更新が終わった後に、ユニークなターゲットごとに1回だけ `recomputeRulesForTarget` を実行**する。

#### Step 1.1 のテスト・検証手順
* `packages/FUSOU-WEB/src/server/routes/__tests__/quest-tree-session.test.ts` および `quest-tree-public-changes.test.ts` を実行：
  ```powershell
  pnpm --filter fusou-web test src/server/routes/__tests__/quest-tree
  ```
* `packages/FUSOU-WORKFLOW` に `quest_tree_inference` の単体テスト（モックD1を使ってクエリ発行回数がターゲットあたり10回未満であることをアサートするテスト）を追加・実行：
  ```powershell
  pnpm --filter fusou-workflow test
  ```

---

### Step 1.2: データ消失・破損・重大パフォーマンスバグの修正

#### 1.2.1 [R-01] `fusou-storage` クラウド統合時の未ダウンロードファイル削除バグ修正
* **対象**: `packages/fusou-storage/src/providers/cloud_table_provider.rs` (529〜574行目)
* **修正**:
  * 529〜542行目のダウンロードループで、成功したファイルのみを `let mut downloaded_files = Vec::new();` に `push(file)` する。
  * もし `downloaded_files.len() != remote_files.len()` の場合（1件でもダウンロード失敗があった場合）、部分的な統合で順序やデータが欠損するのを防ぐため、`return Err(...)` で統合を中断し、リモートファイルの削除を行わない（あるいは `downloaded_files` のみを統合・削除対象にする）。

#### 1.2.2 [R-02] `FUSOU-APP` 母港帰投時の出撃データ消失競合の修正
* **対象**: `packages/FUSOU-APP/src-tauri/src/storage/submit_data.rs` (65〜144行目)
* **修正**:
  * 67行目で `let cells = Cells::load();` した直後（`if cells.cells.is_empty() { return; }` の直後、非同期 `tauri::async_runtime::spawn` の**前**）に同期的に `Cells::reset();` を呼び出す。
  * 非同期タスク内の 135行目にある `Cells::reset();` を削除する。これにより、通信中に次の出撃を開始しても新しい出撃データが消去されず、また `get_period_tag()` 失敗時にも古い出撃データが残留しない。

#### 1.2.3 [R-03] `kc-api-database` Avro デコード時の破損ブロック切り捨て防止
* **対象**: `packages/kc_api/crates/kc-api-database/src/decode.rs` (10〜18行目)
* **修正**:
  * `while let Some(Ok(record)) = reader.next()` を以下に書き換える：
    ```rust
    for record_res in reader {
        let record = record_res.map_err(|e| format!("Avro block decode error: {e}"))?;
        let item = from_value::<T>(&record).map_err(|e| e.to_string())?;
        result.push(item);
    }
    ```

#### 1.2.4 [W-01] `FUSOU-WEB` 戦闘詳細スナップショットの `hasFriendly` 棄却バグ修正
* **対象**: `packages/FUSOU-WEB/src/server/routes/battle_data.ts` (3966〜3968行目)
* **修正**:
  * 3966行目:
    ```ts
    // 修正前:
    const hasFriendly = Array.isArray(directParsed?.derived?.friendly_fleet) && directParsed.derived.friendly_fleet.length > 0;
    // 修正後（友軍艦隊が来ない通常戦闘では friendly_fleet は空配列 [] なので Array.isArray のみチェック）:
    const hasFriendly = Array.isArray(directParsed?.derived?.friendly_fleet);
    ```

#### 1.2.5 [W-02 & W-07] `ship_growth.ts` と `remodel_data.ts` のキャッシュ条件反転および旧期間データによる全削除防止
* **対象1**: `packages/FUSOU-WEB/src/server/routes/ship_growth.ts` (2457, 2574, 2780, 3208, 3560行目)
  * `if (cache && !c.env.SHIP_GROWTH_ARCHIVE_BUCKET)` をすべて `if (cache)` に修正する。
* **対象2**: `packages/FUSOU-WEB/src/server/routes/remodel_data.ts` (132〜196行目) & `ship_growth.ts` (1447〜1484行目)
  * クライアントから送信された `period_tag` が、D1内に既に存在する最新の `period_tag` よりも古い場合（辞書順または Supabase の最新 `period_tag` 以外の場合）に `DELETE FROM ... WHERE period_tag <> ?` を実行しないようガードを追加する。

#### 1.2.6 [W-05 & W-06 & W-08] `asset-index-cache.ts` の $O(N \cdot P)$ 解消、Turso ロック更新、`snapshot_generator.ts` ループ修正
* **対象1**: `packages/FUSOU-WEB/src/server/utils/asset-index-cache.ts` (456〜505行目 `buildPages`)
  * 1要素ごとに `estimatePageByteLength([...current, item])` でページ全体を `JSON.stringify` するのをやめ、各 `item` のバイト長 `const itemBytes = JSON_ENCODER.encode(JSON.stringify(item)).byteLength + 1;` を加算して累積バイト数を追跡する $O(N)$ 実装に変更する。
* **対象2**: `packages/FUSOU-WORKFLOW/src/db/compaction-state.ts` (21〜26行目 `acquireLock`)
  * `UPDATE compaction_state SET status = 'running', last_started_at = ?, updated_at = ? WHERE id = 1 ...` として `last_started_at` も同時に `now` で更新する。
* **対象3**: `packages/FUSOU-WORKFLOW/src/snapshot_generator.ts` (318〜325行目)
  * 324行目の `sortie.tables[table] = [...byKey.values()];` を内側の `for (const record of ...)` ループの外側（325行目の直後）に移動する。

#### Step 1.2 のテスト・検証手順
```powershell
pnpm --filter fusou-web test
pnpm --filter fusou-workflow test
cargo check --workspace
cargo test -p fusou-storage
```

---

## Phase 2: セキュリティ強化 & Python ライブラリ (`fusou-datasets`) のバグ修正

### Step 2.1: セキュリティ問題の修正

1. **[W-03] `FUSOU-WORKFLOW` の `GET /read` エンドポイント認証追加とキャッシュヘッダ修正**:
   * **対象**: `packages/FUSOU-WORKFLOW/src/index.ts` (285〜287行目) & `packages/FUSOU-WORKFLOW/src/reader.ts` (612〜615行目)
   * **修正**:
     * `/read` に対して `env.UPLOAD_INGEST_TOKEN` による Bearer トークン認証（`timingSafeEqual`）を必須化する。
     * `reader.ts:612` で `hotRecords.length > 0` の場合は `Cache-Control: private, no-store` を返し、`hotRecords.length === 0 && coldRecords.length > 0` の場合のみキャッシュを許可する。
2. **[W-04] `FUSOU-WEB` の `/api/data-loader/download` クォータ・共有チェック追加と `/verify` レート制限強化**:
   * **対象**: `packages/FUSOU-WEB/src/server/routes/data_loader.ts` (1020〜1266行目)
   * **修正**:
     * `/download` の `file_path` ブランチ（1161行目〜）でも、`ENABLE_GLOBAL_DATA_SHARING` の有効性確認、`archived_files` の `status = 'active'` 条件、`checkAndDeductRU` の呼び出し、および `dataset_access_log` への記録を実行する。
     * `checkRateLimit`（1230行目〜）のキーをクライアント自己申告の `X-CLIENT-ID` だけでなく認証済み `userId`（`verify:user:${userId}`）および IP アドレス基準に変更する。
3. **[W-10] `simulator/index.astro` と `fleets.astro` の HttpOnly トークン平文埋め込み廃止**:
   * **対象**: `packages/FUSOU-WEB/src/pages/simulator/index.astro` (149〜155行目), `packages/FUSOU-WEB/src/pages/simulator/fleets.astro` (122〜124行目), `packages/FUSOU-WEB/src/pages/api/auth/refresh_session.ts`
   * **修正**:
     * `window.__fusouAccessToken = accessToken` のインライン出力を削除し、クライアントからの API リクエストは同一オリジン Cookie（`credentials: "same-origin"`）で認証するように統一する。
     * `refresh_session.ts` に `validateOrigin` による CSRF チェックを追加する。
4. **[R-06 & R-07] `FUSOU-APP` 外部ウィンドウ `postMessage` 検証と `FUSOU-PROXY` パスサニタイズ**:
   * **対象1**: `packages/FUSOU-APP/src-tauri/capabilities/external-shortcuts.json` & `src/window/scripts/external_init_script.js`
     * `external-shortcuts.json` から非暗号化の `http://www.dmm.com/**` を削除し `https://play.games.dmm.com/**` 等に限定する。
     * `external_init_script.js` の `message` イベントリスナ（368行目、597行目）で `e.origin` が許可された DMM / 艦これオリジンであることを検証する。
   * **対象2**: `packages/FUSOU-PROXY/proxy-https/src/proxy_server_https.rs` (518〜545行目 `log_response`)
     * `path` から `std::path::Path::new(path).components()` で `Component::Normal` のみを結合し、`..` によるディレクトリトラバーサルを防止する。

---

### Step 2.2: Python ライブラリ (`fusou-datasets`) の致命的バグ修正とテスト追加

1. **[P-01] `Battle <-> Cells` の外部キー結合カラム修正**:
   * **対象**: `packages/fusou-datasets/python/fusou_datasets/relationships.py` (35行目)
   * **修正**:
     ```python
     # 修正前:
     graph.add(Tables.Battle.TABLE, Tables.Battle.CELL_ID, Tables.Cells.TABLE, Tables.Cells.BATTLES)
     # 修正後:
     graph.add(Tables.Battle.TABLE, Tables.Battle.UUID, Tables.Cells.TABLE, Tables.Cells.BATTLES)
     ```
2. **[P-02 & P-03] `query_engine.py` の `split` パラメータ伝搬とマスタキャッシュパス解決**:
   * **対象**: `packages/fusou-datasets/python/fusou_datasets/query_engine.py` (80〜124行目、223行目)
   * **修正**:
     * 223行目: `cached_file = _resolve_cached_file(cache_path, table, period_tag, table_version, split=split)` に `split=split` を追加。
     * `_resolve_cached_file` 内で `{cache_dir}/master/{ver}/{tag}/{table}.parquet`（および `ver = "latest"` / `tag = "latest"` のフォールバック）も探索候補に追加する。
3. **[P-03 続] `_master.py` の `TableMeta` 型安全性とキャッシュ活用**:
   * **対象**: `packages/fusou-datasets/python/fusou_datasets/_master.py` (126行目、144〜146行目、163行目)
   * **修正**:
     * 126行目・163行目で `table` に `TableMeta` クラスが渡された場合でも `str(getattr(table, "TABLE", table)).lower().strip()` で文字列化する。
     * `tag == "latest"` の場合でもキャッシュファイルの更新時刻が一定時間（例：24時間）以内であればローカルキャッシュを返すように改善。
4. **[P-04] Google Colab / Jupyter Notebook でのデバイス認証修正**:
   * **対象**: `packages/fusou-datasets/python/fusou_datasets/_client.py` (38〜53行目、157〜165行目)
   * **修正**:
     * 160行目の `if not sys.stdin.isatty():` を `if not (sys.stdin.isatty() or "ipykernel" in sys.modules or "google.colab" in sys.modules):` に変更し、Jupyter / Colab 上で `input()` プロンプトが使えるようにする。
     * `_client.py`, `_loader.py`, `query_engine.py` 内の文字化けした `?` / `??` プレフィックスを `[OK]` / `[INFO]` / `[WARN]` 等の環境非依存な ASCII タグに統一する。
5. **[P-05] `__init__.py` の `get_config` エクスポートと `schema.py` の `resolve_table_name` 修正**:
   * **対象1**: `packages/fusou-datasets/python/fusou_datasets/__init__.py`
     * `from ._config import configure, get_client_id, get_config` をインポートし、`__all__` に `"get_config"` を追加する。
   * **対象2**: `packages/fusou-datasets/python/fusou_datasets/schema.py` (12〜23行目、914〜927行目) & `packages/FUSOU-WORKFLOW/scripts/gen_python_constants.py`
     * `resolve_table_name` で単数形マスタテーブル名（`"mst_ship" -> "mst_ships"`, `"mst_slotitem" -> "mst_slot_items"`, `"mst_stype" -> "mst_stypes"` 等）のエイリアスマップをサポートし、`ALL_TABLES` に存在しない未知のテーブル名は必ず `ValueError` を送出するように修正する。
     * `TableLiteral` を `ALL_TABLES` の全テーブルと一致させる。
     * `gen_python_constants.py` を現行の `schema.py` 構造を出力するように更新する。

#### Step 2.2 のテスト・検証手順
* `packages/fusou-datasets/python/tests/` に以下のテストを追加して `pytest` を実行：
  * `fd.get_config()` が呼び出せること
  * `Relationships` で `Battle` と `Cells` の結合キーが `(Tables.Battle.UUID, Tables.Cells.BATTLES)` であること
  * `resolve_table_name("mst_ship")` が `"mst_ships"` に解決され、未知のテーブル名 `"unknown_xyz"` が `ValueError` を投げること
  * `query(..., split="validation")` が validation split のキャッシュパスを参照すること
  ```powershell
  uv run --directory packages/fusou-datasets/python pytest
  ```

---

## Phase 3: デッドコード削除・重複コード統合（DRY化）・DX/CI 改善

### Step 3.1: デッドコード・孤立ファイルの削除と `.gitignore` 整理
1. **不要ファイル・ディレクトリの削除**:
   * `packages/FUSOU-PROXY/proxy-http/`（ディレクトリごと削除）
   * `packages/fusou-upload/src/dataset_processor.rs` の削除、および `packages/fusou-upload/src/lib.rs` の `pub mod dataset_processor;` と `packages/fusou-upload/Cargo.toml` の `parquet` 依存の削除
   * `packages/FUSOU-WEB/src/server/routes/compact.ts` の削除、および `packages/FUSOU-WEB/src/server/app.ts` の `compactRoutes` マウント削除
   * `packages/FUSOU-WEB/src/server/error-codes.ts`, `src/lib/supabase.ts`, `src/lib/r2-sign.ts`, `src/lib/asset-sync.ts`, `src/components/common/react/ExpandableContainer.tsx`, `src/components/features/battles/astro/BattleTabs.astro`, `src/data/graphs/database_dot.json` の削除
   * `verify-schema-version.sh`、`.github/workflows/trigger_daily_compaction.yml` の削除
   * ワークスペースメンバー内の孤立 `Cargo.lock`（`packages/configs/Cargo.lock`, `packages/fusou-auth/Cargo.lock`, `packages/fusou-upload/Cargo.lock`, `packages/fusou-storage/Cargo.lock`, `packages/FUSOU-PROXY/proxy-https/Cargo.lock`）の削除
   * `packages/kc_api/Cargo.toml` から未使用の `arrow`, `datafusion`, `parquet` を削除、`packages/FUSOU-WEB/package.json` から未使用の `apache-arrow`, `react-chartjs-2`, `react-virtuoso` を削除
2. **ルート `package.json` と `.gitignore` の整理**:
   * ルート `package.json` から存在しない `"scout:formulas": "node scripts/scout-formulas.mjs"` を削除。
   * `.gitignore`、`/tsconfig.json`、`/.fossa.yml` から存在しない `packages/shared-ui` 参照を削除し、`.gitignore` に `.astro/`, `.pytest_cache/`, `.venv/`, `package/`, `state/` を追加。

### Step 3.2: 重複コード統合（DRY化）とスキーマ・CI スクリプト修正
1. **`fusou-compaction-core` の重複 OCF パーサ統合**:
   * `packages/fusou-compaction-core/src/index.ts` の `parseOCFHeader` を `src/avro.ts` の `parseOcfHeader` に統一し、`mergeAvroOCFWithBoundaries` での二重パースを解消する。
2. **`FUSOU-WEB` の2段階アップロード処理の共通化**:
   * `soku_speed_observed.ts`, `remodel_data.ts`, `ship_growth.ts`, `quest_tree.ts` の2段階署名アップロード検証ロジックを `src/server/utils/upload.ts` の共通ヘルパーに統合する。
3. **`kc_api` の `print_schema.rs` 出力漏れ修正と `check-schema-version-bump.sh` 修正**:
   * `packages/kc_api/crates/kc-api-database/src/bin/print_schema.rs` に `models::battle::NightSupportHourai` と `models::battle::NightSupportAirattack`（`#[cfg(schema_since = "0.5.0")]`）を追加する。
   * `packages/kc_api/scripts/check-schema-version-bump.sh` の正規表現 `^kc_api/` を `^packages/kc_api/` に修正する。
4. **GitHub Actions ワークフローの修正**:
   * `.github/workflows/check_build.yml`: 二重 `prebuild` の削除、`fusou-workflow` テストの `|| true` 削除、`fusou-datasets` の `pytest` 実行追加、`rustfmt` ジョブの不要 apt パッケージ削除。
   * `.github/workflows/export_doc.yml`: 71行目の `cat << EOF >> $GITHUB_ENV` を `cat << 'EOF' >> "$GITHUB_ENV"` に修正。
   * `.github/workflows/publish_and_create_version_tag.yml`: 250行目に `await` と `Number(process.env.release_id)` を追加。

#### Step 3.1 & 3.2 のテスト・検証手順
```powershell
pnpm --filter @fusou/compaction-core run build
pnpm --filter @fusou/compaction-core test
pnpm --filter fusou-web test
pnpm --filter fusou-web run check:tsc
cargo check --workspace
```

---

## Phase 4: デスクトップ・Web の UX 改善

### Step 4.1: `FUSOU-APP`（デスクトップアプリ）の UX 不具合修正とテスト

1. **Windows 起動時の CA 証明書インストール済みチェック追加**:
   * **対象**: `packages/FUSOU-APP/src-tauri/src/wrap_proxy.rs` (41〜44行目) & `src/cmd/native_cmd.rs`
   * **修正**: Windows でも証明書ファイルから SHA-1 サムプリント（または Subject）を確認し、既に `Cert:\CurrentUser\Root` に存在する場合は `native_cmd::add_store(&ca_path)` をスキップする。
2. **起動画面 (`start.tsx`) の PAC ヘルスチェック・遷移バグ・二重サーバー起動の修正**:
   * **対象1**: `packages/FUSOU-APP/src/pages/start.tsx` (82〜97行目、146〜160行目)
     * 91行目の `invoke<boolean>("check_proxy_server_health")` を `invoke<boolean>("check_pac_server_health")` に修正。
     * `handleStart`（146〜160行目）で、`launch_with_options` が成功し、かつ `open_app !== 0` の場合のみ `window.location.href = "/app"` に遷移するように修正。
   * **対象2**: `packages/FUSOU-APP/src-tauri/src/sequence/launch.rs` (111〜155行目)
     * `AtomicBool` で `PARSER_SERVER_RUNNING` 等のガードを設け、`launch_with_options` が複数回呼ばれても `parser_server` やプロキシが重複起動しないようにする。
3. **トレイメニューの「Open Configs」「Open Logs」修正とログファイル名タイポ修正**:
   * **対象**: `packages/FUSOU-APP/src-tauri/src/builder_setup/logger.rs` (30, 115行目) & `capabilities/migrated.json` (42〜50行目)
   * **修正**:
     * `fuosu-app` を `fusou-app` に修正。
     * `capabilities/migrated.json` の `opener:allow-open-path` に `$APPDATA/**` および `$LOCALAPPDATA/**` を追加し、トレイから設定ファイルとログファイルを開けるようにする。
4. **全 Context Provider の初期データ取得対応**:
   * **対象**: `packages/FUSOU-APP/src/utility/provider.tsx`
   * **修正**: マウント時に `get_*` Tauri コマンドを呼んでいなかった 11 個の Provider（`ShipsProvider`, `MstShipsProvider`, `SlotItemsProvider`, `MstSlotItemsProvider`, `MstEquipExslotShipsProvider`, `MstSlotItemEquipTypesProvider`, `MstEquipShipsProvider`, `MstStypesProvider`, `MaterialsProvider`, `DeckPortsProvider`, `AirBasesPortsProvider`）に、既存の `UseItemsProvider` 等と同様の初回 `invoke("get_...")` 呼び出しを追加する。
5. **艦娘・装備テーブルのフィルタバグ修正**:
   * **対象1**: `packages/FUSOU-APP/src/components/specification_table/ship_list.tsx` (361行目、733〜756行目)
     * `"Aircraft installed"` フィルタ（361行目）を `ship.slotnum` ではなく `mst_ships.mst_ships[ship.ship_id]?.maxeq?.reduce((a, b) => a + b, 0) ?? 0` で判定するよう修正。
     * `cal_search_name`（733〜756行目）の `sleep(10)` ループを廃止し、同期的に `tmp_name` リストを構築して `set_check_name(tmp_name)` を1回呼ぶ実装に修正。
   * **対象2**: `packages/FUSOU-APP/src/components/specification_table/equipment_list.tsx` (374〜384行目、720〜746行目)
     * `"Armor"` フィルタ（378行目）を `mst_slot_item.taik` から `mst_slot_item.souk` に修正。
     * `"Anti-Bomber"`（`mst_slot_item.houm`）、`"Interception"`（`mst_slot_item.houk`）、`"Distance"`（`mst_slot_item.distance`）の `check_range` 判定を追加。
     * `cal_search_name`（720〜746行目）を同様に同期処理へ修正。
   * **対象3**: `packages/FUSOU-APP/src/components/specification_table/set_window.tsx` (96, 146, 256, 316行目)
     * ラジオボタンの `name="radio-Level"` を `name={`radio-${props.filter_type}`}` のようにフィルタ項目ごとに一意化する。

#### Step 4.1 のテスト・検証手順
```powershell
pnpm --filter fusou-app test
cargo check --manifest-path packages/FUSOU-APP/src-tauri/Cargo.toml
cargo test --manifest-path packages/FUSOU-APP/src-tauri/Cargo.toml
```
