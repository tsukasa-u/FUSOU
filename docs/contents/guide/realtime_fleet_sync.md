---
title: 艦隊情報の同期設計（手動同期：ユーザー×タグ前提）
description: FUSOU の艦隊情報をユーザーごと・タグごとに保存・共有するための設計。手動同期を基本に、ストレージ選定・API フロー・短縮 URL と権限管理をまとめる。
contributors: ["github-copilot"]
date: 2025-11-27
slug: guide/realtime_fleet_sync
tags: [guide, sync, storage]
---

## 目的
- ユーザーごと・タグごとに保存された艦隊スナップショットを、手動同期（Sync ボタン）または低頻度の定期同期で管理する。
- 閲覧者は短縮 URL または共有リスト経由で該当スナップショットを取得する。多くの閲覧者がいても API 負荷とコストを抑える構成を目指す。

## 要件まとめ
- 保存単位は `owner_id + tag` で一意に識別されること。
- 各スナップショット本体は約 1MB（JSON）で、手動 or 定期（例: 日次、またはユーザー指定）で更新される。
- 閲覧は基本的に Pull モデル（短縮 URL または一覧 → リクエスト）で行い、プッシュは行わない。
- 認証・アクセス制御（公開／トークンベースの共有）を実装すること。
- 多数の閲覧者を想定し、読み取りはエッジでキャッシュして負荷を下げる。

---

（このドキュメントではリアルタイム P2P は扱わず、手動同期モデルに最適化した設計を提示します。）

---

## 本ドキュメントの前提と推奨アーキテクチャ
前提に沿って現実的でコスト効率の良い構成を推奨します。

- 書き込み（Sync）: Supabase（Postgres + jsonb）を canonical source とする。
- 本体（約1MB の JSON）: 圧縮して Cloudflare R2 に保存。R2 は大きなバイナリ向けで安価。
- 読み取り（大量の閲覧者）: Cloudflare Worker と CDN キャッシュ（Cache API）でエッジ配信。必要なら D1 を読み取りキャッシュとして併用。

この構成は無料枠を最大限活かしつつ、読み取りコストを抑えることができます。

---

## 具体設計: スキーマ・API・保存フロー

以下は実装しやすいスキーマと API の例です（手動同期・短縮 URL 想定）。

### スキーマ（Supabase: metadata）
```sql
CREATE TABLE fleets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  tag text NOT NULL,
  title text,
  r2_key text,
  size_bytes int,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_public boolean NOT NULL DEFAULT false,
  share_token text,
  retention_policy text,
  UNIQUE (owner_id, tag)
);
CREATE INDEX idx_fleets_owner_tag ON fleets (owner_id, tag);
CREATE INDEX idx_fleets_share_token ON fleets (share_token);
```

### R2 オブジェクト命名
- `fleets/{owner_id}/{tag}/{version}.json.gz` を慣例にする。圧縮して保存し、`r2_key` に格納する。

### POST /api/fleet/snapshot（簡潔フロー）
1. 認証（JWT）を検証し `owner_id` を取得
2. 受け取った payload を gzip 圧縮、ハッシュとサイズを計算
3. R2 に PUT（key = `fleets/{owner}/{tag}/{version}.json.gz`）
4. Supabase に UPSERT して metadata を更新（`r2_key`, `version`, `size_bytes`, `updated_at`）
5. レスポンスに `share_url`（必要なら `share_token`）と `version`, `updated_at` を返す
6. 非同期で Edge キャッシュ（Cloudflare Cache API / D1）にレプリケート（推奨: queue を使う）

### GET /s/:token（短縮 URL）
1. Worker が `share_token` を受け取り Supabase から metadata を取得
2. `is_public` またはトークンの妥当性を確認
3. R2 からオブジェクトを取得（Worker Cache を利用すると高速）
4. `ETag`（例: `W/"version-hash"`）と `Cache-Control` を付けて返す


---

## キャッシュ戦略とコスト削減の実務ポイント

