---
title: gRPC チャネル設定とマイクロサービス運用
authors: ["tsukasa-u", "GitHub Copilot"]
description: >-
  FUSOU の BidirectionalChannel を gRPC トランスポートへ切り替え、channel_service マイクロサービスを運用するための設定手順とワークフロー
date: 2025-11-18
slug: guide/grpc_channel
tags: [guide, grpc, microservice]
---

# gRPC チャネル設定とマイクロサービス運用

艦これ HTTPS 化への対応として、FUSOU では `proxy-https` クレートに gRPC ベースの `BidirectionalChannel` が追加されました。従来の `tokio::mpsc` (アプリ内で完結) に加え、gRPC を使うことで PAC / Proxy / 解析機能を別プロセス、別ホストで動かす柔軟な構成が可能になります。本ガイドでは設定ファイル、ビルドフラグ、マイクロサービス起動手順を順に説明します。

## 前提条件

- Rust 1.81 以上、Node.js 18 以上がインストール済み
- `proxy-https` で gRPC ビルドが通っていること (`cargo check -p proxy-https --features grpc`)
- `FUSOU-APP` の Tauri 開発環境がセットアップ済み
- `docs/contents/guide/set_https.md` の手順で HTTPS 用証明書が導入済み

## 設定の全体像

1. `configs.toml` に `[proxy.channel]` セクションを追加し、gRPC を選択します。
2. `FUSOU-APP` を `grpc-channel` フィーチャー付きでビルド / 実行します。
3. 別プロセスとして `channel_service` を起動し、必要に応じて環境変数でエンドポイントやバッファサイズを上書きします。

以下で各ステップを詳述します。

## 1. `configs.toml` でチャネル種別を切り替える

`FUSOU-APP` を一度起動すると、`ROAMING/user/configs.toml` (プラットフォームによりパスが異なります) にユーザー設定がコピーされます。`proxy` セクション末尾へ以下を追加・更新してください。

```toml
[proxy.channel]
  # "mpsc" で従来のアプリ内チャネル、"grpc" でマイクロサービス接続
transport = "grpc"

  # 任意: channel_service を別ホストに配置する場合の URI
endpoint = "http://127.0.0.1:50061"

  # 任意: gRPC サーバーの broadcast バッファサイズ (未指定ならサーバー既定)
buffer_size = 0
```

- `transport` を `grpc` にすると、`FUSOU_CHANNEL_ENDPOINT` / `FUSOU_CHANNEL_BUFFER` が自動的に設定されます。
- `transport = "mpsc"` のまま `grpc-channel` フィーチャーでビルドすると、ログに「gRPC を強制使用する」旨の警告が出ます。
- `grpc` を選んだ状態でフィーチャー無しで起動すると、`mpsc` へフォールバックしつつ警告が記録されます。

## 2. `FUSOU-APP` を gRPC フィーチャーで動かす

Tauri 側には `grpc-channel` フィーチャーが用意されています。開発時は次のように指定します。

```bash
cd packages/FUSOU-APP/src-tauri
cargo tauri dev --features grpc-channel
```

本番ビルドの場合は `cargo tauri build --features grpc-channel` を利用してください。他のフィーチャー (`custom-protocol` など) が必要な場合はカンマ区切りで併記できます。

## 3. `channel_service` マイクロサービスの起動

`proxy-https` リポジトリには、gRPC チャネルをホストする `channel_service` バイナリが含まれます。以下のコマンドで起動できます。

```bash
cd packages/FUSOU-PROXY/proxy-https
RUST_LOG=info \
cargo run --features grpc --bin channel_service
```

利用可能な環境変数:

| 変数                     | 既定値                   | 役割                                   |
| ------------------------ | ------------------------ | -------------------------------------- |
| `FUSOU_CHANNEL_BIND`     | `0.0.0.0:50061`          | gRPC サーバーの待ち受けアドレス        |
| `FUSOU_CHANNEL_BUFFER`   | `128`                    | `broadcast::channel` のバッファサイズ  |
| `FUSOU_CHANNEL_ENDPOINT` | `http://127.0.0.1:50061` | クライアント側 (アプリ) が接続する URI |

`endpoint` と `buffer_size` は前述の `configs.toml` から自動で注入されるため、基本的には `channel_service` を起動するだけで構いません。複数ノードで動かす場合は `FUSOU_CHANNEL_ENDPOINT` を直接上書きすることで、ユーザー設定よりも優先させることも可能です。

## 4. 運用フロー例

1. サーバー側で `channel_service` を常駐プロセス (systemd / Supervisor など) として起動する。
2. クライアント PC では `configs.toml` の `transport = "grpc"` を確認し、`cargo tauri dev --features grpc-channel` でアプリを立ち上げる。
3. `FUSOU-APP` トレイメニューからプロキシ / PAC を開始。必要に応じて `RUST_LOG=info` でログを確認し、`Sent health message over gRPC` が表示されることをチェックする。
4. シャットダウン時はトレイメニューの `Quit` を選択すると `request_shutdown` が gRPC 経由で順に送出され、`channel_service` のログにも応答が記録される。

## 5. トラブルシューティング

| 症状                             | 原因                                                 | 対処                                                                             |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `failed to connect gRPC channel` | `channel_service` が未起動、または `endpoint` が不正 | サービスの生存確認 (`netstat -tulpn` など) と設定値の再確認                      |
| `Health stream closed`           | サーバーバッファが枯渇、通信断                       | `FUSOU_CHANNEL_BUFFER` を増やす、ネットワーク経路を確認                          |
| `transport mismatch` 警告        | ビルドフィーチャーと `configs.toml` が不一致         | アプリビルドを `--features grpc-channel` に揃えるか、`transport = "mpsc"` へ戻す |
| ポート競合                       | 既に 50061 が使用中                                  | `FUSOU_CHANNEL_BIND` / `endpoint` を別ポートに変更                               |

## 6. 運用上のヒント

- 監視: `RUST_LOG=info` で `channel_service` を起動すると、送受信ログやヘルスチェックが可視化されます。さらに詳細を見たい場合は `tracing_subscriber` を追加してください。
- 証明書: gRPC 通信はローカルネットワーク内を前提にしており、現状は plaintext HTTP/2 です。ネットワーク越しに公開する場合はリバースプロキシ (Caddy, Nginx 等) で TLS を終端する構成を推奨します。
- スケールアウト: `channel_service` はステートレスな `broadcast::channel` を利用しています。高頻度トラフィックで追いつかない場合は `buffer_size` を上げるか、チャネルを用途別に分割することを検討してください。

---

_このドキュメントは AI による草案です。_
