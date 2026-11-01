# FUSOU-APP

FUSOU のデスクトップアプリケーション（GUI）パッケージです。  
Tauri v2 + SolidJS + Tailwind CSS で構築され、艦これの通信データのリアルタイム可視化、編成・装備・基地航空隊の管理、および収集データのアップロードを行います。

---

## 🛠 技術スタック

* **デスクトップ基盤**: Tauri v2
* **バックエンド**: Rust (2021 edition, Tokio)
* **フロントエンド**: SolidJS, Solid Router, Tailwind CSS v4, DaisyUI v5
* **コンポーネント管理 & テスト**: Storybook, Vitest, Playwright
* **パッケージマネージャー**: pnpm (Workspace)

---

## 🚀 開発環境のセットアップ

### 前提条件
* **Node.js**: >= 22.16.x
* **pnpm**: >= 10.14.x
* **Rust**: >= 1.81.x
* 各 OS 向けのビルドツールチェーン（Windows: C++ Build Tools, WebView2）

### 環境変数の準備
リポジトリルートで環境変数を復号するか、適切な `.env` ファイルを配置してください。
```bash
# ルートディレクトリで実行
pnpm env.decrypt
```

---

## 💻 主なスクリプト

| コマンド | 説明 |
| :--- | :--- |
| `pnpm dev` | フロントエンドの Vite 開発サーバーを起動 (ポート 5173) |
| `pnpm tauri dev` | Tauri デスクトップアプリを開発モードで起動 |
| `pnpm build` | フロントエンドのプロダクションビルド |
| `pnpm check.tsc` | TypeScript の型チェック (`tsc --noEmit`) |
| `pnpm lint` | ESLint によるコード検証 |
| `pnpm lint:fix` | ESLint による自動修正 |
| `pnpm format` | Prettier によるコードフォーマット検証 |
| `pnpm format:fix` | Prettier による自動整形 |
| `pnpm clippy` | Rust の静的解析 (`cargo clippy`) |
| `pnpm clippy:fix` | Rust の Clippy 自動修正 |
| `pnpm rustfmt` | Rust コードのフォーマット検証 |
| `pnpm test` | Vitest によるコンポーネントテストの実行 |
| `pnpm storybook` | Storybook 開発サーバーを起動 (ポート 6007) |
| `pnpm storybook.build` | Storybook の静的ビルド |

---

## 📂 ディレクトリ構成

```
FUSOU-APP/
├── src/                    # フロントエンド (SolidJS)
│   ├── assets/             # 静的画像・アセット
│   ├── components/         # 各種 UI コンポーネント (艦隊, 装備, 戦闘, クエスト等)
│   ├── css/                # スタイル定義
│   ├── pages/              # 画面ページ (App, Start, Settings 等)
│   ├── stories/            # Storybook ストーリー定義
│   └── utility/            # ユーティリティ、Context Provider、IPC ラッパー
├── src-tauri/              # バックエンド (Rust / Tauri v2)
│   ├── capabilities/       # Tauri v2 パーミッション・セキュリティスコープ設定
│   └── src/                # Rust ソースコード (パケットパース, 送信パイプライン等)
├── .storybook/             # Storybook 設定
├── vite.config.ts          # Vite & Vitest 設定
└── package.json            # パッケージ定義
```
