# 開発・運用・リリース実行スクリプト手順書

## 1. 目的

この文書は「確認観点」ではなく、「実行しないと開発やデプロイが進まないスクリプト」を対象にした実行手順書です。

特に以下を明確化します。

- デプロイブロッカーになる必須スクリプト
- ローカルで実データを使うための seed 手順
- 変更内容ごとの実行順

---

## 2. 共通前提（最初に 1 回）

1. リポジトリルートで依存を入れる。

```bash
cd <repo-root>
pnpm install
```

1. Cloudflare 操作用の認証を通す。

```bash
npx wrangler login
```

1. 必要時に dotenvx の暗号化環境を復号する。

```bash
cd <repo-root>
pnpm run env.decrypt
```

1. ツールチェーンの前提を満たす。

- Node.js: 22.16 以上
- pnpm: 10.14 以上
- Rust/Cargo
- Wrangler

---

## 3. FUSOU-WEB デプロイで実行必須のスクリプト

### 3.1 実行コマンド（これを実行する）

```bash
pnpm --dir packages/FUSOU-WEB run deploy
```

この 1 コマンドが、以下の必須処理を順番に実行します。

1. `pnpm --filter @fusou/avro-wasm run build`
1. `pnpm run generate:all`
1. `pnpm run check:security:dom`
1. `astro check`
1. `astro build`
1. `wrangler deploy`

### 3.2 途中で呼ばれる重要スクリプト

`generate:all` の中身:

1. `generate:rust-data`
1. `generate:graph-data`

`generate:rust-data` の中身:

1. `cd ../kc_api && bash scripts/generate-schemas.sh`
1. `cargo test -p kc-api-dto test_struct_dependency_syn -- --nocapture`
1. `cargo test -p kc-api-database test_database_dependency_syn -- --nocapture`

実務上の意味:

- ここが失敗すると WEB build が止まる
- スキーマ更新時は特に必須
- `generate-schemas.sh` は `bash` を使うため、Windows では Git Bash/WSL が必要

### 3.3 やってはいけない実行

- `wrangler deploy` だけを単独で実行しない

理由:

- `avro-wasm` build
- schema/graph 生成
- DOM セキュリティ差分検査
- Astro 型検査

が抜けた状態で古い成果物を配備するリスクがあるため。

---

## 4. ローカル開発で実データを使う seed 実行手順

## 4.1 Simulator 最小構成（まずこれ）

```bash
pnpm --filter @fusou/avro-wasm run build
pnpm --dir packages/FUSOU-WEB run seed:master-data
pnpm --dir packages/FUSOU-WEB run dev
```

補足:

- データ不足時は `seed:master-data:all` を使う
- seed 後に `ships: 0, equips: 0` のままなら dev server を再起動する

## 4.2 実データ寄せフル構成

```bash
pnpm --dir packages/FUSOU-WEB run seed:master-data:all
pnpm --dir packages/FUSOU-WEB run seed:assets
pnpm --dir packages/FUSOU-WEB run seed:fleet-data -- --all
pnpm --dir packages/FUSOU-WEB run seed:battle-data -- --period latest
pnpm --dir packages/FUSOU-WEB run seed:ship-growth-data -- --db dev-kc-ship-growth --period latest
```

各 seed の前提:

- `seed:assets`: `../../FUSOU-PROXY-DATA` が存在すること。ない場合は `PROXY_DATA_DIR` 環境変数を指定する。

- `seed:fleet-data`: `npx wrangler login` 済みで、Cloudflare API Token/Account または Wrangler OAuth が使えること。

- `seed:battle-data`: `PUBLIC_SUPABASE_URL` と `SUPABASE_SECRET_KEY` が必要。`--period all` は投入量が増えるため用途限定。

- `seed:ship-growth-data`: `--db` 指定が必須。archive 同期不要なら `--no-r2` を利用可能。

## 4.3 CDN 直参照モード（バナー画像本体を seed しない運用）

`.dev.vars` で `ASSET_BASE_URL` を設定している場合は、ローカル R2 へ画像を全部入れずに D1 キーだけ同期できます。

