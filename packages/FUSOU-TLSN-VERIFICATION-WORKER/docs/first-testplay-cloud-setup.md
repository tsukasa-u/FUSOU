# 初回TLSNテストプレイのクラウド設定

初回Complete captureに向け、専用クラウド環境から同一LinuxホストのAPPとNotaryまでを設定する手順です。配備済みの構成と未確認事項は[readinessの最新記録](../../FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md)にあります。

## 既存リソースと接続先

| 用途 | 名前・接続先 | 設定方針 |
| --- | --- | --- |
| WEB・端末proof | `fusou-tlsn-testplay-web`、`https://tlsn-web.fusou.dev` | 専用Supabaseへの既存配備を使う。 |
| 検証 | `fusou-tlsn-verification-production`、`https://tlsn-verify.fusou.dev` | 選択済みWorkerのCustom Domain。今後の配備では[専用設定例](../wrangler.first-testplay.example.toml)を使い、既存の対応と稼働版を照合する。 |
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

`wrangler deployments list` と `wrangler versions view` で単一のバージョンが100%稼働し、想定のDO・R2・Queueだけに接続することを確認します。`/health` でProductionロール、random binding、trust contract有効、発行予定の公開情報との一致を確認します。

### 配備ワークフローとWranglerの証跡

[Worker reference取得スクリプト](../scripts/capture-app-worker-reference.mjs)には独立に承認した公開マニフェスト、配備証跡、既定の環境入力とCloudflare管理APIの読み取り権限を渡します。配備証跡は配備方法に応じて片方を指定します。

- 配備ワークフローで実行した場合は、従来どおり `TLSN_PROVENANCE_REPORT_PATH` にそのワークフローのprovenanceファイルを指定します。
- Wranglerで配備した場合は、`TLSN_OPERATOR_DEPLOYMENT_RECORD_PATH` に [operator-wrangler-v1の記録](../scripts/app-worker-operator-context.mjs)を、`TLSN_OPERATOR_DEPLOYMENT_APPROVED_SHA256` に同じ運用者が別途固定した記録のexact-byte SHA-256をunpadded base64urlで指定します。記録には選択済みGit SHA・repository、同一SHAで成功した候補CIのrun ID・attempt・workflow path、Cloudflare account・Worker名・実deployment ID・active version ID・論理deployment ID、Verifier鍵ID、ビルド時のWASM digest、承認済み公開マニフェストのexact-byte digestを入れます。候補CIのrunはソースの検証結果として記録し、Wranglerの配備はCloudflareの配備記録で照合します。WASM digestは配備時に使ったビルド出力の記録です。

両経路とも `TLSN_PUBLIC_MANIFEST_PATH` に公開マニフェスト、`TLSN_APP_WORKER_REFERENCE_PATH` に新規の出力先を指定します。取得時にCloudflare側の有効バージョン・公開binding・専用ドメインとWorkerの対応を検査します。一致した場合に生成したreferenceのexact bytesとdigestを初回Manifestの入力にします。Manifest更新を準備するときも、署名前に同じ配備証跡でCloudflareの現行設定を再照合します。

専用ドメインを既存の稼働版に追加するときは、対象名のDNSレコードとCustom Domainの有無、Worker Routesの競合を管理APIで確認します。割り当て後は公開HTTPSの証明書、`/health` の選択SHAと版ID、Session・検証APIの認証なし拒否も照合します。既存の参照ファイルを使う場合も、Manifest発行時には新しい観測で期限条件を満たします。

## 3. Runtime ConfigとFreshnessを初期化する