- データは原則「最新のみ」を保持（history を必要とする場合は retention_policy により制御）。これが無料枠で運用するための最大のコツ。
- JSON は gzip 圧縮して R2 に保存（多くの場合 1MB → 数百 KB に圧縮）。
- 可能なら内容の重複排除（content-hash ベース）を導入し、同一ペイロードは同じオブジェクトを参照する。
- 閲覧者向けは Cloudflare の CDN キャッシュ（Cache-Control）を活用。Worker で `ETag` を付与して 304 を使わせる。

---

## API 呼び出し数を抑える具体策（手動同期モデル向け）
1. 書き込みは原則ユーザーの手動 Sync または低頻度の定期（例: 日次）。高頻度（10分）を常時有効にしない。
2. 閲覧者は短縮 URL／一覧からの参照時のみ取得し、`ETag`/`If-None-Match` で 304 を活用。
3. Cloudflare キャッシュで多数の読み取りをエッジで吸収する（`Cache-Control` の適切な設定）。
4. データは圧縮・重複排除・最新のみ保持でストレージ料を削減。


---

## 実装ロードマップ（手順）
短期（MVP）
- Supabase に `fleets` テーブルを作成し RLS を設定する
- `POST /api/fleet/snapshot` を実装（Cloudflare Worker または Supabase Function） — payload を gzip → R2 PUT → Supabase UPSERT
- 短縮 URL (`/s/:token`) を Cloudflare Worker で実装し、R2 から取得して返却（Cache-Control と ETag を付与）

中期
- Edge キャッシュ（Cloudflare Cache API）や D1 を導入して読み取りレイテンシを削減
- 非同期レプリケーション／キューで R2 ← Supabase の整合を担保
- retention / quota / pruning ジョブを実装

長期
- 必要な場合は閲覧者向けの追加 UX（Web Push 通知、差分表示、履歴）を導入


---

## 次にやること（あなたが忘れないための短い ToDo）
このドキュメントの内容をすぐ実装に移すために、今私が提案している作業 A〜E をここに残します。どれを優先するか教えてください。

A: Supabase 用 SQL（`fleets` テーブル + RLS ポリシー）を生成して `docs/` に追加する。
B: Cloudflare Worker の短縮 URL `GET /s/:token` と `POST /worker/cache/upsert` の TypeScript サンプルを作成する。
C: `POST /api/fleet/snapshot`（Cloudflare Worker）サンプル実装を作る（R2 PUT + Supabase UPSERT）。
D: 圧縮と重複排除ロジック（content-hash ベース）と保存戦略をコード化する。
E: ドキュメントをこの変更に合わせて追加更新（完了：このファイルが対象）。

推奨開始順: `A` → `C` → `B` → `D`（順次、E はドキュメント作業なので随時行います）。

---

このファイルをベースに、私が `A`（SQL + RLS）と `C`（snapshot endpoint）を作成してリポジトリに追加できます。どれを進めますか？（複数選択可、例: `A,C`）


---

## セキュリティと共有モデルの提案
- 認証: Supabase Auth を使い、JWT を Signaling と Persistence API で検証する
- 共有リンク: `share_token` レコードを DB に作成し、有効期限・権限を持たせる
- RLS: `fleets` テーブルに RLS を設定して owner／token 保持者のみ SELECT を許可

---

## 次のアクション（私の提案）
1. あなたが望む初期プロトタイプを教えてください：
   - A: まずは **MVP（中央集約）** — fastest path to production（推奨）
   - B: 直接 **WebRTC ハイブリッド MVP** を先に作る（Signaling + DataChannel + Persistence）
2. 選んだら、私は即座に以下を作業します:
   - DB スキーマ SQL（`fleets`, RLS ポリシー）
   - Edge Persistence API サンプル（Cloudflare Worker または Supabase Function）
   - 簡易 Signaling サーバー（WebSocket）サンプル（B を選んだ場合）
   - FUSOU-APP 側と Web 側の最小サンプルコード（DataChannel send/receive + snapshot save）

---

必要ならこのドキュメントをベースに実装コード・SQL・サンプルを追加します。どちらのプロトタイプ（A または B）を先に作りましょうか？