```bash
pnpm --dir packages/FUSOU-WEB run sync:banners
```

実行後は Astro dev server を再起動すること。

## 4.4 装備シナジー検出データのアップロード（手動実行時）

この処理は `pnpm --dir packages/FUSOU-WEB run deploy` には含まれないため、対象期間を更新したときは別途実行する。

### 4.4.1 実行が必要になる条件

- `period-tag` が切り替わった（新しい `main.js` / `api_start2` を使う）。
- `equip_synergy_detector` のロジック更新で `slot_item_effects.json` が変わった。
- シナジー manifest を更新しないと本番が古い組み合わせデータを参照する。

### 4.4.2 ローカル・開発環境への生成とアップロード（基本）

最新の `period-tag` を自動検出して生成し、ローカル・開発環境（development）へアップロードします。

```bash
cd packages/equip_synergy_detector
pnpm run generate:latest
```

特定の `period-tag` を指定する場合:

```bash
cd packages/equip_synergy_detector
pnpm run generate:latest -- --period-tag <YYYY-MM-DD>
```

### 4.4.3 生成のみ（アップロードなし）

```bash
cd packages/equip_synergy_detector
pnpm run generate:latest:noupload
```

### 4.4.4 本番環境へのアップロード（既存の生成済みデータを使用）

本番環境（production）へのアップロードは、すでに生成済みのJSONデータがある前提で以下のコマンドを実行します。

```bash
cd packages/equip_synergy_detector
pnpm run upload:remote
```

同一データによるスキップ（409 Duplicate）を無視して強制的にアップロード日時を最新にする場合:

```bash
cd packages/equip_synergy_detector
pnpm run upload:remote:force
```

### 4.4.6 必須前提

- `npx wrangler login` 済みであること（R2 upload に必要）。
- `packages/FUSOU-WEB/.env` と `packages/.env.keys` が解読可能な状態であること。
- `ADMIN_TOKEN` と `MASTER_DATA_BUCKET_NAME` が解決できること。
- production 向けは `PUBLIC_SITE_URL_PRODUCTION` が解決できること。
- `generate:latest` 等を使う場合は `packages/FUSOU-PROXY-DATA/<period-tag>/` 配下に `kcs2/js/main.js` と `kcsapi/*@api_start2@getData*` があること。

---

## 5. FUSOU-WORKFLOW の実行手順

### 5.1 コード変更のみ（スキーマ変更なし）

```bash
pnpm --dir packages/FUSOU-WORKFLOW run test
pnpm --dir packages/FUSOU-WORKFLOW run deploy
```

### 5.2 D1 スキーマ変更あり

```bash
pnpm --dir packages/FUSOU-WORKFLOW run schema:remote
pnpm --dir packages/FUSOU-WORKFLOW run deploy
```

ローカル確認のみなら:

```bash
pnpm --dir packages/FUSOU-WORKFLOW run schema:local
```

### 5.3 kc_api schema 連動変更あり

```bash
pnpm --dir packages/FUSOU-WORKFLOW run generate:schemas
pnpm --dir packages/FUSOU-WORKFLOW run deploy
```

補足:

- `generate:schemas` は内部で `packages/kc_api/scripts/generate-schemas.sh` を実行し、`packages/configs/fingerprints.json` まで再生成する。
- fingerprint のみ再生成したい場合だけ、`pnpm --dir packages/FUSOU-WORKFLOW run generate:fingerprints` を実行する。

---

## 6. Rust 構造体変更時の TS 型 export

### 6.1 実行が必要になる条件

以下のいずれかに該当したら TS 型 export を実行する。

- `packages/kc_api/crates/kc-api-interface/src/**` の `#[ts(export, export_to = "...")]` 付き構造体/enum を変更した。
- `packages/kc_api/bindings/*.ts` の出力対象になる Rust 型を追加・削除・リネームした。
- Rust 側の型変更を TS 側に反映する PR で、bindings 差分を明示したい。

### 6.2 標準コマンド