1. [Signerの設定例](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-COORDINATOR/wrangler.private-signer.example.toml)を元に、既存Worker名・SQLite migration・`RELEASE_LEDGER_R2` の接続先を維持します。承認済みManifest URLを `TLSN_RUNTIME_CONFIG_MANIFEST_URL` と `FRESHNESS_MANIFEST_URL` の両方に設定し、`FRESHNESS_COORDINATOR_NAME`、`RELEASE_LEDGER_CHAIN_ID`、公開ピン、用途別の委任を設定します。既存namespace内の実DO IDは初回承認に使うため、名前と一緒に照合します。
2. Manifest V3にWorker reference、Origin Inventory、Target Approval、Security Registry Set、Result Registry envelopeの5種類をexact-byte digestで結び付けます。承認された発行経路でManifestと初回Release Recordを生成し、別経路の公開ピンで検証します。最初のReleaseは既存状態からの更新と区別し、[Genesis契約](../../FUSOU-TLSN-VERIFIER/docs/runtime-config-freshness-contract-revision-proposal.md#74-one-time-fixed-approval-cloudflareoperator-genesis--local-implementation)に沿って、承認済みのR2アーティファクト、Manifest snapshotとpointerを整え、Recordのpointer ETagとexact bytesを読み戻します。
3. 固定承認 `FRESHNESS_GENESIS_APPROVAL_JSON` は対象DO・chain・restore epoch・承認された資料のdigestを固定します。承認済みの管理経路から非公開Signerの `POST /__private/admin/genesis` を呼びます。`x-fusou-genesis-capability` は管理Secretsから取得します。要求JSONの3フィールドは `manifest_bytes_base64url`、`record_bytes_base64url`、`release_delegation_bytes_base64url` です。成功はledger確定・R2 readback・`AVAILABLE`・current-state installまで確認します。応答を失った場合は同じoperationの照会または同じbytesによる回復を使います。別operationの作成やR2の手動上書きで未確定状態を解消しません。
4. [Gatewayの設定例](../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/wrangler.private-signer.example.toml)に同じManifest URLを入れ、`TLSN_FRESHNESS_SIGNER` を配備済みSignerに設定します。承認済みCustom DomainはGatewayに割り当てます。HTTPSからManifestとdigest指定の参照資料を取得し、署名・サイズ・exact bytesと、`POST /tlsn/runtime-config/v2/freshness/v1` の署名付き応答を検証します。

初回専用のManifest署名準備では、[独立承認用公開鍵](../scripts/tlsn-runtime-config-production-registration.mjs)を署名ツールに固定します。承認鍵はAPPのBootstrap rootとManifest子鍵から分けて保管します。署名前に、固定した選択SHAとURL、Bootstrap公開鍵、Manifest委任のexact-byte digest、承認対象設定のdigestを含む承認記録と、そのEd25519署名を照合します。承認用の公開値は署名を依頼する側から受け取りません。

署名準備の入口は `prepareTlsnRuntimeConfigReleaseUpdate` です。初回分はepoch 1とし、通常の入力に `initialManifestSigningApproval` として `approvalBytes` と `signatureBytes` を渡します。Workerの現行バージョンと専用ルートを再取得し、更新したWorker reference・5資料・有効なManifest委任を使います。この入口が返した資料を初回登録用に確認します。R2への公開やDO初期化は別手順です。

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

`status` のシェル終了コードは `INSTALLED` 以外で1です。初回の `NOT_FOUND` は終了コードとJSONを合わせて読み、操作ID・R2の内容・固定承認を照合したうえで初回の `apply` に進みます。

Gatewayは公開前に、非公開Service BindingでManifest・snapshot・5資料と署名付きFreshnessを確認します。初回環境ではGenesisが `INSTALLED` になり、7件のGETが成功しました。Freshnessは署名権の確保後に `RESULT_UNKNOWN` となり、台帳に発行停止状態が保持されています。専用ドメインの割り当てはこの状態を解決し、非公開経路で署名付き応答を再検証してから行います。[実環境の確認記録](../../FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md#initial-runtime-config-installed-privately-freshness-blocked--2026-11-27)

### 未確定のFreshnessを復旧する

まず台帳を読み取り専用で照会します。確定済み応答があれば、同一操作の保存済みバイト列を通常経路で照合します。応答本体・長さ・digestがすべて欠けている場合は、署名の有無を判定できません。

隔離環境で検証した `retireCloudflareOperatorUnknownIssue` は、専用の回復承認鍵で署名した承認を使います。Coordinator ID、chain、restore epoch、操作ID、リクエストdigest、旧fence、設置済み状態のdigestを照合し、承認・旧操作の拒否・fence更新を一括で記録します。元のnonceは使用済みのままです。同じ承認を再送すると既存の記録を返します。

復旧後の旧Releaseでは新規Freshness発行が停止したままです。現行Worker情報を取り直し、署名済みの後続Releaseを登録してから、新しいnonceでFreshnessを検証します。実環境での実行には、復旧コードを含む選択SHAの検証、専用承認鍵の公開ピン、非公開管理経路が必要です。[現在の検証記録](../../FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md#signed-retirement-of-an-unconfirmed-freshness-issue--2026-11-27)

非公開Signerの `POST /__private/admin/issue-retirement` は、正規JSONの `approval_base64url` と `signature_base64url` を受け取ります。管理capabilityは `x-fusou-issue-recovery-capability` に渡します。結果が不明な場合は、同じcapabilityで `GET /__private/admin/issue-retirement/<operation-id>/<approval-sha256>` を使って記録を読みます。復旧鍵のIDとSPKIは `FRESHNESS_ISSUE_RECOVERY_KEY_ID` と `FRESHNESS_ISSUE_RECOVERY_PUBLIC_KEY_SPKI` に固定し、capabilityはSignerの専用Secretに登録します。

後続Manifestの用意には `prepareTlsnRuntimeConfigReleaseUpdate` の `successorManifestSigningApproval` を使います。承認署名は初回と別の署名ドメインで、旧Manifest digest・旧epoch・連続する新epochを固定します。署名前にWorkerの現行版とルートを再照合します。確認済みのManifestと5資料を非公開のRelease更新へ渡し、先に採番したoperation IDを使って `INSTALLED` を照会します。

旧Manifestが期限切れの場合も、確定済みの前版はRelease Recordの署名に含まれる `authorized_at` で検証し、後続版の照合に使います。新しいManifestの登録と現在のFreshness発行では、その時点で有効な資料が必要です。登録が拒否された場合は、同じoperation IDで状態を確認してください。[実環境の復旧記録](../../FUSOU-TLSN-VERIFIER/FIRST-TESTPLAY-READINESS.md#live-freshness-retirement-completed-successor-admission-rejected--2026-11-27)

## 4. 同一LinuxホストでAPPとNotaryを確認する

APPのビルド入力には承認済みの公開値3つを設定します。`SIGNER` を含む変数名ですが、V3の起点はBootstrapルートの公開情報です。

| APPビルド入力 | 内容 |
| --- | --- |
| `FUSOU_TLSN_RUNTIME_CONFIG_MANIFEST_URL` | 承認済みの完全なManifest URL。 |
| `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_KEY_ID` | Bootstrapルート鍵ID。 |
| `FUSOU_TLSN_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI` | BootstrapルートのEd25519公開鍵SPKI。 |

検証APPの `--tlsn-compiled-bootstrap` を承認値と比較します。[Notaryリリース手順](notary-release-runbook.md)に従い、承認済みバイナリと `127.0.0.1:<port>` の設定で `export-public` を実行します。`notary-operational-preflight.mjs SNAPSHOT_DIR APPROVAL_DIR APPROVED_REGISTRATION_SHA256` には、署名済みsnapshot、その5資料、独立trust入力、承認済み登録表と別経路で承認したdigest、公開export、Session Authority registryを渡します。出力が成功しても稼働状態は別途確認します。

ゲーム自動起動を無効にして、実APPがManifestとFreshness、Verification Workerのhealth、認可済み端末の署名付きSessionを検証できることを確認します。この段階の試験先はFUSOUのサービスです。ゲーム用Proxyの起動まで進める場合は、APPに設定した対象が署名済みTarget Approvalと一致する必要があります。初回の実ゲーム通信は対象ホストとプレイ範囲を別途確認した後に行います。[APPと各サービスの検証境界](production-evidence-operator-runbook.md#complete-app-path-and-the-first-authorized-capture)
