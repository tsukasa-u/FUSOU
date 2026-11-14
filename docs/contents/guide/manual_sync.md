---
title: Manual Snapshot Sync and Retrieval Flows
description: Manual fleet snapshot sync and retrieval flows for FUSOU (FUSOU-APP Rust storage → /api/fleet/snapshot → R2, and /api/fleet/snapshot/:tag viewing).
contributors: ["github-copilot", "antigravity-ai"]
date: 2026-11-15
slug: guide/manual_sync
tags: [guide]
---

# Manual Snapshot Sync and Retrieval Flows

## 目的

ユーザー操作によりクライアント（FUSOU-APP）から現在の艦隊・装備・アイテムのスナップショットを保存し、FUSOU-WEB の API 経由で Cloudflare R2 に格納して、Web シミュレーター等から参照できるようにする仕組みを説明します。

## 関係コンポーネント

- クライアント（FUSOU-APP）:
  - UI（`packages/FUSOU-APP/src/components/settings/settings.tsx`）の `perform_snapshot_sync` コマンド呼び出し、またはトレイメニューの `Sync snapshot`（`packages/FUSOU-APP/src-tauri/src/builder_setup/setup.rs`）。
  - 実装本体: `packages/FUSOU-APP/src-tauri/src/storage/snapshot.rs`（`perform_snapshot_sync_app`）。
- サーバー API（FUSOU-WEB）:
  - `packages/FUSOU-WEB/src/server/routes/fleet.ts`（`POST /api/fleet/snapshot`, `GET /api/fleet/snapshots/list`, `GET /api/fleet/snapshot/:tag`）。
- ストレージ: Cloudflare R2（`FLEET_SNAPSHOT_BUCKET`）。

## 1) 手動スナップショット同期（FUSOU-APP → `/api/fleet/snapshot` → R2）

1. スナップショット構築（クライアント Rust 側）
   - `get_payload_data()` が `kc_api::interface`（`Ships`, `UseItems`, `SlotItems`, `DeckPorts`）から最新状態をメモリ上で読み込み、`id` 昇順でソートした `FleetSnapshot` JSON を生成します。
   - `canonicalize_json()` でオブジェクトのキーを再帰的に辞書順へ正規化してからシリアライズ（`serde_json::to_vec`）します。これにより、同一の艦隊状態で一貫した SHA-256 ハッシュが得られます。

2. 2 段階署名付きアップロード（`fusou_upload::Uploader`）
   - `auth_manager` から `dataset_id`（`dataset_token` 経由）を解決し、`Uploader::build_snapshot_handshake("latest", &dataset_id)` を作成します。
   - クライアントは `Content-Type: application/json` と `Idempotency-Key: <uuid>` を付与し、`fusou_upload::Uploader::upload` を通じて SHA-256（`content_hash`）付きハンドシェイク → 署名付き PUT/POST の 2 段階で JSON バイト列を送信します。
   - デフォルトの送信先は `[app.asset_sync].fleet_snapshot_endpoint`（`https://fusou.dev/api/fleet/snapshot`）です。

3. サーバー側処理（`fleet.ts`）
   - Stage 1（準備）: トークン・`dataset_id`・`tag`・`content_hash` を検証し、署名済みアップロード URL を返します。
   - Stage 2（実行）: 本体の SHA-256 を再計算して `content_hash` と照合し、JSON スキーマを検証します。サイズがしきい値（`SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES`）以下の場合は空データとしてスキップします。
   - 有効なスナップショットはサーバー側で `CompressionStream("gzip")` により圧縮し、Cloudflare R2 バケット `FLEET_SNAPSHOT_BUCKET` の `fleets/{dataset_id}/{tag}/...` キー配下へ保存します。

## 2) スナップショット閲覧フロー（一覧・取得）

FUSOU-WEB のシミュレーター（`DataImportModal.tsx` / `FleetListPanel.tsx` 等）からは以下の API 経由で保存済みスナップショットを取得します。

- タグ・一覧の取得: `GET /api/fleet/snapshots/list`
- 最新スナップショットの取得: `GET /api/fleet/snapshot/:tag`
  - サーバーは `FLEET_SNAPSHOT_BUCKET` の `fleets/{dataset_id}/{safeTag}/` 配下から最新のオブジェクトを取得し、gzip 展開・スキーマ検証のうえで `{ ok: true, tag, snapshot }` を返します。

> [!NOTE]
> 短縮 URL リダイレクト `/s/:key`（`packages/FUSOU-WEB/src/pages/s/[key].ts`）は艦隊構成共有等の短縮リンク（`/api/shorten` / `/share/short/[key]`）向けのルートであり、`/api/fleet/snapshot/:tag` とは別の機能です。

## 使い方（ユーザー向け）

1. FUSOU-APP の設定画面から手動同期を実行するか、システムトレイメニューの `Sync snapshot` を選択します。
2. `perform_snapshot_sync_app` が現在の艦隊・装備・アイテム情報を送信し、完了時にアプリ通知が表示されます（重複・空データの場合はスキップ通知になります）。
3. 必要に応じて FUSOU-WEB の編成シミュレーター等のインポート画面からスナップショットを読み込めます。
