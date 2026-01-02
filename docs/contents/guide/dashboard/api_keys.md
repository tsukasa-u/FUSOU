---
title: API Keys
contributors: ["antigravity-ai"]
description: FUSOU Web Dashboard での API キーの作成、管理、および信頼済みデバイスの管理方法について説明します。
date: 2026-01-01
slug: guide/dashboard/api_keys
tags: [guide, dashboard, auth]
---

# API Key Management

FUSOU Datasets などのクライアントツールからデータにアクセスするためには、API キーが必要です。
このページでは、Web ダッシュボードを使用して API キーを管理する方法を説明します。

## ダッシュボードへのアクセス

1. [FUSOU Dashboard](/dashboard) にログインします。
2. 左側のメニューから [**API Keys**](/dashboard/api-keys) を選択します。
   - 直接アクセス: `https://fusou.dev/dashboard/api-keys`

## API キーの作成

1. **"Create New API Key"** ボタンをクリックします。
2. 新しい API キーが生成され、画面に表示されます。
3. **キーをコピー** してください。
   - キーの横にあるコピーアイコンをクリックするとクリップボードにコピーされます。
   - アイコンがチェックマーク (✓) に変わればコピー完了です。

> [!CAUTION] > **API キーは一度しか表示されません。**
> ページをリロードしたり移動したりすると、キー全体を再度確認することはできません（セキュリティのため、一部がマスクされた状態で表示されます）。必ず安全な場所に保管してください。

## API キーの使用

取得した API キーは、FUSOU Datasets などのクライアントライブラリで使用します。

```bash
export FUSOU_API_KEY="fsk_..."
```

詳しくは [Fusou Datasets 認証ガイド](/guide/fusou_datasets/authentication) を参照してください。

## API キーの削除

不要になったキーや、漏洩の疑いがあるキーは削除してください。

1. 削除したいキーの行にある **ゴミ箱アイコン** をクリックします。
2. 確認ダイアログが表示されます。
   - "Are you sure?" というメッセージが表示されます。
3. **"Delete"** ボタンをクリックして削除を実行します。

削除されたキーは即座に無効化され、それを使用した API リクエストは拒否されます。

## 信頼済みデバイス (Trusted Devices)

FUSOU では、セキュリティ強化のため、API キーだけでなくデバイス（IP アドレスやクライアント情報）の信頼性を確認する場合があります。

### デバイスの確認

API キー一覧の下にある **"Trusted Devices"** セクションで、現在信頼されているデバイスを確認できます。

- **Status**:
  - `verified`: 認証済み（アクセス可能）
  - `pending`: 確認待ち（メール認証が必要）

### デバイスの削除

不要なデバイス（古い PC など）の登録を解除するには、対象デバイスの **"Delete"** ボタンをクリックしてください。

> [!NOTE]
> 新しい環境から初めてアクセスする場合、登録メールアドレスに認証メールが送信されることがあります。メール内のリンクをクリックしてデバイスを承認してください。
