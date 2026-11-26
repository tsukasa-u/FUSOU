# 初回TLSNテストプレイのクラウド設定

初回Complete captureに向け、専用クラウド環境から同一LinuxホストのAPPとNotaryまでを設定する手順です。2026-11-26時点の配備と未確認事項は[readinessの最新記録](../../FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md)にあります。

## 既存リソースと接続先

| 用途 | 名前・接続先 | 設定方針 |
| --- | --- | --- |
| WEB・端末proof | `fusou-tlsn-testplay-web`、`https://tlsn-web.fusou.dev` | 専用Supabaseへの既存配備を使う。 |
| 検証 | `fusou-tlsn-verification-production` | [専用設定例](../wrangler.first-testplay.example.toml)から準備。専用HTTPSホストは承認対象。 |
| 非同期検証 | Queue `fusou-tlsn-verification-production` | 同じ検証Workerをproducerとconsumerに設定。 |
| 検証アーカイブ | R2 `fusou-tlsn-verification-production` | 検証Workerの `TLSN_PRESENTATIONS`。バケットは非公開。 |
| 設定配信 | `fusou-tlsn-runtime-config-freshness-gateway` | 配備済み。公開する場合も専用HTTPSホストに限定。 |
| 設定の署名と初期化 | `fusou-tlsn-runtime-config-freshness-signer` | 配備済み。GatewayからService Bindingで接続。外部ルートなし。 |
| 設定の台帳と配布データ | Signerの `FRESHNESS_ISSUE_COORDINATOR` とR2 `fusou-tlsn-runtime-config-first-testplay` | 配備済み。名前付きDOのIDとR2を初回登録に照合。 |
| Notary | `127.0.0.1:<承認済み非ゼロポート>` | 実APPと同じLinuxホスト。承認済み `fusou-notary` と永続台帳を使う。 |

通常サイトの `fusou.dev/*` と `s.fusou.dev/*` は既存ルートです。追加する公開先は専用ホストごとに割り当てます。非公開の `fusou-tlsn-session-testplay` は試験用として扱い、承認資料や運用用設定の入手元には使いません。

## 1. 発行前に固定する承認情報

[初回リリース承認票](first-testplay-release-approval.md)に、候補ホスト名、信頼ルート、採用する運用プロファイルと未承認事項をまとめています。

初回はFUSOU開発者一人で運用します。人が選ぶ入力は、使うGitコミット（タグから選ぶ場合はその完全SHA）と、実プレイ時のゲームサーバーの正式ホスト名です。ビルド準備やサービス検証を先に進めるときは、ゲームサーバー名を保留できます。

1. 選択されたSHAを基準に、CI、APP・Notary・Worker/WASMのビルド記録と有効な配備を照合します。論理deployment ID、専用HTTPSホストやポートは設定側で確定し、DNS・既存ルートとの競合を確認します。Manifest URLのパスは `/tlsn/runtime-config/v2/manifest.json`。検証オリジンは `/health`、`/attestation/session`、`/verify/tlsn` を同じホストで扱います。
2. APPのBootstrapルート公開鍵IDとEd25519 SPKI、Manifest・Release Record・Freshnessの用途別委任、およびSession・Binding・Result・Notaryの公開情報は、同一運用者の鍵と配備の記録から取得します。Manifest URL、鍵ID・SPKI、署名、用途、期限、scopeの一致は機械的に確認します。
3. 発行は選択したリリースの信頼契約に従います。`cloudflare-operator-v1` の[運用上の前提](../../FUSOU-TLSN-VERIFIER/docs/runtime-config-freshness-contract-revision-proposal.md)を実運用で初めて採用する場合は、同じ運用者のリリース記録にその範囲を明記します。

リリースで信頼する公開値とdigestは、検査対象の配布物とは別に同じ運用者の管理下で保存します。別の承認組織との連絡は不要です。鍵と管理capabilityは管理下の保管先から対象WorkerのSecretsへ渡します。Wrangler設定、ログ、APP埋め込み値に秘密鍵を記載しません。Runtime Configの[発行登録ガード](../scripts/tlsn-runtime-config-production-registration.mjs)は、リリース記録と実際の登録がそろうまで閉じておきます。

## 2. Verification Workerを組み立てる

[専用設定例](../wrangler.first-testplay.example.toml)はroot設定です。通常の `wrangler.toml` や `--env production` に切り替えると別設定が選ばれるため、この例を元にした承認済み設定を `--config` で明示します。例にはQueueのproducer/consumer、R2、DO、version metadata、専用WEBへの二つのproof URLが入っています。1バッチ1件は初回試験用の設定です。

