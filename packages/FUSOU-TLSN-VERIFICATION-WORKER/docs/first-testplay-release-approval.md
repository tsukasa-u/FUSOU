# 初回TLSNテストプレイのリリース承認票

状態は **未登録** です。初回はFUSOU開発者一人が選択と運用を行います。この票は同一運用者のリリース記録で、別組織への承認申請ではありません。実鍵の登録や初回Releaseの実行に使う `genesis-approval.json` は、選択したリリースの資料と実配備の照合後に確定します。

## 人が選ぶ入力

| 入力 | 選ぶ時点 |
| --- | --- |
| 使用するGitコミット（完全SHA） | リリース用のビルド・配備前。タグで選ぶ場合はタグが指すSHAを確認する。 |
| ゲームサーバーの正式ホスト名 | 実プレイの準備時。使用前にInventoryと署名済みTarget Approvalへの一致を機械的に確認する。 |

## 設定と機械的な照合

| 項目 | 提案または確認すべき値 |
| --- | --- |
| APP Bootstrap | 専用のオフラインEd25519ルート。運用者の保管下の鍵から公開鍵ID・SPKIを取得し、委任とAPP埋め込み値を照合する。現時点では未登録。 |
| Runtime Configの公開先 | `https://tlsn-config.fusou.dev/tlsn/runtime-config/v2/manifest.json`。Gatewayの候補。配備前に既存DNS・ルートとの衝突と、署名委任のaudience一致を確認する。 |
| Verification Workerの公開先 | `https://tlsn-verify.fusou.dev`。専用Workerの候補。`/health`、`/attestation/session`、`/verify/tlsn` のオリジンを揃える。 |
| 運用プロファイル | 初回環境で `cloudflare-operator-v1` を使う案。SQLite DOの状態とfencing、R2のexact readback、確定後のFreshness発行を適用する。 |
| 署名委任 | Manifest、Release Record、Freshnessの用途ごとに、環境・audience・有効期限を照合する。Session、Binding、Result、Notaryの公開情報は同じ運用者の鍵・配備記録から取得し、署名とscopeを確認する。 |
| オンライン鍵と復旧 | 採用した信頼契約に沿って鍵保管と復旧手順を記録する。Bootstrapルートの秘密鍵はオンラインWorkerに置かない。 |

`cloudflare-operator-v1` では、DOとR2などが整合した旧状態へ同時に戻された場合の自動検出を保証しません。論理fencingは厳密な8秒の経過時間cutoffを提供しません。Worker-readable鍵は権限を持つWorkerコードから取得できるため、HSMの非exportabilityを提供しません。これらは一致検査で決まる値とは異なり、初めて採用する場合に同一運用者のリリース記録に残す信頼契約です。[プロファイルの比較](../../FUSOU-TLSN-VERIFIER/docs/runtime-config-freshness-contract-revision-proposal.md)

## 承認がそろった後に記録する項目

- 選択したSHA、信頼契約と適用範囲。
- 鍵ID・公開SPKI、各委任のdigest、有効期限と更新手順。
- 確定したHTTPS URL、Cloudflare account・Worker有効バージョン・実DO ID、専用R2とQueue。
- Worker reference、5つのManifest入力、Manifest・初回Record・Release委任のexact-byte digestと、初回承認JSONのdigest。期待値は検査対象の配布物とは別に保存する。
- 公開前の試験結果と、初回操作のID・確定結果の照会記録。

初回ゲームサーバーのホスト名は、ゲーム用Proxyの起動前に署名済みTarget Approvalと照合します。この承認票の準備、Workerの配線確認、初回登録のローカル検証にはゲーム通信を使いません。[クラウド設定手順](first-testplay-cloud-setup.md)
