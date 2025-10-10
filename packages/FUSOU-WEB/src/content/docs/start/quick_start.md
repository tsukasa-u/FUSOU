---
title: Quick Start
contributors: ["tsukasa-u"]
description: Quick start guide for FUSOU-APP
date: 2025-10-08
slug: start/quick_start
tags: [start, quick_start]
---

# Quick Start FUSOU-APP

まずはこのページを読んでくれてありがとうございます。他のエコシステムと比較し、後発でまだまだ未成熟なFUSOUに興味を持っていただけたことに感謝します。

さて、このページではFUSOU-APPの開発環境をセットアップし、ローカルで動かすまでの手順を説明します。以下の手順に従ってセットアップを進めてください。

## 動作環境

- Windows 11 (latest)
- Ubuntu 24.04 LTS

**以上のOSでの動作を確認していますが、他のバージョン、ディストリビューションで動く可能性があります(特にLinux)。ぜひ動作確認にご協力ください。**

<aside note>
   INFO

FUSOU-APPはElectronを使用しており、Node.jsとChromiumを組み合わせてデスクトップアプリケーションを構築しています。

</aside>

開発者はmacOSを持っていないため、macOSでの開発、動作確認はできていません。

### 推奨ツール

- Volta などのバージョンマネージャー
- VS Code と主要プラグイン（ESLint、Prettier、Astro）
- Docker（バックエンド連携が必要な場合）
- GitHub CLI
- Postman（API テスト用）

### 確認ポイント

- Node と pnpm のバージョンがプロジェクトの `.tool-versions` と一致しているか
- Git のユーザー情報が正しく設定されているか
- SSH キーが GitHub に登録されているか
- Docker が起動しているか（必要な場合）

## セットアップ手順

1. リポジトリをクローン
   ```bash
   git clone https://github.com/example/FUSOU.git
   cd FUSOU
   ```
2. 依存関係をインストール
   ```bash
   pnpm install
   ```
3. 環境変数をコピー
   ```bash
   cp .env.example .env
   ```
4. 静的解析を実行
   ```bash
   pnpm lint
   ```
5. Storybook など UI カタログを起動（必要に応じて）
   ```bash
   pnpm --filter shared-ui storybook
   ```
6. 型チェック
   ```bash
   pnpm typecheck
   ```
7. テストの実行
   ```bash
   pnpm test
   ```
8. Docker コンテナの起動（バックエンド連携時）
   ```bash
   docker compose up -d
   ```
9. API エンドポイントの疎通確認
   ```bash
   curl http://localhost:4000/api/health
   ```
10. GitHub Actions のワークフロー確認
    - `.github/workflows` 配下のファイルをチェック

## 開発サーバーを起動

```bash
pnpm --filter FUSOU-APP dev
```

### サーバー起動時のトラブルシューティング

- ポート競合の場合は `.env` の PORT を変更
- 依存関係エラーは `pnpm install --force` で再インストール
- キャッシュクリアは `pnpm store prune`

## 実行中に確認したいこと

- ブラウザで `http://localhost:3000` を開き、トップページとドキュメントページを確認
- コンソールやターミナルに警告が出ていないか監視
- ホットリロードが機能しているか、スタイル変更で確認
- API 通信が正常に行われているか、ネットワークタブで確認
- エラー表示コンポーネントの動作確認

### 開発中の Tips

- VS Code の「Format on Save」を有効化
- コミット前に `pnpm lint` と `pnpm typecheck` を必ず実行
- PR 作成時は説明文を詳細に記載

## ビルドと確認

```bash
pnpm --filter FUSOU-APP build
pnpm --filter FUSOU-APP preview
```

### ビルド時の注意点

- ビルド成果物は `dist/` 配下に生成
- Astro サイトは `FUSOU-WEB/dist/` に出力
- 環境変数の設定ミスに注意

## プロジェクト構成の目安

```text
FUSOU/
├─ packages/
│  ├─ FUSOU-APP/       # SolidJS アプリケーション
│  ├─ FUSOU-WEB/       # Astro ドキュメントサイト
│  ├─ shared-ui/       # 共通 UI コンポーネント
│  └─ configs/         # ESLint や Prettier 等の設定群
├─ docs/               # プロジェクト全体のドキュメント
├─ .github/            # CI/CD ワークフロー
└─ .env.example        # 環境変数サンプル
```

### 各ディレクトリの役割

