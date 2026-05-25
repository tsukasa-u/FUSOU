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

## 4.4 装備シナジー検出データの手動アップロード

この処理は `pnpm --dir packages/FUSOU-WEB run deploy` には含まれないため、対象期間を更新したときは別途実行する。

### 4.4.1 実行が必要になる条件

- `period-tag` が切り替わった（新しい `main.js` / `api_start2` を使う）。
- `equip_synergy_detector` のロジック更新で `slot_item_effects.json` が変わった。
- シナジー manifest を更新しないと本番が古い組み合わせデータを参照する。

### 4.4.2 dry-run（必須）

```bash
cd packages/equip_synergy_detector
pnpm scan:upload:dry -- --period-tag <YYYY-MM-DD>
```

### 4.4.3 本番アップロード

```bash
cd packages/equip_synergy_detector
pnpm scan:upload -- --period-tag <YYYY-MM-DD>
```

### 4.4.4 計算済み JSON を使う場合

```bash
cd packages/equip_synergy_detector
pnpm upload:only -- --period-tag <YYYY-MM-DD>
```

同一ハッシュで 409 が返る想定運用時のみ:

```bash
cd packages/equip_synergy_detector
pnpm upload:only:force -- --period-tag <YYYY-MM-DD>
```

### 4.4.5 必須前提

- `npx wrangler login` 済みであること（R2 upload に必要）。
- `packages/FUSOU-WEB/.env` と `packages/.env.keys` が解読可能な状態であること。
- `ADMIN_TOKEN` と `MASTER_DATA_BUCKET_NAME` が解決できること。
- production 向けは `PUBLIC_SITE_URL_PRODUCTION` が解決できること。
- `scan:upload` を使う場合は `packages/FUSOU-PROXY-DATA/<period-tag>/` 配下に `kcs2/js/main.js` と `kcsapi/*@api_start2@getData*` があること。

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
| WEB シナジー period 更新                 | `cd packages/equip_synergy_detector && pnpm scan:upload -- --period-tag <YYYY-MM-DD>`                                                                                                                                                                                                                       |
| Rust interface 構造体変更（TS 連動あり） | `cd packages/kc_api && just export-ts`                                                                                                                                                                                                                                                                      |
| schema/fingerprint 連動変更              | `pnpm --dir packages/FUSOU-WORKFLOW run generate:schemas`                                                                                                                                                                                                                                                   |
| 匿名同期ローテーション                   | `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- rotate-pepper --target-version v<N>`（dry-run）と `rotate-recovery`（dry-run）を確認し、各コマンドに `--confirm` を付けて適用。secret は環境変数必須（未設定は fail-fast）。詳細は `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md` §4.2 |
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

### 11.3 ソルト（pepper）ローテーション

この章の詳細手順は `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md` を正とする。Worker は Vault から RPC 経由で pepper/recovery を取得するため、ローテーションは `manage-anon-sync-vault` スクリプト（内部で Supabase RPC を呼び出す）で実行し、再デプロイは不要である。

誤操作を減らすため、運用コマンドは `manage-anon-sync-vault`（bootstrap / rotate / finalize）に一本化する。

安全注意:

- `manage-anon-sync-vault` は `--secret` / `--service-role-key` 引数を受け付けない。機密は必ず環境変数で渡す。
- `bootstrap-*` は `--initial-version v<N>` の明示指定が必須。
- `--secret-env <ENV_NAME>` を明示指定した場合、対象環境変数が未設定だと CLI は fail-fast で停止する（自動生成へフォールバックしない）。
- refresh/revoke の nonce 消費は DB テーブルで原子的に確定し、アプリ側が 30 分より古い行を定期クリーンアップする。
- シークレットごとの保存場所・更新手段・参照経路は `docs/operations/web/ANON_SYNC_V2_ROTATION_RUNBOOK.md` の「3.1.1 シークレット管理マップ」を正とする。

チェック項目（実行順）:

フェーズ A: 事前確認

