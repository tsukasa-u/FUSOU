---
title: ハードウェア証明 (TPM / Secure Enclave) と開発環境導入
description: TPM Quote 検証と AK 証明書チェーン検証の違い、現在の信頼判定フロー、開発環境の導入手順、検証コマンドをまとめたガイド。
contributors: ["github-copilot"]
date: 2026-06-30
slug: guide/hardware_attestation
tags: [guide, security, attestation]
---

## 概要

このドキュメントは、FUSOU のハードウェア証明の仕組みと、ローカル開発環境で再現・検証するための導入手順をまとめたものです。

## 1. 目的

- 端末が提示した証明データが改ざんされていないことを確認する
- 端末鍵が信頼できる発行系統 (ルート証明書) に連なっていることを確認する
- 検証結果を trust_tag に反映し、サーバー側の判定に利用する

## 2. 用語と役割

- Quote 署名検証
  - TPM が生成した Quote 本体に対して、公開鍵で署名が正しいかを確認する
  - 「この Quote を対応する秘密鍵が実際に署名した」ことを保証する

- AK チェーン検証
  - AK (Attestation Key) 証明書チェーンが信頼ルートまで正しく連なるかを確認する
  - 「その公開鍵がどの信頼基盤に属するか」を保証する

## 3. Quote 署名検証と AK チェーン検証の違い

| 観点 | Quote 署名検証 | AK チェーン検証 |
| --- | --- | --- |
| 主目的 | データ真正性 | 鍵の出自・信頼性 |
| 何を検証するか | Quote と署名の一致 | 証明書連鎖・期限・ルート一致 |
| 攻撃耐性 | データ改ざん検出 | 任意鍵の持ち込み抑止 |
| これだけで十分か | 不十分 | これ単体でも不十分 |

両方を同時に行うことで、はじめて「正しい鍵が、正しいデータに署名した」ことを強く確認できます。

## 4. 現在の検証フロー (refresh)

1. challenge nonce を発行
2. 端末が nonce を含むハードウェア証明を生成
3. サーバーが Quote 構造と nonce 束縛を検証
4. Quote 署名を検証
5. AK 証明書チェーンを検証
6. ルートハッシュが `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256` と一致するか検証
7. trust_tag を決定

### 4.1 TPM の fail-closed 動作

`INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256` が未設定の場合、TPM 検証は fail-closed で不成立になります。

- 期待値: 設定漏れで暗黙に緩い判定へ落ちない
- 結果: TPM としては有効化されず、信頼判定は `suspicious` 側へ寄る

### 4.2 AK 証明書ポリシー

TPM AK チェーン検証では、チェーン署名検証に加えて、AK 用途としての証明書制約を評価します。

- Leaf は CA 証明書であってはならない
- Leaf は `digitalSignature` を持つこと
- Leaf EKU は AIK 用途 OID (`2.23.133.8.3`) を含むこと
- 中間証明書は CA 制約が有効であること
- 中間/ルートで KeyUsage がある場合は `keyCertSign` を含むこと

### 4.3 失効確認 (OCSP / CRL)

証明書チェーン検証時に、Leaf 証明書について以下を実施します。

- まず OCSP URL がある場合は OCSP で状態確認
- OCSP が確定できない場合は CRL Distribution Point で失効確認
- 有効 (`good`) を確認できない場合は fail-closed で不成立
- `revoked` が確認された場合は即不成立

## 5. trust_tag への反映

- `hw_verified`
  - ハードウェア証明が有効で、環境異常フラグがない
- `suspicious`
  - ハードウェア証明不成立、malformed、デバッガ/フック検出など
- `sw_verified`
  - software_fingerprint が有効で環境異常フラグがない
- `unverified`
  - 証明情報なし、または未判定

## 6. 開発環境導入

## 6.1 前提

- Node.js 20 以上
- pnpm
- Rust (stable)
- FUSOU モノレポの依存導入済み

## 6.2 FUSOU-WEB (Verifier) 側

1. パッケージへ移動

```bash
cd packages/FUSOU-WEB
```

1. 依存導入

```bash
pnpm install
```

1. 失効確認ライブラリ導入 (この変更で実導入)

```bash
pnpm add @peculiar/asn1-ocsp @peculiar/asn1-schema @peculiar/asn1-x509
```

1. ルートハッシュ設定 (Cloudflare Worker bindings / secrets)

- `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`
- `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`

形式は SHA-256 の hex 文字列を、空白区切り・カンマ区切り・JSON 配列のいずれかで指定できます。

dotenvx での追加例 (dotenv ではなく dotenvx を使用):

```bash
cd ../../
pnpm exec dotenvx set INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256 \
  '["c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050","63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179"]' \
  -f packages/FUSOU-WEB/.env -fk packages/.env.keys
pnpm exec dotenvx set INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256 \
  '["ceee658bdd5591cb707444f6c50a810c3ecf85c40d591f015e5e2f0e4b1f13d3"]' \
  -f packages/FUSOU-WEB/.env -fk packages/.env.keys
```

この変更では、trusted root の source of truth は Worker 環境変数のみです。ハードウェア証明（`secure_enclave` / `tpm`）が送られた際に対応する `INTEGRITY_*` が未設定だと、サーバーは fail-closed（`attestation_trusted_root_unconfigured`）で拒否します。

### 6.2.1 trusted root の source of truth と更新手順

source of truth は Worker 環境変数です。

1. `INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`
1. `INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`

本番運用では、上記 2 つを常に明示設定してください。

ローテーション時の推奨手順:

1. 新旧ルートを併記してデプロイ (重複期間を設ける)
1. `attestation-verifier` テストと本番ログで `suspicious` 増加がないことを確認
1. 旧ルートを削除して再デプロイ
1. 監査ログ (suspicious_trust_audit / 管理スプレッドシート) を一定期間監視

運用ミスを減らすため、`packages/FUSOU-WEB` には trusted root 更新スクリプトを追加しています。

```bash
cd packages/FUSOU-WEB

# dry-run（デフォルト）
pnpm run manage-attestation-trusted-roots -- apply \
  --env production \
  --secure @./trusted-roots/secure-enclave.next.json \
  --tpm @./trusted-roots/tpm-ak.next.json

# 反映
pnpm run manage-attestation-trusted-roots -- apply \
  --env production \
  --secure @./trusted-roots/secure-enclave.next.json \
  --tpm @./trusted-roots/tpm-ak.next.json \
  --confirm
```

漏えいインシデント時（信頼している root の切替が必要なとき）は、次の 2 段階で実施してください。

```bash
cd packages/FUSOU-WEB

# 1) stage: 新旧併記
pnpm run manage-attestation-trusted-roots -- rotate-stage \
  --env production \
  --current-secure @./trusted-roots/secure-enclave.current.json \
  --next-secure @./trusted-roots/secure-enclave.next.json \
  --current-tpm @./trusted-roots/tpm-ak.current.json \
  --next-tpm @./trusted-roots/tpm-ak.next.json \
  --confirm

# 2) final: 旧 root 除去
pnpm run manage-attestation-trusted-roots -- rotate-final \
  --env production \
  --next-secure @./trusted-roots/secure-enclave.next.json \
  --next-tpm @./trusted-roots/tpm-ak.next.json \
  --confirm
```

## 6.3 FUSOU-APP (TPM 収集) 側

1. パッケージへ移動

```bash
cd packages/FUSOU-APP/src-tauri
```

1. Windows

- TPM 2.0 が有効な環境で実行
- 必要に応じて `windows-tpm-attestation` feature で検証

1. Linux

- TPM 2.0 が有効な環境
- `tpm2-tss` 開発ライブラリが必要

代表的な導入例:

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install -y tpm2-tss libtss2-dev pkg-config

# Fedora
sudo dnf install -y tpm2-tss-devel pkgconf-pkg-config

# Arch Linux
sudo pacman -S --needed tpm2-tss pkgconf
```

sudo 権限がない検証環境では、Debian/Ubuntu 系で以下のローカル展開でも `cargo check --features linux-tpm-attestation` を実行できます。

```bash
mkdir -p .local-tss
cd .local-tss
apt download libtss2-dev
dpkg-deb -x libtss2-dev_*.deb extracted
PKG_CONFIG_PATH="$PWD/extracted/usr/lib/x86_64-linux-gnu/pkgconfig" \
  cargo check --features linux-tpm-attestation
```

注意:

- この方法はローカル検証向けです
- 実運用や通常開発では OS 標準手順で `tpm2-tss` / `libtss2-dev` を導入してください

1. 任意の AK チェーン設定

- `FUSOU_TPM_AK_CERT_CHAIN_B64`
  - Base64 DER 証明書を配列で設定
  - JSON 配列形式または改行/カンマ区切りで設定可能
  - この値が設定されている場合は最優先で使用される
- 未設定時の自動供給
  - `roaming/ca/fusou_ca_cert.pem` と `roaming/ca/fusou_ca_key.pem` から
    TPM AK 公開鍵向け leaf 証明書 + CA ルートを自動生成して `certificate_chain` に付与
  - 追加のユーザー手作業なしで chain 付与までは実行される
- `FUSOU_TPM_AK_PERSISTENT_HANDLE`
  - 永続 AK ハンドルを固定したい場合に指定

## 6.4 ローカル検証コマンド

FUSOU-WEB:

```bash
cd packages/FUSOU-WEB
pnpm vitest run src/server/utils/__tests__/attestation-verifier.test.ts
pnpm run astro check
```

FUSOU-APP:

```bash
cd packages/FUSOU-APP/src-tauri
cargo check
# Linux で TPM 有効ビルドを検証する場合
cargo check --features linux-tpm-attestation
```

## 7. 運用チェックリスト

- TPM ルート (`INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256`) が設定済み
- Secure Enclave ルート (`INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256`) が設定済み
- challenge nonce と refresh で時刻同期が大きくズレていない
- attestation_report がサイズ上限に収まっている
- 証明書の OCSP / CRL エンドポイントへサーバーから到達できる
- suspicious 監査ログ (DB / 管理スプレッドシート) を監視している
- `dataset_token` の `trust_tag` claim が常に付与される構成になっている
  - `hw_verified` / `sw_verified` / `unverified` / `suspicious` のいずれか
  - ハードウェア非対応端末は `unverified` または `sw_verified` で運用可能

## 8. トラブルシュート

- `cargo check --features linux-tpm-attestation` で `tss2-sys.pc` 未検出
  - `libtss2-dev` または `tpm2-tss-devel` の導入を確認
  - `pkg-config --modversion tss2-sys` で解決可否を確認

- TPM 証明が常に `suspicious`
  - ルートハッシュ設定のフォーマット (hex / 区切り) を確認
  - AK チェーン順序が leaf -> intermediate -> root になっているか確認
  - OCSP / CRL エンドポイントへの疎通を確認

- `attestation_report` malformed 扱い
  - Base64 フィールド長、証明書チェーン件数、証明書文字列長の上限超過を確認

## 9. セキュリティ上の注意

- ルートハッシュ設定は段階的ローテーションを行い、旧ルートを短期間のみ併存させる
- 失効情報配信 (OCSP/CRL) の可用性を監視し、期限切れレスポンスを放置しない