- `FUSOU-APP`: メインアプリケーション
- `FUSOU-WEB`: ドキュメントサイト
- `shared-ui`: UI コンポーネントの共有
- `configs`: 設定ファイル群
- `docs`: 技術・運用ドキュメント
- `.github`: GitHub Actions など CI/CD 設定

## 主要コマンド一覧

| 目的                   | コマンド                            | 備考                             |
| ---------------------- | ----------------------------------- | -------------------------------- |
| 依存関係のインストール | `pnpm install`                      | 初回セットアップ時               |
| ドキュメント開発       | `pnpm --filter FUSOU-WEB dev`       | Astro サイトのホットリロード     |
| 型チェック             | `pnpm typecheck`                    | 型定義の一括検証                 |
| テスト                 | `pnpm test -- --watch`              | ウォッチモードでのユニットテスト |
| 依存関係の更新         | `pnpm up --latest`                  | 必要に応じて限定的に実行         |
| Storybook 起動         | `pnpm --filter shared-ui storybook` | UI カタログ                      |
| Lint                   | `pnpm lint`                         | 静的解析                         |
| Preview                | `pnpm --filter FUSOU-APP preview`   | 本番ビルドの確認                 |
| Docker 起動            | `docker compose up -d`              | バックエンド連携                 |

## トラブルシューティング

- **依存関係の競合が起きる**: `pnpm store prune` でキャッシュを整理してから再インストール
- **ビルドが失敗する**: `pnpm --filter <pkg> build --verbose` で詳細ログを取得し、環境変数の設定を確認
- **スタイルが反映されない**: グローバル CSS と component-scoped CSS の優先順位を再確認し、開発サーバーを再起動
- **API 通信が失敗する**: `.env` の API_URL を確認し、バックエンドが起動しているかチェック
- **CI/CD が失敗する**: GitHub Actions のログを確認し、必要な Secrets が設定されているか確認
- **Storybook が起動しない**: `shared-ui` の依存関係を再インストール

## よくある質問（FAQ）

### Q. Windows でセットアップがうまくいきません

A. WSL2 の利用を推奨します。パスの区切りや権限設定に注意してください。

### Q. pnpm のコマンドが見つかりません

A. `npm install -g pnpm` でグローバルインストールしてください。

### Q. Astro のバージョンを上げても大丈夫ですか？

A. 主要パッケージの互換性を確認し、`pnpm up astro` でアップデート後に `pnpm typecheck` と `pnpm test` を実行してください。

## 運用ガイド

- コミットメッセージは Conventional Commits に従う
- PR は必ずレビューを通す
- main ブランチへの直接 push を禁止
- 定期的に `pnpm audit` で脆弱性チェック

## 拡張案

- 多言語対応（i18n）の導入
- E2E テストの追加（Playwright など）
- パフォーマンス計測（Lighthouse, Web Vitals）
- Sentry などのエラー監視ツール導入

## コミュニティ・サポート

- [GitHub Discussions](https://github.com/example/FUSOU/discussions)
- Slack チャンネル（招待は README 参照）
- 定期的なオンラインミートアップ開催

## 参考リンク

- [Astro 公式ドキュメント](https://docs.astro.build/)
- [SolidJS ガイド](https://www.solidjs.com/guides)
- [pnpm CLI リファレンス](https://pnpm.io/cli/overview)
- [GitHub Actions ドキュメント](https://docs.github.com/ja/actions)
- [Docker Compose 入門](https://docs.docker.com/compose/)

## 次のステップ

- `docs/start` 配下に新しい記事を追加
- 見出しとコードブロックのスタイルをチェック
- ナビゲーションメニューの動作を確認
- パフォーマンス計測のために Lighthouse を実行
- CI で利用するワークフローファイルを確認
- コンポーネントのアクセシビリティチェックを自動化
- E2E テストのサンプルを追加
- Storybook で UI コンポーネントを拡充
- コミュニティへの質問・提案を投稿
- ドキュメントの多言語化を検討
- Sentry など監視ツールの導入
- バージョン管理・リリースノートの運用開始
- 開発環境の Docker 化
- 新規メンバー向けオンボーディング資料作成
- 定期的なコードリファクタリング
- 主要依存パッケージのアップデート計画
- セキュリティチェックリストの作成
- API ドキュメントの自動生成
- テストカバレッジレポートの導入
- GitHub Discussions でフィードバック収集
