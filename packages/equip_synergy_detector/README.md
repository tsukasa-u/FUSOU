# equip_synergy_detector

KanColle の `main.js` とマスターデータから装備シナジーを抽出し、アップロードするためのツールです。

## 前提

- 作業ディレクトリ: `packages/equip_synergy_detector`
- `pnpm` が使えること
- アップロード時は以下が存在すること
  - `packages/.env.keys`
  - `packages/FUSOU-WEB/.env`
- スキャン時は `packages/equip_synergy_detector/master_data/` に
  `api_start2` レスポンス由来ファイルが最低1つ存在すること

## 必要ツールのインストール

### 1. Node.js / pnpm

- Node.js 20 以上を推奨
- pnpm を未導入の場合:

```bash
npm install -g pnpm
```

### 2. パッケージ依存のインストール

`webcrack`（難読化解除）と `@dotenvx/dotenvx`（環境変数ロード）は
`equip_synergy_detector` の `devDependencies` に含まれています。

`packages/equip_synergy_detector` で以下を実行してください。

```bash
pnpm install
```

### 3. 導入確認（任意）

以下が表示されれば利用可能です。

```bash
pnpm exec webcrack --version
pnpm exec dotenvx --version
```

### 4. `wrangler` の補足（アップロード時）

`scan:upload` / `scan:upload:dry` は最終的に `FUSOU-WEB/scripts/upload-synergy.mjs`
を呼び、その中で `npx wrangler` を使って R2 へアップロードします。

- 通常は `npx` 経由で実行されるため、グローバルインストールは不要です。
- 初回のみ確認したい場合:

```bash
npx wrangler --version
```

## main.js の場所について

このリポジトリでは、ゲーム由来の `main.js` は通常 `packages/FUSOU-PROXY-DATA/<period-tag>/kcs2/js/main.js` にあります。

例:

- `packages/FUSOU-PROXY-DATA/2026-04-23/kcs2/js/main.js`

`scan:upload` / `scan:upload:dry` は `--period-tag` から
`FUSOU-PROXY-DATA/<period-tag>/kcs2/js/main.js` を自動探索して
`packages/equip_synergy_detector/main.js` に同期します。

手動で `scan` / `scan:main` を実行する場合のみ、事前コピーが必要です。

PowerShell 例:

```powershell
Copy-Item ..\FUSOU-PROXY-DATA\2026-04-23\kcs2\js\main.js .\main.js -Force
```

## master_data（api_start2）の配置

`scan` は `master_data/` 配下の `*api_start2*` ファイルを読み込みます。
`scan:upload` / `scan:upload:dry` は `--period-tag` から
`FUSOU-PROXY-DATA/<period-tag>/kcsapi/` を探索し、
`*@api_start2@getData*` の最新1件を `master_data/` へ自動同期します。

`No master data found in master_data/` が出た場合は、
`FUSOU-PROXY-DATA/<period-tag>/kcsapi/` に `*@api_start2@getData*` が
存在するか確認してください。

手動で `scan` を実行する場合向けに、以下のコピー例も使えます。

PowerShell 例（`getData` を優先して最新1件をコピー）:

```powershell
New-Item -ItemType Directory -Force .\master_data | Out-Null
$src = Get-ChildItem ..\FUSOU-PROXY-DATA\2026-04-23\kcsapi -File |
  Where-Object { $_.Name -like '*@api_start2@getData*' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
Copy-Item $src.FullName .\master_data\ -Force
```

Bash 例（Linux/macOS）:

```bash
mkdir -p master_data
cp "$(ls -t ../FUSOU-PROXY-DATA/2026-04-23/kcsapi/*@api_start2@getData* | head -n 1)" master_data/
```

## 推奨フロー（period-tag 更新時）

`<PERIOD_TAG>` は `YYYY-MM-DD` 形式で指定します。

### 1. main.js を難読化解除

```bash
pnpm deobfuscate
```

- 入力: `main.js`
- 出力: `output/deobfuscated.js`

### 2. dry-run で抽出 + アップロード確認

```bash
pnpm scan:upload:dry -- --period-tag <PERIOD_TAG>
```

- 内部で `scan.js --volatile-generated --period-tag <PERIOD_TAG>` を実行
- その後 `FUSOU-WEB/scripts/upload-synergy.mjs --dry-run` を実行
- 事前に `main.js` / `master_data(api_start2)` を自動同期し、
  `output/deobfuscated.js` が古い場合は自動で `deobfuscate` を実行

### 3. 本番アップロード

```bash
pnpm scan:upload -- --period-tag <PERIOD_TAG>
```

## 計算をスキップしてアップロードのみ実行

`scan`（Phase 1/2 の計算）を省略して、すでに生成済みの
`output/slot_item_effects.json` だけをアップロードしたい場合の手順です。

前提:

- `packages/equip_synergy_detector/output/slot_item_effects.json` が存在する
- ファイル内 `_meta` に `api_start2_batch_hash` と `generated` が入っている

dry-run（計算なし）:

```bash
pnpm upload:only:dry -- --period-tag <PERIOD_TAG>
```

- dry-run は API 呼び出しを行わないため、`ADMIN_TOKEN` は不要です。
- ただし plan 表示のために production では `PUBLIC_SITE_URL_PRODUCTION` と
  `MASTER_DATA_BUCKET_NAME` は解決可能である必要があります。

本番アップロード（計算なし）:

```bash
pnpm upload:only -- --period-tag <PERIOD_TAG>
```

重複409を成功扱いにする（`--force`）:

```bash
pnpm upload:only:force -- --period-tag <PERIOD_TAG>
```

- 同一 `period_tag` + 同一 SHA-256 が既に登録済みの場合、
  `--force` で既存 `period_revision` を再利用してアップロード工程を継続できます。
  既に `completed` 済みで `pending` ではない場合は、最終ステップで成功扱いになります。

補足:

- この手順は `main.js` / `master_data` の探索・同期や `deobfuscate` は実行しません。
- 入力 JSON を更新したい場合は `pnpm scan:upload` 系を使ってください。

## 個別コマンド

- `pnpm deobfuscate`
  - `main.js` を `output/deobfuscated.js` に変換
- `pnpm scan`
  - `output/deobfuscated.js` を使ってスキャン（デフォルト）
- `pnpm scan:main`
  - `main.js` を直接読み込んでスキャン
- `pnpm scan:volatile`
  - 変動値を固定しないスキャン
- `pnpm scan:deterministic`
  - 再現性重視スキャン（デフォルト `scan` と同等）
- `pnpm upload:only -- --period-tag <PERIOD_TAG>`
  - 既存 `output/slot_item_effects.json` を使ってアップロードのみ実行
- `pnpm upload:only:dry -- --period-tag <PERIOD_TAG>`
  - 計算をスキップし、アップロード計画のみ確認（dry-run）
- `pnpm upload:only:force -- --period-tag <PERIOD_TAG>`
  - 重複409（同一 period + 同一ハッシュ）時も既存 revision で upload/complete を続行する

## よくあるエラー

- `Error: --period-tag YYYY-MM-DD is required.`
  - `scan:upload` / `scan:upload:dry` 実行時に `-- --period-tag 2026-04-23` のように指定してください。

- `Target script not found: .../main.js`
  - `packages/equip_synergy_detector/main.js` が未配置です。`FUSOU-PROXY-DATA` からコピーしてください。

- `webcrack is not installed`
  - `pnpm install` を実行して依存関係をインストールしてください。
