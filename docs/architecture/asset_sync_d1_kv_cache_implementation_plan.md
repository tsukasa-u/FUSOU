# Asset Sync D1-KV キャッシュ実装計画

- 作成日: 2026-06-01
- 対象: FUSOU-WEB（サーバ） / fusou-storage（クライアント）
- 目的: assetインデックスのキャッシュ保持と、既存のD1同期まわりの問題改善を同時に実施する

## 1. 背景

現行の /api/asset-sync/keys は、都度D1のfilesテーブルを走査してレスポンスを組み立てている。
この方式は実装が単純な一方で、クライアントのポーリング頻度が上がるとD1 read負荷が増加しやすい。

本計画では以下を同時に達成する。

- D1を唯一の真実（source of truth）として維持する
- 読み出しはKVスナップショットを優先する
- D1更新時にキャッシュを確実に無効化し再構築する
- 増分同期の取りこぼしリスクを低減する

## 2. 現状確認（実装ベース）

- /asset-sync/keys は LIMIT/OFFSET でD1をループし、最終的に全件を返却している
- /asset-sync/keys のレスポンス cached は常に false
- asset専用KVバインディングは未定義（既存KVはDATA_LOADER_CACHE_KVのみ）
- クライアントは last_sync_timestamp を保持し、since付きで増分取得している

## 3. 現在の問題点

### 3.1 D1 read 負荷が高い

- /keys 呼び出しのたびにD1を読む
- 同じデータを短周期で何度も再計算する

### 3.2 LIMIT/OFFSET ページングの整合性リスク

- 取得中に書き込みが入るとページ境界がずれる
- ORDER BY uploaded_at 単独だと同時刻タイの順序が不安定

### 3.3 増分同期境界の不一致

- 境界として使っている refreshedAt は「レスポンス時刻」であり、クエリ対象のスナップショット上限とは一致しない

### 3.4 フィールド命名差異による互換リスク

- サーバは camelCase を返すが、クライアント側の受け取りが snake_case 前提の箇所がある
- TTLやハッシュ解釈が劣化する余地がある

### 3.5 D1更新経路ごとの無効化契約が明確でない

- upload経路だけでなく、admin backfillもD1を書き換える
- すべての更新で同じ無効化シグナル更新ルールが必要

### 3.6 KV運用制約を踏まえた設計不足

- Cloudflare KVは同一キーへの高頻度書き込みに制約がある（同一キーは1秒1回）
- KV値サイズ上限（25MiB）を超えないページング条件を明示する必要がある
- KVは最終的整合性であり、ロックを厳密排他として扱えない

## 4. 目標と非目標

### 4.1 目標

- /asset-sync/keys の通常応答をKVキャッシュ化し、D1 readを大幅に削減
- 増分同期の整合性を改善
- 既存クライアントとの後方互換を維持
- D1更新時の無効化と再構築を明文化

### 4.2 非目標

- D1を廃止する
- 認証モデルを変更する
- asset以外のルートを大規模改修する

## 5. 採用アーキテクチャ

### 5.1 レイヤ構成

- 真実データ: D1 files テーブル
- 読み出しキャッシュ: asset専用KV（新設）
- クライアントローカルキャッシュ: 既存（fusou-storage）を継続利用

### 5.2 KVキー設計（v1）

- asset-sync:index:v1:manifest
- asset-sync:index:v1:version:{version}:page:{pageNo}
- asset-sync:index:v1:rebuild-lock

manifest の主な項目:

- schemaVersion
- version
- sourceRevision
- refreshedAtMs
- snapshotUpperMs
- pageSize
- pageMaxBytes
- pageCount
- total
- maxUploadedAtMs
- minUploadedAtMs

page の主な項目:

- version
- pageNo
- maxUploadedAtMs
- minUploadedAtMs
- items[]

item の主な項目:

- key
- contentHash
- size
- uploadedAt

補足:

- 本計画では環境分離プレフィックスは採用しない（単一キー空間運用）
- page は「件数上限」と「JSONシリアライズ後のバイト上限」の両方で区切る（KV 25MiB対策）

### 5.3 保持戦略

- 現行version + 1世代前のversionを保持
- manifest/page は expirationTtl 7日
- 新version公開後に旧pageを非同期掃除
- 再構築中に失敗して残った孤児versionは定期GCで掃除

### 5.4 実装で詰まりやすい点と対策

- KV値サイズ超過対策:
  - pageは件数だけでなくJSONバイト数でも分割する
  - 1ページ上限は 20MiB 程度に抑えて余白を確保する
- ロック重複対策:
  - rebuild-lock は advisory として扱い、重複再構築を許容する
  - version付き書き込み + manifest最終切替で整合を保つ
- バインディング移行対策:
  - ASSET_SYNC_INDEX_KV が未設定なら /asset-sync/keys は 503 を返す
  - 他用途KVへのフォールバックは行わない

### 5.5 既定パラメータ（初期値）

- pageSize: 2000
- pageMaxBytes: 20MiB（20x1024x1024）
- manifest/page expirationTtl: 7日
- stale許容時間（maxStaleMs）: 86400000 ms（1日）
- rebuild-lock TTL: 60秒
- lock競合時の待機上限: 2000 ms

## 6. 読み出し設計（/asset-sync/keys）

### 6.1 通常フロー

この節は実装後の目標フローを示す。現行実装は、since の有無に関係なく D1 を直接参照している。

1. 認証を検証
1. ASSET_SYNC_INDEX_KV 未設定なら 503 を返す
1. KVのmanifestを取得
1. D1の asset_index_meta.revision を1行だけ取得
1. manifest.sourceRevision と比較し、一致すればKVから返却
1. since 指定時は必要ページのみ読み、uploadedAt > since を抽出
1. snapshotUpperAt/snapshotUpperMs を含め、cached=true で返却

### 6.2 再構築条件

- manifestが存在しない
- manifest.sourceRevision と D1 revision が不一致
- schemaVersion不一致
- manifestが古すぎる（maxStaleMs=86400000 を超過）

### 6.3 再構築実行

- rebuild-lock で同時再構築を抑制（短TTL、厳密排他ではなく advisory lock）
- D1を決定順で走査（推奨案を採用: keyset paging）
- snapshotUpperMs を再構築開始時に固定し、`uploaded_at <= snapshotUpperMs` の範囲で走査
- ソート: uploaded_at DESC, key DESC
- page書き込み完了後にmanifestを切替（原子的に見える公開順）

再構築クエリ（採用）:

- 初回ページ:
  - SELECT key, content_hash, size, uploaded_at
    FROM files
    WHERE uploaded_at <= ?
    ORDER BY uploaded_at DESC, key DESC
    LIMIT ?
- 2ページ目以降:
  - SELECT key, content_hash, size, uploaded_at
    FROM files
    WHERE uploaded_at <= ?
    AND (uploaded_at < ? OR (uploaded_at = ? AND key < ?))
    ORDER BY uploaded_at DESC, key DESC
    LIMIT ?

注意:

- KVの最終的整合性により、稀に再構築が重複実行される可能性を許容する
- 重複実行時も version 付きページ書き込み + 最後にmanifest切替で安全に収束させる

### 6.4 フォールバック

- フォールバック発生条件と遷移を以下で固定する

- ケース1（KVバインディング未設定）: ASSET_SYNC_INDEX_KV が未設定なら D1にはフォールバックせず 503（設定不備）を返す
- ケース2（KV経路エラー）: manifest/page読み取り失敗、再構築失敗、lock競合タイムアウトが2秒以内に回復しない場合は同一リクエスト内で D1直読みへフォールバックし、cached=false を返す
- ケース3（D1 revision確認エラー）: revision取得失敗時は、manifest年齢が maxStaleMs 以内なら stale KV を返して cached=true, degraded=true、stale許容外またはmanifest欠落なら D1直読みへフォールバックして cached=false を返す
- ケース4（D1直読み失敗）: D1フォールバッククエリも失敗した場合は 503 を返す