- [ ] Supabase に `20260520000000_anon_sync_pepper_vault_runtime.sql` と `20260520010000_anon_sync_pepper_rotation_rpc.sql` が適用済みであることを確認する。
- [ ] Supabase に `20260521000000_anon_sync_recovery_hmac_runtime.sql` が適用済みであることを確認する。
- [ ] Supabase に `20260521010000_anon_sync_vault_ops_rpc.sql` が適用済みであることを確認する。
- [ ] Supabase に `20260522000000_anon_sync_nonce_consumptions.sql` が適用済みであることを確認する（refresh nonce の同時実行再利用を防ぐため）。
- [ ] Supabase に `20260523000000_anon_sync_vault_rpc_acl_hardening.sql` が適用済みであることを確認する（Vault RPC の EXECUTE 権限を service_role 限定にするため）。
- [ ] `ANON_SYNC_PEPPER_SECRET` が設定済みであることを確認する（未設定は fail-fast）。
- [ ] `ANON_SYNC_RECOVERY_SECRET` が設定済みであることを確認する（未設定は fail-fast）。
- [ ] `ANON_SYNC_PEPPER_SECRET` を設定する場合は、それが「今回の新しい pepper 値」であり、`DATASET_TOKEN_SECRET` / `CHALLENGE_HMAC_SECRET` ではないことを確認する。
- [ ] `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- status --json` を実行し、現在状態を記録する。
- [ ] Supabase で次を実行し、`anon_can_exec_* = false` / `auth_can_exec_* = false` / `service_can_exec_* = true` を確認する: `SELECT has_function_privilege('anon', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS anon_can_exec_pepper_bundle, has_function_privilege('authenticated', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS auth_can_exec_pepper_bundle, has_function_privilege('service_role', 'public.get_anon_sync_pepper_bundle()', 'EXECUTE') AS service_can_exec_pepper_bundle, has_function_privilege('anon', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS anon_can_exec_recovery_bundle, has_function_privilege('authenticated', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS auth_can_exec_recovery_bundle, has_function_privilege('service_role', 'public.get_anon_sync_recovery_bundle()', 'EXECUTE') AS service_can_exec_recovery_bundle;`

フェーズ B: 初期化（runtime が空の環境のみ）

- [ ] `status --json` で `pepper.runtime` または `recovery.runtime` が `null` の場合、初期化が必要と判定する。
- [ ] dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- bootstrap-pepper --initial-version v1 --json`
- [ ] dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- bootstrap-recovery --initial-version v1 --json`
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- bootstrap-pepper --initial-version v1 --confirm --json`
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- bootstrap-recovery --initial-version v1 --confirm --json`
- [ ] 再度 `status --json` を実行し、`ok: true` と `current_version = v1` / `accept_versions = ["v1"]` を確認する。

フェーズ C: ローテーション（例: v2 へ）

- [ ] dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- rotate-pepper --target-version v2 --json`
- [ ] dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- rotate-recovery --target-version v2 --json`
- [ ] preflight の `current_version` / `target_version` / `planned_accept_versions` / `planned_version_epoch` を確認する。
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- rotate-pepper --target-version v2 --confirm --json`
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- rotate-recovery --target-version v2 --confirm --json`
- [ ] `status --json` で `new_current_version = v2` 相当（`runtime.current_version = v2`）を確認する。

フェーズ D: 収束確認と finalize

- [ ] `user_member_map` の `salt_version` 分布と `member_id_hash_rotations` の増分を確認する。
- [ ] `recovery_relink_audit` に異常な `rejected` が急増していないことを確認する。
- [ ] finalize の dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- finalize-pepper --keep-version v2 --retire-others --json`
- [ ] finalize の dry-run を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- finalize-recovery --keep-version v2 --retire-others --json`
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- finalize-pepper --keep-version v2 --retire-others --confirm --json`
- [ ] 実適用を実行する: `pnpm --dir packages/FUSOU-WEB run manage-anon-sync-vault -- finalize-recovery --keep-version v2 --retire-others --confirm --json`
- [ ] 最終 `status --json` で `accept_versions = ["v2"]` を確認する。
- [ ] 保持期間後に Vault UI で旧世代 secret (`anon_sync_pepper_v1`) を削除する。

### 11.4 APP タグ付き公開

チェック項目:

- [ ] `packages/FUSOU-APP/package.json` の `version` が単調増加になっている。
- [ ] GitHub Actions で `publish_and_create_version_tag` を `workflow_dispatch` 実行する。
- [ ] `create-release` が `fusou-v<version>` の draft を作成したことを確認する。
- [ ] `build-tauri` と `verify-updater-manifest` が成功したことを確認する。
- [ ] `publish-release` 成功後に `draft: false` / `prerelease: false` を確認する。