```bash
cd packages/kc_api
just export-ts
```

このコマンドが実施する内容:

1. `cargo test export_bindings`
1. `crates/kc-api-interface/bindings` から `packages/kc_api/bindings` へコピー
1. `bigint -> number` 置換（`util/replace.sh`）

### 6.3 `just` がない環境の代替

代替手順は `bash` 前提（Git Bash/WSL）:

```bash
cd packages/kc_api
cargo test export_bindings
cp -r ./crates/kc-api-interface/bindings/. ./bindings
rm -r ./crates/kc-api-interface/bindings
sh util/replace.sh ./bindings/battle.ts
sh util/replace.sh ./bindings/cells.ts
sh util/replace.sh ./bindings/get_data.ts
sh util/replace.sh ./bindings/map_info.ts
sh util/replace.sh ./bindings/port.ts
sh util/replace.sh ./bindings/quest.ts
sh util/replace.sh ./bindings/require_info.ts
```

### 6.4 実行後に確認すること

- `packages/kc_api/bindings/*.ts` の差分が Rust 側の変更意図と一致している。
- 不要な手編集が入っていない（generated header が維持されている）。

---

## 7. fingerprint 再生成条件

### 7.1 再生成が必須になる条件

以下のいずれかに該当したら再生成する。

- `packages/kc_api/crates/kc-api-database/src/**` を変更した。
- `packages/kc_api/crates/kc-api-database/Cargo.toml` の `schema_v*` feature を追加/変更した。
- `packages/kc_api/generated-schemas/schema_v*.json` を更新した。
- `packages/FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs` を変更した。
- CI の `validate_schema_chain` で `Schema drift` または `Fingerprint drift` が出た。

### 7.2 標準コマンド

```bash
pnpm --dir packages/FUSOU-WORKFLOW run generate:schemas
```

必要時のみ追加:

```bash
pnpm --dir packages/FUSOU-WORKFLOW run generate:fingerprints
```

### 7.3 再生成の結果として更新される主なファイル

- `packages/kc_api/generated-schemas/schema_v*.json`
- `packages/kc_api/generated-schemas/master_schema_v*.json`
- `packages/configs/fingerprints.json`

### 7.4 schema_version 連動ルール

`packages/kc_api/crates/kc-api-database/src/models/` や `table/encode/decode/integrate` 系を変更した場合は、`schema_version.rs` の更新要否を必ず判断する。

---

## 8. FUSOU-APP リリース系で止まりやすいポイント

APP リリースは GitHub Actions（`publish_and_create_version_tag.yml`）が正系です。

### 8.1 手動実行前の必須条件

