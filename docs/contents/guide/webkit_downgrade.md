---
title: WebKit ライブラリのダウングレード
description: Tauri アプリケーションの互換性のため libwebkit2gtk-4.1 をダウングレードする手順
contributors: ["warp-agent"]
date: 2026-02-15
slug: guide/webkit_downgrade
tags: [guide, linux, webkit, troubleshooting]
---

# WebKit ライブラリのダウングレード

Ubuntu で FUSOU (Tauri アプリケーション) を実行する際、最新の WebKit ライブラリで互換性の問題が発生することがあります。このガイドでは、libwebkit2gtk-4.1 を安定バージョンにダウングレードする手順を説明します。

## 対象パッケージ

- `libwebkit2gtk-4.1-0`
- `libwebkit2gtk-4.1-dev`
- `libjavascriptcoregtk-4.1-0`
- `libjavascriptcoregtk-4.1-dev`
- `gir1.2-javascriptcoregtk-4.1`
- `gir1.2-webkit2-4.1`

## 手順

### 1. 現在のバージョンを確認

```bash
dpkg -l | grep -E "libwebkit2gtk-4.1-0|libjavascriptcoregtk-4.1-0"
```

利用可能なバージョンを確認：

```bash
apt-cache policy libwebkit2gtk-4.1-0
```

### 2. ダウングレードするバージョンを設定

```bash
VERSION=2.44.0-2
```

### 3. パッケージをダウングレード

```bash
sudo apt install -y --allow-downgrades \
  libwebkit2gtk-4.1-0=$VERSION \
  libwebkit2gtk-4.1-dev=$VERSION \
  libjavascriptcoregtk-4.1-0=$VERSION \
  libjavascriptcoregtk-4.1-dev=$VERSION \
  gir1.2-javascriptcoregtk-4.1=$VERSION \
  gir1.2-webkit2-4.1=$VERSION
```

### 4. パッケージをホールド（自動更新を防止）

```bash
sudo apt-mark hold \
  libwebkit2gtk-4.1-0 \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-0 \
  libjavascriptcoregtk-4.1-dev \
  gir1.2-javascriptcoregtk-4.1 \
  gir1.2-webkit2-4.1
```

### 5. ホールド状態を確認

```bash
apt-mark showhold
```

## ホールドを解除する場合

将来的に最新バージョンに戻したい場合：

```bash
sudo apt-mark unhold \
  libwebkit2gtk-4.1-0 \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-0 \
  libjavascriptcoregtk-4.1-dev \
  gir1.2-javascriptcoregtk-4.1 \
  gir1.2-webkit2-4.1

sudo apt update && sudo apt upgrade
```

## 注意事項

- `--allow-downgrades` フラグは依存関係を考慮してダウングレードを許可します
- ホールドしたパッケージは `apt upgrade` で更新されません
- セキュリティアップデートも適用されなくなるため、定期的に互換性を確認し、可能であれば最新版に戻すことを推奨します
- 他の WebKit 依存パッケージでエラーが発生した場合は `sudo apt --fix-broken install` を実行してください