補足:

- D1フォールバック時も並び順は uploaded_at DESC, key DESC を維持する
- 警告ログには理由ラベル（manifest_missing / kv_error / revision_error / lock_contended）を付与する

### 6.5 障害時の可用性方針

- D1 revision 取得に失敗した場合:
  - manifest が maxStaleMs 以内なら stale KV を返す（degraded=true）
  - manifest も利用不可なら D1フォールバックを試行し、失敗時は 503 を返す
- これにより D1 一時障害時でも、短時間は読み出し可用性を維持する

degraded の定義:

- 要求は成功（HTTP 200）だが、最新性保証を一段下げた応答状態
- 典型例は「D1 revision確認に失敗したため stale KV を返した」ケース
- 監視上は正常系と分離して計測する

## 7. D1更新と無効化シグナル（D1 revision）

D1 files テーブルの更新成功後、必ず asset_index_meta.revision を更新する。

対象経路:

- /asset-sync/upload
- /admin/backfill-asset-index
- 将来追加される files 更新系ルート

シグナル payload:

- revision
- updatedAtMs
- writerRoute
- requestId

メタテーブル案:

- テーブル名: asset_index_meta
- カラム: id (固定1), revision, updated_at
- 初期化: id=1 行を revision=0 で存在させる

更新SQL（イメージ）:

- UPDATE asset_index_meta
  SET revision = revision + 1,
  updated_at = ?
  WHERE id = 1;

注記:

- revision 初期値は migration と同じ 0 に統一する

最適化（任意）:

- revision 更新後に fire-and-forget で再構築キック
- upload応答は再構築完了を待たない

## 8. 増分同期の正確性改善

### 8.1 追加レスポンス項目

- snapshotUpperAt
- snapshotUpperMs

ルール:

- snapshotUpperMs はスナップショット作成時に固定
- クライアントは次回since境界として snapshotUpperMs を最優先利用
- refreshedAt は互換維持のため残す

### 8.2 決定的順序

- D1再構築クエリは常に uploaded_at DESC, key DESC
- 同時刻タイでの揺れを排除

## 9. クライアント互換（fusou-storage）

### 9.1 受信フィールドのalias対応

serde aliasで両方を受理する。

- contentHash / content_hash
- cacheExpiresAt / cache_expires_at
- refreshedAt / refreshed_at
- snapshotUpperAt / snapshot_upper_at
- snapshotUpperMs / snapshot_upper_ms

### 9.2 同期境界の優先順位

- snapshotUpperMs を最優先で last_sync_timestamp に保存
- 未提供時のみ refreshedAt を利用

### 9.3 後方互換

- 旧サーバ（snapshot項目なし）でも動作継続
- 新サーバでも旧項目を返す

## 10. D1インデックス計画

再構築走査の性能と安定性のため、以下を追加する。

- CREATE INDEX IF NOT EXISTS idx_files_uploaded_key ON files(uploaded_at DESC, key DESC)

ASSET_INDEX_DBで通常migrationが難しい場合は、運用SQL手順を別途 runbook 化する。

## 11. 監視・可観測性

追加メトリクス/ログ:

- keys_cache_hit
- keys_cache_miss
- keys_rebuild_started
- keys_rebuild_succeeded
- keys_rebuild_failed
- keys_fallback_d1
- keys_response_items
- keys_response_latency_ms

原因ラベル:

- manifest_missing
- revision_mismatch
- schema_mismatch
- lock_contended
- kv_error

## 12. セキュリティ観点

- /keys の認証要件は現行維持
- KVには秘密情報を保存しない
- Authorizationヘッダやトークンをログ出力しない

## 13. ロールアウト