- `packages/FUSOU-APP/package.json` の `version` を `x.y.z` 形式で更新済みであること。
- 直近の公開タグ `fusou-v*` より version が単調増加していること。
- 以下の GitHub Secrets が有効であること: `DOTENV_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 8.2 GitHub Actions での公開手順（タグ作成込み）

1. GitHub の Actions タブで `publish_and_create_version_tag` を開く。
1. `Run workflow`（`workflow_dispatch`）を実行する。
1. `create-release` が `fusou-v<version>` タグ付き draft release を作ることを確認する。
1. `build-tauri`（各プラットフォーム）と `verify-updater-manifest` が成功することを確認する。
1. `publish-release` が成功し、release が `draft: false` / `prerelease: false` になることを確認する。

補足:

- 手動で `git tag` を打って push する運用は不要。
- version 形式や増分が不正な場合、`check version` ステップで停止する。

### 8.3 fusou-datasets を公開する場合（対象変更時のみ）

`packages/fusou-datasets/python` を公開する場合は、`publish-fusou-datasets.yml` を実行する。

実行方法:

1. GitHub の Actions タブで `Publish fusou-datasets to PyPI` を開く。
1. `Run workflow`（`workflow_dispatch`）を実行する。

補足:

- `release` トリガーで実行する場合、タグは `v<pyproject.toml の version>` と一致しないと停止する。
- PyPI 反映確認は workflow 内の `test-install` ジョブまで完走すること。

CI で実際に通している必須処理:

1. `packages/shared-ui` の build
1. Tauri ビルド（複数プラットフォーム）
1. updater manifest 検証（`.github/scripts/verify-updater-manifest.sh`）

ローカルで事前検証する場合:

```bash
pnpm --dir packages/shared-ui run build
pnpm --dir packages/FUSOU-APP run check.tsc
pnpm --dir packages/FUSOU-APP run tauri build
```

---

## 9. 変更種別ごとの実行セット（最短版）

| 変更種別                                 | 実行コマンド                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WEB 本番反映                             | `pnpm --dir packages/FUSOU-WEB run deploy`                                                                                                                                                                                                                                                                  |
| WEB ローカル実データ（最小）             | `pnpm --dir packages/FUSOU-WEB run seed:master-data`                                                                                                                                                                                                                                                        |
| WEB ローカル実データ（フル）             | `seed:master-data:all`, `seed:assets`, `seed:fleet-data -- --all`, `seed:battle-data`, `seed:ship-growth-data`                                                                                                                                                                                              |
| WEB シナジー period 更新                 | `cd packages/equip_synergy_detector && pnpm run generate:latest` （本番反映時は `pnpm run upload:remote`）                                                                                                                                                                                                                       |
| Rust interface 構造体変更（TS 連動あり） | `cd packages/kc_api && just export-ts`                                                                                                                                                                                                                                                                      |
| schema/fingerprint 連動変更              | `pnpm --dir packages/FUSOU-WORKFLOW run generate:schemas`                                                                                                                                                                                                                                                   |
| 匿名同期 UUID cutover                    | `purge:r2-fleet-data` と `purge:d1-member-data` の remote inventory、Supabase UUID cutover migration のみ apply、postflight を実行。D1/R2 は保持する。詳細は `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md` |
| Workflow 本番反映                        | `pnpm --dir packages/FUSOU-WORKFLOW run test && pnpm --dir packages/FUSOU-WORKFLOW run deploy`                                                                                                                                                                                                              |
| Workflow スキーマ反映あり                | `pnpm --dir packages/FUSOU-WORKFLOW run schema:remote && pnpm --dir packages/FUSOU-WORKFLOW run deploy`                                                                                                                                                                                                     |
| APP タグ付き公開リリース                 | `GitHub Actions: publish_and_create_version_tag を workflow_dispatch`                                                                                                                                                                                                                                       |
| fusou-datasets PyPI 公開（対象時のみ）   | `GitHub Actions: Publish fusou-datasets to PyPI を workflow_dispatch`                                                                                                                                                                                                                                       |

---

## 10. 関連文書

- `docs/operations/deployment.md`
- `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md`
- `docs/operations/web/ANON_SYNC_V2_PEPPER_SUPABASE_RUNTIME_GUIDE.md`
- `docs/operations/workflow/AVRO_CLOUDFLARE_DEPLOYMENT.md`
- `packages/equip_synergy_detector/README.md`
- `.github/workflows/validate_schema_chain.yml`
- `.github/workflows/fusou-web-e2e-simulator.yml`
- `.github/workflows/publish_and_create_version_tag.yml`
- `.github/workflows/publish-fusou-datasets.yml`

---

## 11. 実行チェックリスト（運用向け）

### 11.1 実験データ収集 API を停止する

対象フラグと ingest エンドポイント対応:

| フラグ                                       | 対応 ingest                       | 停止時の想定                                |
| -------------------------------------------- | --------------------------------- | ------------------------------------------- |
| `QUEST_TREE_EXPERIMENTAL_COLLECTION_ENABLED` | `/api/quest-tree/ingest`          | 503 (`Quest tree collection is disabled`)   |
| `REMODEL_DATA_COLLECTION_ENABLED`            | `/api/remodel-data/ingest`        | 503 (`Remodel data collection is disabled`) |
| `SHIP_GROWTH_COLLECTION_ENABLED`             | `/api/ship-growth/ingest`         | 503 (`Ship growth collection is disabled`)  |
| `SOKU_SPEED_COLLECTION_ENABLED`              | `/api/soku-speed-observed/ingest` | 503 (`Soku speed collection is disabled`)   |

反映経路は 2 通りある。緊急停止は (A) を推奨。

- (A) Cloudflare Workers Dashboard で同名 var を override（Dashboard 値が bundle 値を上書きする。再デプロイ不要、次リクエストから反映）。
- (B) `packages/FUSOU-WEB/.env`（dotenvx 暗号化）を更新し、再エンクリプト後に再デプロイ。

チェック項目:

- [ ] 停止対象を決める（4 系統を全部止めるか、個別に止めるか）。
- [ ] 反映経路 (A) か (B) を選ぶ。
- [ ] (A) の場合: Workers Dashboard の Environment Variables で対象フラグを `false` に設定する。
- [ ] (B) の場合: `.env` を更新し、`pnpm --dir packages/FUSOU-WEB run deploy` を実行する。
- [ ] 対象 ingest に POST し、503 (`* collection is disabled`) で停止していることを確認する。
- [ ] 非対象 ingest は継続稼働していることを確認する。
- [ ] 停止理由・期間・担当を運用ログに残す。

### 11.2 実験データ収集 API を再開する

チェック項目:

- [ ] 再開対象フラグを `true` に戻す（(A) Dashboard の override を削除 or `true`、もしくは (B) `.env` 更新後に再デプロイ）。
- [ ] (B) の場合は `pnpm --dir packages/FUSOU-WEB run deploy` を実行する。
- [ ] 対象 ingest への POST が 200/204 系で受理され、503 でなくなったことを確認する。
- [ ] 任意: `pnpm --dir packages/FUSOU-WEB run check:experimental-data` を実行し、本番 D1 に新しい行が積み上がり始めたことを確認する（`--remote` で本番 D1 を参照する診断スクリプト）。

### 11.3 匿名同期 UUID public_id cutover

詳細手順は `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md` を正とする。これは旧 pepper/PID の rotation ではなく、member-owned data と旧 Vault secret を削除する一回限りの破壊的 cutover である。

チェック項目（実行順）:

- [ ] UUID-only の Worker / APP を用意し、fleet write と registration/refresh を凍結する。
- [ ] バックアップ / export のアクセス制限、保存期限、破棄担当を記録する。
- [ ] Vault の対象 secret 名を値なしで count-only 確認する。
- [ ] `pnpm --dir packages/FUSOU-WEB run purge:r2-fleet-data` を実行し、固定 `dev-kc-fleets/fleets/` の件数を inventory する。R2 object は保持する。
- [ ] `pnpm --dir packages/FUSOU-WEB run purge:d1-member-data` を実行し、固定 D1 database の table / row / column を inventory する。D1 data は保持する。
- [ ] inventory の結果と保持範囲が承認内容と一致することを確認する。
- [ ] R2/D1 の `--apply` は実行しない。
- [ ] `supabase db push --linked --dry-run` の結果を確認し、明示承認後に migration を適用する。
- [ ] `auth.users` / `kc_period_tag` が保持され、legacy table/function/policy/publication と versioned legacy Vault secret の残数が 0 であることを確認する。
- [ ] UUID registration/refresh、旧 token 拒否、ownership collision、fleet upload/download、Realtime payload、通常ログインの smoke test を実行する。
- [ ] smoke test 後に freeze を解除し、実行者、承認者、UTC 時刻、件数、未検証項目を記録する。

### 11.4 APP タグ付き公開

チェック項目:

- [ ] `packages/FUSOU-APP/package.json` の `version` が単調増加になっている。
- [ ] GitHub Actions で `publish_and_create_version_tag` を `workflow_dispatch` 実行する。
- [ ] `create-release` が `fusou-v<version>` の draft を作成したことを確認する。
- [ ] `build-tauri` と `verify-updater-manifest` が成功したことを確認する。
- [ ] `publish-release` 成功後に `draft: false` / `prerelease: false` を確認する。