公開前に、次を専用設定またはSecretsに補います。正確な型と追加項目は[検証Workerの `Bindings`](../src/index.ts)および[実配備の照合契約](production-evidence-operator-runbook.md#approved-release--active-deployment--app-handoff)に従います。

| 設定 | 入力元 |
| --- | --- |
| `TLSN_PRODUCTION_DEPLOYMENT_ID`、`TLSN_GIT_COMMIT_SHA` | 承認済み配備記録。論理IDはCloudflareのversion IDと別。 |
| `TLSN_CANDIDATE_SUPABASE_URL`、`TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY`、`TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS` | 専用WEBの配備記録と同じSupabaseプロジェクト。許可リストはそのAuthホスト。 |
| `TLSN_PRODUCTION_ORIGIN_INVENTORY_SHA256`、`TLSN_PRODUCTION_TARGET_APPROVAL_ARTIFACT_SHA256` | ビルドに含める承認済みInventoryとTarget Approvalのexact bytes。環境全体を単一ホストに置換する設定や試験用CAを足さない。 |
| `TLSN_CANDIDATE_VERIFIER_KEY_ID`、`TLSN_CANDIDATE_NOTARY_KEY_ID`、`TLSN_PRODUCTION_NOTARY_ID`、`TLSN_PRODUCTION_NOTARY_REGISTRY`、`TLSN_SECURITY_REGISTRY_SET_SHA256` | 承認済み公開マニフェストとNotaryの登録情報。Notary IDと鍵IDは別。 |
| `TLSN_PRODUCTION_SESSION_AUTHORITY_*`、`TLSN_PRODUCTION_BINDING_AUTHORITY_*`、`TLSN_PRODUCTION_RESULT_*` | 各用途の鍵ID・公開鍵・登録情報と、署名用Secrets。Result Registry envelopeと独立に承認したルートも照合する。 |

リポジトリrootで以下を実行すると、既存のWASMを使って設定例をローカルでバンドルできます。この予行演習に通っても、配備版WASMの出自や運用鍵が検証されたわけではありません。

```bash
setup_dir=$(mktemp -d)
worker_dir="$PWD/packages/FUSOU-TLSN-VERIFICATION-WORKER"
sed "s|^main = \"src/index.ts\"$|main = \"$worker_dir/src/index.ts\"|" \
  "$worker_dir/wrangler.first-testplay.example.toml" > "$setup_dir/verify.toml"
WRANGLER_LOG_PATH="$setup_dir/wrangler.log" WRANGLER_SEND_METRICS=false \
  npx --no-install wrangler deploy --dry-run \
  --config "$setup_dir/verify.toml" --outdir "$setup_dir/verify-bundle"
```

本配備用には、[候補ワークフロー](../../../.github/workflows/tlsn-testplay-candidate.yml)と同じ固定ツールでWASMを生成します。`FUSOU_RELEASE_SOURCE_SHA` に承認済みSHAを渡し、対象ソースと一致することを確認してから `build:wasm`、`verify:wasm-provenance`、型検査、契約テストを通します。承認済み設定で再度dry-runしてから、専用Workerだけを配備します。公開先を付ける場合はそのWorkerの `routes` に承認済み1ホストの `custom_domain = true` を指定し、`workers_dev = false`、`preview_urls = false` を維持します。CloudflareはCustom DomainにDNSとTLS証明書を割り当てます。[CloudflareのCustom Domains設定](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

`wrangler deployments list` と `wrangler versions view` で単一のバージョンが100%稼働し、想定のDO・R2・Queueだけに接続することを確認します。`/health` でProductionロール、random binding、trust contract有効、発行予定の公開情報との一致を確認します。[Worker reference取得スクリプト](../scripts/capture-app-worker-reference.mjs)には独立に承認した公開マニフェスト、provenance、既定の環境入力と読み取り専用Cloudflare権限を渡します。生成したreferenceのexact bytesとdigestを初回Manifestの入力にします。

## 3. Runtime ConfigとFreshnessを初期化する

1. [Signerの設定例](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/wrangler.private-signer.example.toml)を元に、既存Worker名・SQLite migration・`RELEASE_LEDGER_R2` の接続先を維持します。承認済みManifest URLを `TLSN_RUNTIME_CONFIG_MANIFEST_URL` と `FRESHNESS_MANIFEST_URL` の両方に設定し、`FRESHNESS_COORDINATOR_NAME`、`RELEASE_LEDGER_CHAIN_ID`、公開ピン、用途別の委任を設定します。既存namespace内の実DO IDは初回承認に使うため、名前と一緒に照合します。
2. Manifest V3にWorker reference、Origin Inventory、Target Approval、Security Registry Set、Result Registry envelopeの5種類をexact-byte digestで結び付けます。承認された発行経路でManifestと初回Release Recordを生成し、別経路の公開ピンで検証します。最初のReleaseは既存状態からの更新と区別し、[Genesis契約](../../FUSOU-TLSN-VERIFIER/docs/runtime-config-freshness-contract-revision-proposal.md#74-one-time-fixed-approval-cloudflareoperator-genesis--local-implementation)に沿って、承認済みのR2アーティファクト、Manifest snapshotとpointerを整え、Recordのpointer ETagとexact bytesを読み戻します。
3. 固定承認 `FRESHNESS_GENESIS_APPROVAL_JSON` は対象DO・chain・restore epoch・承認された資料のdigestを固定します。承認済みの管理経路から非公開Signerの `POST /__private/admin/genesis` を呼びます。`x-fusou-genesis-capability` は管理Secretsから取得します。要求JSONの3フィールドは `manifest_bytes_base64url`、`record_bytes_base64url`、`release_delegation_bytes_base64url` です。成功はledger確定・R2 readback・`AVAILABLE`・current-state installまで確認します。応答を失った場合は同じoperationの照会または同じbytesによる回復を使います。別operationの作成やR2の手動上書きで未確定状態を解消しません。
4. [Gatewayの設定例](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/wrangler.private-signer.example.toml)に同じManifest URLを入れ、`TLSN_FRESHNESS_SIGNER` を配備済みSignerに設定します。承認済みCustom DomainはGatewayに割り当てます。HTTPSからManifestとdigest指定の参照資料を取得し、署名・サイズ・exact bytesと、`POST /tlsn/runtime-config/v2/freshness/v1` の署名付き応答を検証します。

初回登録の運用入口は [genesis-operator.mjs](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/genesis-operator.mjs) です。リポジトリ固定版のWranglerから既存Signerへ非公開Service Bindingで接続します。R2への資料の配置とexact readbackは上記の承認済み手順で先に行います。CLI自体は署名やR2書き込みを行いません。

`GENESIS_DIR` に `genesis-approval.json`、`manifest.json`、`release-record.json`、`release-delegation.json` の元のbytesを置きます。`GENESIS_APPROVED_SHA256` には、同一運用者がパッケージとは別にリリース記録へ固定した `genesis-approval.json` のSHA-256（unpadded base64url）を指定します。設定済みのWrangler認証と `CLOUDFLARE_ACCOUNT_ID` を使い、`FUSOU_GENESIS_CAPABILITY_FILE` に運用者がアクセスを制限したファイルを指定します。ファイルの内容はcapability一行です。

```bash
genesis_cli=packages/FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/scripts/genesis-operator.mjs
node --experimental-strip-types "$genesis_cli" prepare "$GENESIS_DIR" "$GENESIS_APPROVED_SHA256"
node --experimental-strip-types "$genesis_cli" status "$GENESIS_DIR" "$GENESIS_APPROVED_SHA256"
# 次のコマンドは承認済み資料を登録するときだけ実行する。
node --experimental-strip-types "$genesis_cli" apply "$GENESIS_DIR" "$GENESIS_APPROVED_SHA256"
```

`prepare` はオフラインで承認ファイルと3資料のdigestを照合し、確定前から同じoperation IDを表示します。署名とR2・Coordinatorの実状態はSigner側が検証します。`status` は承認ファイルだけで同じIDを読み取り専用照会できます。`apply` は同じbytesを1回送信します。`INSTALLED` は `AVAILABLE` とinstall確定を伴う場合にのみ成功扱いです。`RESULT_UNKNOWN` や接続切断などの `RESULT_UNCONFIRMED` では、まず同じ資料の `status` を使います。`NOT_FOUND` だけで未実行を確定したり、自動で再POSTしたりしません。

## 4. 同一LinuxホストでAPPとNotaryを確認する

APPのビルド入力には承認済みの公開値3つを設定します。`SIGNER` を含む変数名ですが、V3の起点はBootstrapルートの公開情報です。

| APPビルド入力 | 内容 |
| --- | --- |
| `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL` | 承認済みの完全なManifest URL。 |
| `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID` | Bootstrapルート鍵ID。 |
| `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI` | BootstrapルートのEd25519公開鍵SPKI。 |

検証APPの `--tlsn-compiled-bootstrap` を承認値と比較します。[Notaryリリース手順](notary-release-runbook.md)に従い、承認済みバイナリと `127.0.0.1:<port>` の設定で `export-public` を実行します。`notary-operational-preflight.mjs SNAPSHOT_DIR APPROVAL_DIR APPROVED_REGISTRATION_SHA256` には、署名済みsnapshot、その5資料、独立trust入力、承認済み登録表と別経路で承認したdigest、公開export、Session Authority registryを渡します。出力が成功しても稼働状態は別途確認します。

ゲーム自動起動を無効にして、実APPがManifestとFreshness、Verification Workerのhealth、認可済み端末の署名付きSessionを検証できることを確認します。この段階の試験先はFUSOUのサービスです。ゲーム用Proxyの起動まで進める場合は、APPに設定した対象が署名済みTarget Approvalと一致する必要があります。初回の実ゲーム通信は対象ホストとプレイ範囲を別途確認した後に行います。[APPと各サービスの検証境界](production-evidence-operator-runbook.md#complete-app-path-and-the-first-authorized-capture)
