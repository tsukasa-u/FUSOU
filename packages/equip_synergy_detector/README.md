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

## 🚀 AST生成とR2アップロード (Unified Pipeline)

旧来の `scan` コマンド類は廃止され、AST(Abstract Syntax Tree)をベースにした抽出へと全面的に移行しました。
現在は `FUSOU-PROXY-DATA` に保存されている最新のプロキシデータを自動で検知し、一括で生成・アップロードが可能です。

既定値は、今回の実測で「最速かつ参照結果と一致」と確認できた構成に寄せています。

- strict N-1: 有効固定
- duplicate items: 有効固定
- workers 既定値: 最大 8
- schedule shards 既定値: 256
- Node 実行バイナリ: `FUSOU_SCAN_NODE_BIN` 未指定時は Node 24.18.0 を優先探索

`workers=16` 系は strict + duplicate mode でも参照結果との差分が確認されたため、既定値から外しています。

### 1. ローカルR2（開発環境）へアップロード

ローカルの Cloudflare R2 エミュレータ（Miniflare）にアップロードする場合：

```bash
pnpm run generate:latest
```

- 内部で `generate-synergy-latest.sh` を実行し、最新の period-tag を自動検知します。
- その後 `upload:local` を呼び出し、生成された `slot_item_effects_YYYY-MM-DD.json` をアップロードします。

### generate-synergy-latest の実行オプション（引数優先）

`generate:latest` / `generate:latest:noupload` は、`scripts/generate-synergy-latest.sh` に引数を渡して制御できます。

デフォルト（引数未指定）は、検証済みの strict + duplicate mode です。
AST候補フィルターはデフォルト有効（`all`）です。

- `strict-nminus1`: 有効（`--strict-nminus1` 相当）
- `duplicate items`: 有効（`--allow-duplicate-items` 相当）
- `max combo size`: `6`
- `threads`: `min(論理CPU数, 8)`
- `schedule shards`: `256`

主なオプション:

- `--threads <N>`: 並列ワーカー数
- `--schedule-shards <N>`: 動的スケジューリング用シャード数（既定値 `256`）
- `--progress-interval-ms <N>`: 進捗集約ログの更新間隔
- `--max-old-space-mb <N>`: 各ワーカーの Node ヒープ上限
- `--v8-flags "<flags>"`: Node/V8 フラグを子プロセスへ渡す
- `--profile-v8`: `--prof` を有効化して V8 プロファイルを出力
- `--max-combo-size <2..6>`
- `--period-tag <YYYY-MM-DD>`: 最新ではなく指定 period_tag を処理
- `--ships <csv>`: 対象艦IDを限定
- `--ship-range <start-end>`: 対象艦IDを範囲指定（例: `500-700`）
- `--ast-candidate-ships <csv|all>`: AST条件一致装備の候補集合で絞り込む艦ID（例: `662,663,668`）
- `--no-ast-candidate-ships`: AST候補フィルターを無効化
- `--strict-nminus1` / `--no-strict-nminus1`
- `--allow-duplicate-items` / `--no-allow-duplicate-items`

環境変数でも同様に指定できます:

- `SCAN_AST_AST_CANDIDATE_SHIPS=662,663,668`
- `SCAN_AST_DISABLE_CANDIDATE_FILTER=1`
- `SCAN_PERIOD_TAG=2026-07-08`

### period_tag を pnpm script で指定する方法

`generate:latest` 系は名前に latest とありますが、`--period-tag` を渡した場合はその tag を優先して処理します。

指定方法（pnpm の引数フォワード）:

```bash
# 生成のみ（アップロードなし）
pnpm run generate:latest:noupload -- --period-tag 2026-07-08

# 生成 + local upload
pnpm run generate:latest -- --period-tag 2026-07-08

# 生成 + local upload（AST候補フィルター無効）
pnpm run generate:latest -- --period-tag 2026-07-08 --no-ast-candidate-ships

# 無効化専用スクリプト（period_tag は環境変数で指定）
SCAN_PERIOD_TAG=2026-07-08 pnpm run generate:latest:nofilter
```

環境変数で指定する場合:

```bash
SCAN_PERIOD_TAG=2026-07-08 pnpm run generate:latest:noupload

# AST候補フィルター無効
SCAN_AST_DISABLE_CANDIDATE_FILTER=1 pnpm run generate:latest:noupload

# 無効化専用スクリプト（noupload）
SCAN_PERIOD_TAG=2026-07-08 pnpm run generate:latest:nofilter:noupload
```

注意:

- `--period-tag` と `SCAN_PERIOD_TAG` の両方を指定した場合、引数 `--period-tag` が優先されます。
- 指定 tag のディレクトリが `FUSOU-PROXY-DATA/<period_tag>` に存在しない場合はエラー終了します。

例（厳格モードを維持しつつ 8 ワーカーで実行）:

```bash
bash scripts/generate-synergy-latest.sh \
  --threads 8 \
  --strict-nminus1 \
  --allow-duplicate-items \
  --max-combo-size 6 \
  --max-old-space-mb 4096
```

600〜650 の艦だけを対象にする例:

```bash
bash scripts/generate-synergy-latest.sh \
  --ship-range 600-650 \
  --ast-candidate-ships 662,663,668 \
  --threads 8 \
  --strict-nminus1 \
  --allow-duplicate-items \
  --max-combo-size 6 \
  --max-old-space-mb 4096 \
  --schedule-shards 256
```

3艦で AST 候補フィルタ有効/無効を比較する最小手順:

```bash
# フィルタ無効
bash scripts/generate-synergy-latest.sh \
  --ships 662,663,668 \
  --threads 3 \
  --max-combo-size 3

# フィルタ有効（指定艦のみ）
bash scripts/generate-synergy-latest.sh \
  --ships 662,663,668 \
  --ast-candidate-ships 662,663,668 \
  --threads 3 \
  --max-combo-size 3
```

V8 最適化やプロファイルの例:

```bash
bash scripts/generate-synergy-latest.sh \
  --ship-range 500-700 \
  --threads 8 \
  --v8-flags "--always-turbofan --max-opt --no-lazy" \
  --profile-v8
```

補足:

- `--threads > 1` の場合は `scan-ast-parallel.js` が動作し、艦ごとの推定テスト数に基づく重み付き動的スケジューリングで割り当てます。
- `--threads` 未指定時は、検証済みの安全側既定値として `min(論理CPU数, 8)` を使用します。
- 進捗はワーカーごとの生ログをそのまま混在出力せず、集約されたリアルタイム進捗を表示します。
- 進捗表示には、実行中の艦ID/艦名、シャードID、推定テスト数、実テスト数、進捗率、最後に受け取ったログ行、アイドル秒数が出ます。
- 推定テスト数は `output/scan_estimated_tests_<period>.json` に出力されます。
- 範囲指定での検証例: `--ship-range 500-700`。

## AST解析は何に使っているか

`scripts/core/extract-ast.js` は、難読化解除後の `deobfuscated.js` を `acorn` でパースし、装備ボーナスの条件テーブルと判定関数名を静的に抽出して `synergy_dict*.json` を作るために使っています。

- 役割: 後段で探索すべきルール候補の絞り込み
- 効果がある場所: 全バンドルを毎回総当たりで実行する前処理を軽くする
- 効果が限定される場所: 実際の組み合わせ列挙、strict N-1 判定、duplicate-item 判定の本体コストは `scan-ast.js` に残る

今回の高速化で効いた主因は AST 自体ではなく、`scan-ast.js` 側の ship ごとの rule index 化と、正しさが確認できた並列度への固定です。

### 2. リモートR2（本番環境）へアップロード

本番環境の Cloudflare R2 バケットへアップロードする場合：

```bash
pnpm run upload:remote
```

- 事前に `generate:latest` などで最新の JSON を生成しておく必要があります。
- 自動的に `output/` 内の最新の JSON を検知し、本番環境の R2 にアップロードします。
- `ADMIN_TOKEN` 環境変数が正しく設定されている必要があります。

### 個別コマンド

- `pnpm generate:latest`
  - 既定では最新の period-tag を処理。`-- --period-tag YYYY-MM-DD` を渡すと指定 tag を処理し、ローカルR2へアップロード。
- `pnpm generate:latest:noupload`
  - 既定では最新の period-tag を処理。`-- --period-tag YYYY-MM-DD` を渡すと指定 tag を処理（アップロードなし）。
- `pnpm generate:latest:600-650:noupload`
  - 最新の period-tag を、艦ID 600〜650 に限定して生成（アップロードなし）。
- `pnpm generate:all`
  - 存在するすべての period-tag について AST を抽出して生成（アップロードはしない）。
- `pnpm verify:best:600-650`
  - 検証済みの最速・正確プリセットで 600〜650 を再生成し、参照結果と比較する。
- `pnpm upload:local`
  - 最新の JSON をローカルR2へアップロード（既定: Brotli payload）。
- `pnpm upload:local:force`
  - 重複409（同一 period + 同一ハッシュ）時も既存 revision で upload/complete を続行。
- `pnpm upload:local:no-br`
  - Brotli 圧縮を使わず、raw JSON payload でローカルR2へアップロード。
- `pnpm upload:local:no-br:force`
  - `upload:local:no-br` の force 版（重複409時も続行）。
- `pnpm upload:remote`
  - 最新の JSON を本番R2へアップロード。
- `pnpm upload:remote:dry`
  - 本番アップロードの計画のみ確認（dry-run）。
- `pnpm upload:remote:force`
  - 重複409（同一 period + 同一ハッシュ）時も既存 revision で upload/complete を強制続行。

## よくあるエラー

- `Error: --period-tag YYYY-MM-DD is required.`
  - `scan:upload` / `scan:upload:dry` 実行時に `-- --period-tag 2026-04-23` のように指定してください。

- `Target script not found: .../main.js`
  - `packages/equip_synergy_detector/main.js` が未配置です。`FUSOU-PROXY-DATA` からコピーしてください。

- `webcrack is not installed`
  - `pnpm install` を実行して依存関係をインストールしてください。