### Phase A（互換先行）

- レスポンスに snapshotUpperAt/snapshotUpperMs を追加
- クライアントalias対応を先行投入

### Phase B（KV読み出し有効化）

- /keys のKV優先返却を有効化
- revision 更新を upload/backfill に導入

### Phase C（再構築強化）

- 非同期再構築キック有効化
- 旧version掃除、ロック競合時の挙動調整

### Phase D（最適化）

- 実測を見て pageSize / TTL を調整
- D1フォールバック率を継続監視

## 14. ロールバック

- Feature flag でKV経路を停止し、D1直読みへ即時復帰
- revision 更新は残しても副作用なし
- 旧クライアント互換項目は維持

## 15. 代替案とトレードオフ

### 案A: D1直読みのままSQL最適化のみ

- 利点: 実装が最小
- 欠点: D1 read削減効果が限定的

### 案B: D1内に別テーブルでマテリアライズ

- 利点: D1内で整合性を閉じやすい
- 欠点: D1 read負荷の本質削減になりにくい

### 案C: D1真実 + KVスナップショット（採用）

- 利点: read負荷削減が大きい、段階導入しやすい
- 欠点: 再構築/無効化の運用設計が必要

### 設計上の重要判断

- 無効化シグナルはKV同一キー更新ではなく D1 revision を採用する
- 理由: 同一KVキー高頻度更新制約により、writeスパイク時の取りこぼしを避けるため
- 影響: /keys でD1を1行読むが、全件走査に比べて負荷は極小

## 16. 実装タスク

- [x] ASSET_INDEX_DB の migrations_dir を追加し、remote migration を適用
- [x] ASSET_SYNC_INDEX_KV バインディングを wrangler と Bindings 型に追加
- [x] D1に asset_index_meta テーブルを追加（migration または運用SQL）
- [x] asset_index_meta テーブル未作成時の自動初期化（または起動時チェック）を実装
- [x] src/server/utils/asset-index-cache.ts を新規作成
- [x] manifest/page 読み書きユーティリティ実装
- [x] D1 -> KV 再構築処理を実装
- [x] rebuild-lock と stale version cleanup を実装
- [x] D1 revision 読み取り/更新ユーティリティを実装
- [x] ASSET_SYNC_INDEX_KV 未設定時に /asset-sync/keys が 503 を返すガードを実装
- [x] /asset-sync/keys を KV優先 + D1フォールバックへ変更
- [x] /asset-sync/upload のD1書き込み後に revision 更新
- [x] /admin/backfill-asset-index のD1書き込み後に revision 更新
- [x] snapshotUpperAt/snapshotUpperMs をレスポンスへ追加
- [x] degraded/stale 応答フラグを追加（D1一時障害時）
- [x] fusou-storage のserde alias追加
- [x] fusou-storage の同期境界優先順位を更新
- [x] インデックス追加（migrationまたは運用SQL）
- [ ] ユニット/統合テスト追加
- [ ] 監視ログ/カウンタ追加

運用ルール:

- このタスクリストは実施完了時点で [x] に更新する

## 17. 検証手順（実行順）

1. pnpm run astro check
1. pnpm run e2e:simulator:smoke
1. pnpm run verify:battle-data

追加検証:

- /keys の cache hit / miss / rebuild / fallback をテスト
- 同時書き込み下での増分同期整合性をテスト
- revision 更新から再構築反映までの遅延を計測
- KV page が 25MiB を超えないことをテスト（境界ケース）
- D1 revision 読み取り失敗時の stale KV 応答をテスト

## 18. 受け入れ条件

- 通常時の /asset-sync/keys が cached=true で返る
- D1フォールバック率が低位で安定する
- 増分同期で取りこぼし再現が解消される
- 新旧フィールド命名をクライアントが両対応できる
- 認証・ログ取り扱いの回帰がない
- D1一時障害時に、許容範囲内では stale KV で継続応答できる
