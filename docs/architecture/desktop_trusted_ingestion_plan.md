# FUSOU Trusted Ingestion Plan (No-zkTLS Edition) v3.1

## 0. 目的

本計画は、zkTLS を使わずに次を満たす。

- ゲームサーバーから FUSOU-PROXY が受信したデータの真正性を可能な限り保証
- FUSOU-APP / FUSOU-PROXY バイナリの改ざん検出
- FUSOU-APP が処理したアップロードデータの改ざん検出
- FUSOU-APP 実行主体の真正性検証（段階的に Device Key -> Binary Measurement -> OS Native Hardware Attestation）
- FUSOU-APP から FUSOU-WEB への通信経路固定（動的ピンニング）
- Cloudflare 上での受理/隔離/拒否の再現可能な判定

この文書は、未知の coding agent / 新規実装者が追加判断なしで実装できる粒度で定義する。

---

## 1. 方針（zkTLS なし）

### 1.1 保証の作り方

本計画の保証は次の 4 要素の積で作る。

1. App Authenticity（アプリの真正性）
   - v1: `device_ed25519` 署名
   - v2: Binary Self-Measurement（バイナリ自己計測ハッシュ）
   - v3: OS Native Hardware Attestation（Phase 3a: Linux/Windows, Phase 3b: macOS）
     - Linux: `tss-esapi`（bundled）による TPM 2.0 Quote
     - Windows: CNG API（`MS_PLATFORM_CRYPTO_PROVIDER`）による TPM 2.0 鍵署名
     - macOS: Secure Enclave（`security-framework`）による P-256 鍵署名（将来実装）

2. Proxy Binding（プロキシ段階のデータ結合）
   - FUSOU-PROXY が game server レスポンスの生バイトを SHA-256 し attestation に含める
   - FUSOU-PROXY の TLS 接続先証明書フィンガープリントを記録

3. Channel Authenticity（通信経路の真正性）
   - signed pinset + dynamic SPKI pinning
   - pinning 適用対象は FUSOU 管理下 endpoint（bootstrap/upload）に限定する
   - 外部ゲームサーバー通信には fail-closed pinning を適用しない
   - 外部ゲームサーバー証明書はクライアント観測値の差分を audit 記録し、異常を検知する

4. Data Binding（データ結合）
   - upload payload bytes の SHA-256 を attestation message に焼き込む

### 1.2 信頼チェーン

```
Game Server
    │ HTTPS (game server TLS cert fingerprint recorded by PROXY)
    ▼
FUSOU-PROXY (binary_hash verified → genuine PROXY pins game cert → data is authentic)
    │ raw response SHA-256 → proxy_data_hash
    ▼
FUSOU-APP (binary_hash verified → genuine APP faithfully encodes data)
    │ upload payload SHA-256 → data_hash
    │ Ed25519 sign + HW attestation sign (attestation_message)
    ▼
FUSOU-WEB (verify signatures + verify hashes + verify binary whitelist + verify HW attestation)
```

### 1.3 保証できること / できないこと

保証できること:

- 送信途中改ざん
- 同一 upload token 再利用
- 署名のない改ざんデータの受理
- 非正規バイナリからのアップロード検知（v2 以降）
- 非正規ゲームサーバーからのデータ検知（proxy_data_hash による）
- 外部ゲームサーバー証明書の異常変化の検知（audit）

保証できないこと:

- 物理攻撃・ブートチェーン破壊・TPM/Secure Enclave 所有者乗っ取り
- クライアント OS 管理者の完全支配下での「絶対」防御（v3 HW attestation で大幅に緩和）
- FUSOU-PROXY と FUSOU-APP が同時に改造された場合の完全防御（v3 HW attestation で緩和）
- 外部証明書監査データの収集基盤が侵害・改ざんされた場合の完全検知（本計画では信頼境界の外）

---

## 2. スコープ

### 2.1 初回本番スコープ

- Phase 0: 基盤整備（依存統一・D1 migration・エラーコード定義）
- Phase 1: Device attestation + Data binding + Proxy binding
- Phase 2: Dynamic pinning
- Phase 3a: Binary Self-Measurement + OS Native Hardware Attestation（Linux / Windows）
- Phase 3b: macOS Secure Enclave（将来拡張）

### 2.2 明示的な非スコープ

- zkTLS / TLSNotary
- transcript 証明
- proof 生成・検証ワークフロー

---

## 3. 全体アーキテクチャ

## 3.0 規範レベル

この文書では次の意味で用語を固定する。

- `MUST`: 実装上必須。逸脱不可。
- `MUST NOT`: 実装禁止。
- `SHOULD`: 原則実装。代替採用時は理由をコードコメントか設計記録に残す。
- `MAY`: 任意。

以後、処理順序・保存順序・比較方法は `MUST` として扱う。

## 3.1 コンポーネント

- Game Server（既存 HTTPS）
- FUSOU-PROXY（MITM + parser + proxy_data_hash 生成）
- FUSOU-APP（署名・ハッシュ・upload）
- FUSOU-WEB Worker（検証ゲート + queue producer）
- FUSOU-WORKFLOW Worker（queue consumer + compaction）
- Cloudflare D1（INTEGRITY_DB / 既存 BATTLE_INDEX_DB）/ R2 / Queue

## 3.2 受理ゲート

受理条件（AND）:

1. Token Gate
   - upload token / JWT / dataset token 妥当
2. Replay Gate
   - `upload_jti` が初出
3. Binding Gate
   - `SHA256(uploaded_bytes)` が attestation 埋め込み値と一致
4. App Gate
   - attestation 妥当（署名検証 + binary_hash ホワイトリスト検証）
5. Payload Gate
   - Avro schema / offset validation 妥当

`App Gate` と `Binding Gate` が fail の場合は本流保存せず `ingest_quarantine` に送る。

---

## 4. ランタイムフロー

## 4.1 Phase 1 フロー（Device attestation + Proxy binding）

1. Game Server が HTTPS レスポンスを返す。
2. FUSOU-PROXY が game server TLS 証明書の SPKI SHA-256 を記録する。
3. FUSOU-PROXY が生のレスポンスボディを `proxy_data_hash = SHA256(raw_response_bytes)` で計算する。
4. FUSOU-PROXY が `proxy_data_hash` と `game_server_cert_fp` を FUSOU-APP に渡す。
5. FUSOU-APP が battle Avro bytes を作る。
6. APP が `data_hash = SHA256(avro_bytes)` を計算。
7. APP が `POST /api/battle-data/upload` preparation を送信（integrity 拡張フィールド含む）。
8. WEB が signed upload token（`upload_jti`, `nonce` 含む）を返す。
   - `upload_jti` は WEB 側が UUID v4 で生成する。
   - `nonce` は WEB 側が `crypto.getRandomValues()` で 16 bytes 生成し hex 化する。
9. APP が attestation message を構築し device key で署名。
10. APP が execution で binary body + integrity headers を送信。
11. WEB が Token/Replay/Binding/App/Payload gate を順に実行。
12. pass 時のみ queue に enqueue。
13. workflow が compaction し R2/D1 を更新。

## 4.2 Phase 2 フロー（Dynamic pinning）

### 4.2.0 pinning 適用境界（必須）

- Dynamic pinning は **FUSOU 管理下 endpoint のみ** に適用する。
   - 対象: `POST /api/integrity/bootstrap`, `POST /api/battle-data/upload`
   - 対象ホスト: `PINNING_ENFORCED_HOSTS`（初期値: `fusou.dev`, `*.fusou.dev`）
- 外部ゲームサーバー（例: `*.kancolle-server.com`）通信は pinset 適用対象外とする。
- したがって、外部ゲームサーバー証明書のローテーションで upload を即時停止させない。

1. APP 起動時に `POST /api/integrity/bootstrap`。
2. WEB が signed pinset を返却。
   - pinset 署名秘密鍵: `INTEGRITY_PINSET_SIGNING_PRIVATE_KEY`（Workers Secret に保管）。
   - Workers 側は `crypto.subtle.sign("Ed25519", ...)` で pinset に署名する。
   - APP 側は埋め込み公開鍵セット `PINSET_VERIFY_PUBKEYS`（1個以上）で署名検証する。
3. APP が `sig_alg=Ed25519` と `sig_key_id` を検証し、対応する公開鍵で pinset 署名を検証する。
4. APP が pinset をメモリ保持し、`PINNING_ENFORCED_HOSTS` 一致先のみ pinning client に切替。
5. 以後の preparation/execution は対象ホストに対して pinning enforced。
6. pinset 期限切れ（`not_after` 超過）かつ更新不可時:
   - APP は最後の有効 pinset で通信を **継続** する（grace period = 1 時間）。
   - grace period 超過後は upload を一時停止し pending store に保存。
   - 次回の bootstrap 成功時に再開。
    - 外部ゲームサーバー通信は pinset 期限切れの影響を受けない。

### 4.2.1 外部ゲームサーバー証明書変更の扱い

- FUSOU-PROXY は従来どおり `game_server_cert_fp`（SPKI SHA-256）を観測・記録する。
- 外部ゲームサーバー証明書 fingerprint の差分は Phase 1-2 では **audit 扱い** を既定とする。
   - 既定挙動: upload 継続、`ingest_attestations.reason` に差分理由を記録。
- ただし次の場合は policy で reject 可能:
   - 許可ドメイン外ホストへの接続
   - 証明書検証無効化や fingerprint 形式異常
   - 運用が定める異常頻度閾値（任意）超過

### 4.2.2 pinset 署名鍵ローテーション手順

1. APP の次バージョンで新旧両方の `PINSET_VERIFY_PUBKEYS`（公開鍵）を同梱する。
2. Workers 側の `INTEGRITY_PINSET_SIGNING_PRIVATE_KEY` を新鍵へ切替し、`sig_key_id` を更新する。
3. 旧バージョン利用率が十分低下したら旧公開鍵を APP から削除する。

## 4.3 Phase 3 フロー（Phase 3a: Linux/Windows, Phase 3b: macOS）

### 4.3.0 フォールバック禁止ポリシー

「ライブラリ・ツールが未インストールだからフォールバックする」ことを **禁止** する。

- Phase 3a の対象は Linux/Windows。macOS は Phase 3b で実装する。
- 各 OS の Hardware Attestation 実装はビルド時に依存を解決する（bundled / OS API）。
- ランタイムで外部 CLI や動的リンクライブラリの存在に依存しない。
- **唯一の正当な degraded path**: 端末に TPM 2.0 チップ / Secure Enclave が **物理的に搭載されていない** 場合のみ。
  - この場合、`hw_attestation_kind: "none"` としてサーバーに報告する。
  - サーバーの policy で `audit`（受理するが記録）または `reject`（拒否）を判定する。
  - 将来的に `reject` にエスカレーション可能。
- ただし移行措置として、Phase 3a 期間中の macOS ビルドは `hw_attestation_kind: "none"` を送信し、サーバー policy は `audit` 固定とする。

### 4.3.1 Binary Self-Measurement（Phase 3a: Linux/Windows, Phase 3b: macOS）

1. APP 起動時に自身の実行バイナリのパスを取得する。
   - Linux: `/proc/self/exe` の readlink
   - Windows: `std::env::current_exe()`
   - macOS: `std::env::current_exe()`
2. バイナリファイル全体を SHA-256 する → `app_binary_hash`。
3. FUSOU-PROXY バイナリも同様に計測する → `proxy_binary_hash`。
4. `app_binary_hash` と `proxy_binary_hash` を attestation message に含める。
5. WEB 側でホワイトリスト（CI/CD パイプラインが登録した既知の正規ハッシュ）と照合。
   - ホワイトリストは `INTEGRITY_DB.binary_whitelist` テーブルに保管。
   - CI/CD が新リリース時に自動登録（`POST /api/admin/integrity/register-binary`）。

### 4.3.2 Linux: TPM 2.0 via `tss-esapi` (bundled)

外部 CLI ツール（`tpm2-tools`）やシステムインストール済み C ライブラリに依存 **しない**。
`tss-esapi` crate の `bundled` feature を使い、`tpm2-tss` C ライブラリをビルド時に静的リンクする。

1. APP 起動時に TPM デバイスの存在チェック。
   - `/dev/tpmrm0` の存在確認（`std::path::Path::new("/dev/tpmrm0").exists()`）。
   - 存在しない場合: `hw_attestation_kind = "none"` としてサーバーに報告。
2. TPM 存在時:
   - `tss_esapi::Context` を初期化。
   - Endorsement Key (EK) を取得または作成。
   - Attestation Key (AK) を EK 配下に作成。
   - `qualifying_data = SHA256(attestation_message)` を計算する。
   - `tss_esapi::Context::quote()` に `qualifying_data` を渡して PCR 値の署名付き Quote を生成する。
   - PCR 選択: `[0, 2, 4, 7]`（BIOS, platform config, boot loader, secure boot policy）。
   - これにより Quote を `upload_jti` / `nonce` / `data_hash` に束縛する。
3. APP は `device_ed25519` + `binary_measurement` + `tpm_quote` を同送信。
4. WEB は TPM Quote をインラインで検証する（別サービス不要）。
   - TPMS_ATTEST 構造体は固定バイト列パーサーで TypeScript 実装。
   - TPMS_ATTEST の `extraData` が `SHA256(attestation_message)` と一致することを必須検証する。
   - RSA/ECC 署名検証は `crypto.subtle.verify()` で実行。

ビルド設定（`Cargo.toml`）:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
tss-esapi = { version = "7", features = ["bundled"] }
```

バイナリサイズ増加: ~1-3MB（静的リンクにより、ランタイム依存ゼロ）。
メモリ増加: TPM Context 初期化時に ~2-5MB。upload 完了後に解放。

### 4.3.3 Windows: CNG API via `windows` crate

Windows 10 以降の OS 標準 API を使用する。追加ライブラリ不要。

1. APP 起動時に TPM Platform Crypto Provider の存在チェック。
   - `NCryptOpenStorageProvider(MS_PLATFORM_CRYPTO_PROVIDER)` を呼び出し。
   - `NTE_PROV_TYPE_NOT_DEF` エラーの場合: `hw_attestation_kind = "none"` としてサーバーに報告。
2. TPM 存在時:
   - `NCryptCreatePersistedKey` で TPM 内に ECDSA P-256 鍵ペアを生成（初回のみ、以降は `NCryptOpenKey` で再利用）。
   - 鍵名: `FUSOU_INTEGRITY_AK`。
   - `NCryptSignHash` で attestation message の SHA-256 ダイジェストに TPM 署名。
3. APP は `device_ed25519` + `binary_measurement` + `hw_tpm_cng_sig` を同送信。
4. WEB は ECDSA P-256 署名を `crypto.subtle.verify("ECDSA", ...)` で検証。
   - 初回 upload 時に公開鍵を `user_devices` テーブルの新規カラム `hw_pubkey`（bytea）に登録。
   - 以後の upload では登録済み `hw_pubkey` と照合。

ビルド設定（`Cargo.toml`）:

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
  "Win32_Security_Cryptography",
] }
```

バイナリサイズ増加: ~100KB（OS API バインディングのみ）。
メモリ増加: ~100KB（鍵ハンドルのみ）。

### 4.3.4 macOS: Secure Enclave via `security-framework` crate（将来実装）

Apple Silicon および T2 チップ搭載 Mac の Secure Enclave を使用する。

> **注意**: macOS ではネイティブアプリ向けの App Attest（DeviceCheck）API が事実上無効化されているため、Secure Enclave の鍵ストレージ API を直接使用する。

1. APP 起動時に Secure Enclave の利用可否チェック。
   - `kSecAttrTokenIDSecureEnclave` が利用可能か確認。
   - 利用不可の場合（古い Intel Mac 等）: `hw_attestation_kind = "none"` としてサーバーに報告。
2. Secure Enclave 利用可能時:
   - Secure Enclave 内に ECDSA P-256 鍵ペアを生成（初回のみ、以降は Keychain から取得）。
   - 鍵ラベル: `dev.fusou.integrity.se-key`。
   - `SecKeyCreateSignature` で attestation message の SHA-256 ダイジェストに署名。
3. APP は `device_ed25519` + `binary_measurement` + `hw_secure_enclave_sig` を同送信。
4. WEB は ECDSA P-256 署名を `crypto.subtle.verify("ECDSA", ...)` で検証。

ビルド設定（`Cargo.toml`）:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
security-framework = "3"
```

バイナリサイズ増加: ~50KB（OS API バインディングのみ）。
メモリ増加: ~50KB（鍵参照のみ。秘密鍵はメインメモリに出ない）。

**制約**: macOS ビルドでは Apple Developer 証明書によるコード署名が MUST。
**実装時期**: macOS 対応は初回リリースには含めず、Phase 3 完了後の拡張として実装する。ただし、**拡張可能な設計（`HardwareAttestor` trait の OS 別実装）** を Phase 3 で確立する。

### 4.3.5 HW Attestation 共通インターフェース

プラットフォーム差異を吸収するための共通 trait:

```rust
/// OS ごとにこの trait を実装する。
pub trait HardwareAttestor: Send + Sync {
    /// ハードウェアが利用可能かどうか。
    fn is_available(&self) -> bool;

    /// attestation message に HW 署名を付与する。
    fn sign_attestation(&self, digest: &[u8]) -> Result<HwAttestationEnvelope, String>;

    /// HW attestation の種別を返す。
    fn kind(&self) -> &'static str;
}

pub struct HwAttestationEnvelope {
    pub kind: String,           // "tpm_quote" | "tpm_cng" | "secure_enclave" | "none"
    pub signature_b64: String,
    pub public_key_b64: String,
    pub extra: serde_json::Value, // TPM: pcrs, quote_b64 等
}
```

実装:

- `TpmLinuxAttestor` — `tss-esapi` bundled
- `TpmWindowsAttestor` — `windows` crate CNG
- `SecureEnclaveAttestor` — `security-framework`（将来）
- `NoHardwareAttestor` — HW 非搭載時の fallback（`kind = "none"`）

---

## 5. プロトコル固定仕様

## 5.1 ハッシュ仕様

`data_hash` / `proxy_data_hash` / `app_binary_hash` / `proxy_binary_hash` はすべて SHA-256（hex lower）固定。

$$
data\_hash = SHA256(uploaded\_bytes)
$$

禁止:

- JSON stringify ベースのハッシュ
- 可変順序オブジェクトのハッシュ

## 5.2 署名メッセージ固定書式

```
fusou-upload-attestation-v1
dataset_id:{dataset_id}
api_path:{api_path}
upload_jti:{upload_jti}
nonce:{nonce}
data_hash:{data_hash}
table:{table}
table_version:{table_version}
period_tag:{period_tag}
app_version:{app_version}
proxy_data_hash:{proxy_data_hash}
app_binary_hash:{app_binary_hash}
proxy_binary_hash:{proxy_binary_hash}
hw_attestation_kind:{hw_attestation_kind}
```

規則:

- UTF-8
- `\n` 区切り
- 末尾改行あり
- 空値禁止（Binary Measurement 未対応時は `none` を入れる）
- `api_path`: upload 先の API パス。固定値 `/api/battle-data/upload`
- `proxy_data_hash`: FUSOU-PROXY が計算した game server レスポンスの SHA-256。未対応時は `none`
- `app_binary_hash` / `proxy_binary_hash`: Phase 3 で追加。Phase 1-2 では `none`
- `hw_attestation_kind`: HW attestation の種別。Phase 3 で追加。Phase 1-2 では `none`

## 5.3 Preparation body 追加項目

既存の `handshake_body` に以下のフィールドをマージする。

```json
{
  "integrity_version": "v1-devicekey",
  "data_hash_alg": "sha256",
  "data_hash": "hex",
  "proxy_data_hash": "hex_or_none",
  "app_binary_hash": "hex_or_none",
  "proxy_binary_hash": "hex_or_none",
  "app_attestation": {
    "kind": "device_ed25519",
    "payload_b64": "...",
    "signature_b64": "..."
  },
  "hw_attestation": {
    "kind": "none",
    "signature_b64": "",
    "public_key_b64": "",
    "extra": {}
  }
}
```

これらは既存の `UploadRequest.handshake_body`（`serde_json::Value`）に `obj.insert()` でマージする。`UploadRequest` の構造体自体は変更しない。

許容値:

- `integrity_version`: `v1-devicekey` | `v2-measurement` | `v3-hardware`
- `app_attestation.kind`: `device_ed25519`
- `hw_attestation.kind`: `tpm_quote` | `tpm_cng` | `secure_enclave` | `none`
- `data_hash_alg`: `sha256` のみ

Phase 3 HW attestation の各 kind ごとの `hw_attestation.extra` 構造:

Linux TPM Quote:
```json
{ "quote_b64": "...", "pcrs": [0,2,4,7] }
```

Windows CNG TPM:
```json
{ "key_name": "FUSOU_INTEGRITY_AK" }
```

macOS Secure Enclave:
```json
{ "key_label": "dev.fusou.integrity.se-key" }
```

## 5.4 Execution headers 追加項目

- `X-Integrity-Version`
- `X-Data-Hash`
- `X-App-Attestation-Kind`

これらは `UploadRequest.headers` の `HashMap<String, String>` に追加する。

---

## 6. API 契約

## 6.1 `POST /api/integrity/bootstrap`

Request:

```json
{
  "app_version": "0.3.4",
  "platform": "linux",
  "integrity_version": "v1-devicekey"
}
```

Response:

```json
{
  "pinset_version": "2026-06-06-1",
  "pins": ["base64-sha256-spki-current", "base64-sha256-spki-next"],
  "not_before": "2026-06-06T00:00:00Z",
  "not_after": "2026-06-06T06:00:00Z",
   "sig_alg": "Ed25519",
   "sig_key_id": "2026-06-k1",
   "sig": "base64-ed25519-signature"
}
```

Rate limit: 10 requests/hour/IP（Cloudflare Rate Limiting Rules で設定）。

## 6.2 `POST /api/battle-data/upload`（preparation）

既存の preparation フローを拡張。WEB は以下を upload token payload に含める。

- `upload_jti` — WEB が UUID v4 で生成
- `nonce` — WEB が `crypto.getRandomValues(new Uint8Array(16))` で生成し hex 化
- `dataset_id`
- `api_path` — 固定値 `/api/battle-data/upload`
- `integrity_version`
- `data_hash`
- `proxy_data_hash`
- `app_binary_hash`
- `proxy_binary_hash`
- `exp`

これらは `battle_data.ts` の preparation 処理（`preparationValidator`）で構築する `tokenPayload` にマージする。
`utils/upload.ts` の共通ロジックは battle-data 専用要件で変更しない。

## 6.3 `POST /api/battle-data/upload`（execution）

検証順序固定:

1. upload token verify
2. replay check (`upload_jti` unique)
3. binding check
4. app attestation verify
5. Avro/payload check

注記:

- 外部ゲームサーバー fingerprint 差分は、既定では App Gate 内の policy decision を `audit` として扱う（即 reject しない）。

既存の `content_hash` 検証（`battle_data.ts` の `executionProcessor` 内）は **Binding Gate に統合**する。既存の `content_hash` チェックを削除し、以下に置換する:

```typescript
// Binding Gate: data_hash verification (replaces legacy content_hash check)
const expectedDataHash = tokenPayload.data_hash as string;
const hashBuffer = await crypto.subtle.digest("SHA-256", data);
const actualHash = Array.from(new Uint8Array(hashBuffer))
  .map(b => b.toString(16).padStart(2, "0"))
  .join("");
if (!timingSafeEqual(actualHash, expectedDataHash)) {
  // → quarantine + 400
}
```

### 6.3.1 公開鍵の取得方法

App Gate で Ed25519 署名を検証する際、サーバーは以下の手順で公開鍵を取得する:

1. upload token 内の `dataset_id` を使い Supabase `user_member_map.member_id_hash` から `user_id`（canonical owner）を解決。
2. `app_attestation.payload_b64` から `device_id` を取り出す。
3. `user_devices` を `canonical_user_id = user_id` かつ `device_id = payload.device_id` で検索し、`revoked_at IS NULL` の行から `device_pubkey`（bytea, 32 bytes）を取得。
4. 取得した 32 bytes をそのまま `crypto.subtle.importKey("raw", pubKeyBytes, "Ed25519", ...)` に渡して CryptoKey を構築。
5. `crypto.subtle.verify("Ed25519", key, signature, message)` で署名検証。

`device_pubkey` は既存の `/anonymous-sync/v2/register` エンドポイントで `user_devices` テーブルに登録済み。新規テーブルは不要。

### 6.3.2 execution の厳密な失敗挙動

1. `upload token verify` に失敗した場合
  - 401 を返す
  - D1 には何も書かない
  - Queue 送信はしない

2. `replay check` に失敗した場合
  - 409 を返す
  - 既存の `upload_jti` 行があれば参照のみ行う
  - 追加の attestation / quarantine 行は書かない

3. `binding check` に失敗した場合
  - 400 (`INTEGRITY_HASH_MISMATCH`) を返す
   - `INTEGRITY_DB.batch()` で `ingest_receipts(decision=quarantined)` と `ingest_quarantine(failure_gate=binding)` を同時に 1 回書く
  - Queue 送信はしない

4. `app attestation verify` に失敗した場合
  - 401 (`INTEGRITY_APP_ATTESTATION_INVALID`) または 403 (`INTEGRITY_APP_POLICY_REJECTED`)
   - `INTEGRITY_DB.batch()` で `ingest_receipts(decision=quarantined)` と `ingest_quarantine(failure_gate=attestation|hw_attestation)` を同時に 1 回書く
  - Queue 送信はしない

5. `Avro/payload check` に失敗した場合
  - 400 を返す
   - `INTEGRITY_DB.batch()` で `ingest_receipts(decision=quarantined)` と `ingest_quarantine(failure_gate=payload)` を同時に 1 回書く
  - Queue 送信はしない

6. 全 gate pass の場合
   - `INTEGRITY_DB.batch()` で `ingest_receipts(decision=accepted)` と `ingest_attestations(verified=1)` を同時に 1 回書く
   - `COMPACTION_QUEUE.send()` を呼ぶ

### 6.3.3 queue 送信の厳密条件

次の 5 条件がすべて真である場合のみ `COMPACTION_QUEUE.send()` を呼ぶ。

- token gate pass
- replay gate pass
- binding gate pass
- app gate pass
- payload gate pass

---

## 7. D1 スキーマ

バインディング名: `INTEGRITY_DB`（新規 D1 データベース）。

wrangler.toml に以下を追加:

```toml
[[d1_databases]]
binding = "INTEGRITY_DB"
database_name = "dev-kc-integrity"
database_id = "<create-and-fill>"
migrations_dir = "migrations/integrity"
```

Bindings 型定義（`types.ts`）に以下を追加:

```typescript
INTEGRITY_DB: D1Database;
```

## 7.1 `ingest_receipts`

```sql
CREATE TABLE IF NOT EXISTS ingest_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_jti TEXT NOT NULL UNIQUE,
  dataset_id TEXT NOT NULL,
  api_path TEXT NOT NULL,
  integrity_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_receipts_dataset_time
ON ingest_receipts(dataset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingest_receipts_integrity_version
ON ingest_receipts(integrity_version);
```

## 7.2 `ingest_attestations`

```sql
CREATE TABLE IF NOT EXISTS ingest_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL UNIQUE,
  upload_jti TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  attestation_kind TEXT NOT NULL,
  app_binary_hash TEXT,
  proxy_binary_hash TEXT,
  proxy_data_hash TEXT,
  pcr_digest TEXT,
  verified INTEGER NOT NULL,
  policy_decision TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES ingest_receipts(id)
);
```

## 7.3 `ingest_quarantine`

```sql
CREATE TABLE IF NOT EXISTS ingest_quarantine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL UNIQUE,
  upload_jti TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  api_path TEXT NOT NULL,
  failure_gate TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  raw_ref TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES ingest_receipts(id)
);
```

## 7.4 `binary_whitelist`

```sql
CREATE TABLE IF NOT EXISTS binary_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  binary_hash TEXT NOT NULL UNIQUE,
  registered_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_binary_whitelist_component
ON binary_whitelist(component, platform);
```

### 7.5 D1 書き込み順序

`INTEGRITY_DB.batch()` を以下の条件で使う。

1. Token Gate / Replay Gate 失敗時は `INTEGRITY_DB` に書かない。
2. Replay Gate 通過後の失敗（binding / attestation / hw_attestation / payload）は、
   - `ingest_receipts` INSERT
   - `ingest_quarantine` INSERT（`receipt_id` は `SELECT id FROM ingest_receipts WHERE upload_jti = ?` で参照）
   を同一 `batch()` で実行する。
3. 全 gate pass 時は、
   - `ingest_receipts` INSERT
   - `ingest_attestations` INSERT（`receipt_id` は `SELECT id FROM ingest_receipts WHERE upload_jti = ?` で参照）
   を同一 `batch()` で実行する。

これにより Worker クラッシュ時の「孤立 receipt」を防止する。

### 7.6 列の許容値

- `ingest_receipts.decision`: `accepted` | `quarantined`
- `ingest_attestations.attestation_kind`: `device_ed25519` | `tpm_quote` | `tpm_cng` | `secure_enclave` | `none`
- `ingest_attestations.policy_decision`: `accept` | `audit` | `reject`
- `ingest_quarantine.failure_gate`: `binding` | `attestation` | `hw_attestation` | `payload`
- `binary_whitelist.component`: `fusou-app` | `fusou-proxy`

---

## 8. Cloudflare リソース消費モデル

## 8.1 1 upload あたり（Phase 1）

固定増分:

- Worker request: preparation 1 + execution 1
- Queue message: 1
- Queue invocation: 1
- D1 write（INTEGRITY_DB）: `ingest_receipts` 1 + `ingest_attestations` 1（batch で 1 request）
- D1 write（失敗時）: `ingest_quarantine` 0 or 1
- D1 read: `upload_jti` replay check 1
- Supabase read: `user_member_map` + `user_devices` lookup（最大 2 query）

CPU 増分:

- SHA-256 1回（binding check）: ~0.1ms
- Ed25519 verify 1回（app attestation）: ~0.1ms
- D1 batch write: ~5ms

合計追加 CPU: **~10ms/upload**（Paid plan 30s 制限に対して無視できるレベル）

## 8.2 1 upload あたり（Phase 2）

Phase 1 + bootstrap 呼び出し。

- `/api/integrity/bootstrap`: 起動ごと or pinset TTL 切れごと
- 推奨 pinset TTL: 6時間

## 8.3 1 upload あたり（Phase 3）

Phase 1-2 + binary_whitelist lookup。

- D1 read 追加: `binary_whitelist` で `app_binary_hash` + `proxy_binary_hash` を検索（2 query）
- TPM Quote verification: TPMS_ATTEST パース + RSA verify ~1ms

## 8.4 日次計算式

変数:

- `U`: 日次 upload 回数
- `S`: 1 upload の非空 slice 数
- `C`: compaction で 1 file にまとめる slice 数
- `B`: 日次 bootstrap 回数

式:

- Worker requests = `2U + B`
- Queue messages = `U`
- Queue invocations = `U`
- integrity D1 rows（上限） = `2U`
- hot-path D1 rows = `U * S`
- archive R2 PUT = `ceil(U*S/C)`
- block_indexes rows = `U * S`

## 8.5 例

前提:

- 1 user/day: `U=20`, `S=12`, `C=60`, `B=1`

結果:

- Worker requests: `41`
- Queue messages: `20`
- Queue invocations: `20`
- integrity D1 rows: `40`
- hot-path D1 rows: `240`
- archive R2 PUT: `4`

10,000 DAU:

- Worker requests/day: `410,000`
- Queue messages/day: `200,000`
- Queue invocations/day: `200,000`
- integrity D1 rows/day: `400,000`
- hot-path D1 rows/day: `2,400,000`
- archive R2 PUT/day: `40,000`

注意: integrity D1 rows/day 400,000 は **Paid plan 必須**（Free plan は 100,000 rows/day 制限）。

---

## 9. ライブラリ選定（zkTLS除外）

## 9.1 採用

FUSOU-APP (Rust):

- `reqwest` 0.12（既存: fusou-upload, src-tauri）
- `rustls` 0.23（既存: src-tauri）
- `x509-parser`（pinset/SPKI 抽出用で追加）
- `sha2`（既存）
- `base64`（既存）
- `serde/serde_json`（既存）
- `ed25519-dalek`（既存: fusou-auth）

fusou-auth (Rust) — Phase 0 で統一:

- `reqwest` 0.11 → **0.12 に更新**
- TLS backend: `native-tls` → **`rustls-tls` に変更**

FUSOU-PROXY (Rust):

- 既存の `hudsucker` + `rustls` を活用
- SHA-256 計算用に `sha2`（追加）

FUSOU-WEB (TS):

- `jose`（既存）
- Workers `crypto.subtle`（既存 — Ed25519 verify + SHA-256 + HMAC）

Hardware Attestation（Linux）:

- `tss-esapi` 7.x + `bundled` feature（`tpm2-tss` C ライブラリをビルド時に静的リンク）
- ランタイム外部依存: **なし**（全てバイナリに内包）

Hardware Attestation（Windows）:

- `windows` 0.58 + `Win32_Security_Cryptography` feature（OS 標準 CNG API）
- ランタイム外部依存: **なし**（OS 組み込み API）

Hardware Attestation（macOS, 将来）:

- `security-framework` 3.x（OS 標準 Security Framework）
- ランタイム外部依存: **なし**（OS 組み込み API）

HW Attestation 検証（Workers 側）:

- TPMS_ATTEST パーサー: TypeScript で実装（固定長バイト列のため ~200 行）
- ECDSA P-256 / RSA 署名検証: `crypto.subtle.verify()` で実行
- **独立した verify service は不要**

## 9.2 不採用

- `native-tls` pinning 実装
- OpenSSL 直依存 pinning
- KV のみでの replay 制御
- zkTLS/TLSNotary ライブラリ群
- `tpm2-tools` CLI 呼び出し（ランタイム依存を排除するため `tss-esapi` bundled を採用）
- 独立した axum/tokio verify service（Workers 内で完結するため）
- macOS App Attest / DeviceCheck API（macOS ネイティブアプリでは事実上無効のため）

---

## 10. ファイル単位の実装契約

## 10.1 FUSOU-PROXY

既存変更: `proxy-https/src/proxy_server_https.rs`

- `handle_response()` 内で game server レスポンスの raw body の SHA-256 を計算
- game server TLS 証明書の SPKI SHA-256 を取得（`HttpContext` で取得できない場合は rustls peer cert から取得して request context に注入）
- `proxy_data_hash` と `game_server_cert_fp` を bidirectional channel 経由で APP に伝搬

新規: `proxy-https/src/integrity.rs`

- `compute_response_hash(body: &[u8]) -> String`
- `extract_server_cert_fingerprint(ctx: &HttpContext) -> Option<String>`

## 10.2 FUSOU-APP / fusou-storage

注記: battle-data upload の実装責務は `fusou-storage` + `fusou-upload` にある。`FUSOU-APP`（src-tauri）はそれらを依存として呼び出す。

新規: `src-tauri/src/security/integrity.rs`

- `compute_data_hash(bytes: &[u8]) -> String`
- `build_upload_attestation_message(args: UploadAttestationMessageArgs) -> String`
- `compute_binary_hash(path: &Path) -> Result<String, String>`
- `measure_self_binary() -> Result<String, String>` — `/proc/self/exe` or `current_exe()` の SHA-256
- `measure_proxy_binary(proxy_path: &Path) -> Result<String, String>`

新規: `src-tauri/src/security/attestation_device.rs`

- `sign_upload_attestation(...) -> Result<DeviceAttestationEnvelope, String>`

新規: `src-tauri/src/security/pinning.rs`

- `fetch_and_verify_pinset(...) -> Result<DynamicPinSet, String>`
- `install_pinset(pinset) -> Result<(), String>` — `reqwest::Client` を SPKI pin 付き `rustls::ClientConfig` で再構築
- `current_pinset() -> Option<DynamicPinSet>`
- `should_enforce_pinning(url: &str) -> bool` — `PINNING_ENFORCED_HOSTS` 一致時のみ true

新規: `src-tauri/src/security/hw_attestor.rs`

- `HardwareAttestor` trait 定義（§4.3.5 参照）
- `HwAttestationEnvelope` 構造体定義
- `create_platform_attestor() -> Box<dyn HardwareAttestor>` — OS に応じた実装を返すファクトリ

新規: `src-tauri/src/security/tpm_linux.rs`（`#[cfg(target_os = "linux")]`）

- `TpmLinuxAttestor` — `tss-esapi` bundled で `HardwareAttestor` を実装
- `is_available()`: `/dev/tpmrm0` の存在チェック
- `sign_attestation()`: `tss_esapi::Context::quote()` で TPM Quote 生成

新規: `src-tauri/src/security/tpm_windows.rs`（`#[cfg(target_os = "windows")]`）

- `TpmWindowsAttestor` — `windows` crate CNG API で `HardwareAttestor` を実装
- `is_available()`: `NCryptOpenStorageProvider(MS_PLATFORM_CRYPTO_PROVIDER)` の成否
- `sign_attestation()`: `NCryptSignHash` で ECDSA P-256 署名

新規: `src-tauri/src/security/enclave_macos.rs`（`#[cfg(target_os = "macos")]`, 将来実装）

- `SecureEnclaveAttestor` — `security-framework` で `HardwareAttestor` を実装
- `is_available()`: `kSecAttrTokenIDSecureEnclave` の利用可否
- `sign_attestation()`: `SecKeyCreateSignature` で ECDSA P-256 署名

新規: `src-tauri/src/security/no_hardware.rs`

- `NoHardwareAttestor` — HW 非搭載時。`kind() = "none"`, `is_available() = false`

新規: `src-tauri/src/security/mod.rs`

- 上記モジュールの re-export
- `create_platform_attestor()` の条件分岐（`cfg` による OS 判定）

既存変更: `fusou-storage/src/providers/r2/provider.rs`

- `upload_to_r2()` / `write_port_table()` 内で handshake 生成前に:
  1. `data_hash = compute_data_hash(&avro_bytes)`
  2. attestation 生成（`sign_upload_attestation(...)`)
  3. `handshake_body` に integrity フィールドをマージ（`obj.insert()`）
  4. `headers` に `X-Integrity-Version`, `X-Data-Hash`, `X-App-Attestation-Kind` を追加

既存変更: `FUSOU-APP/src-tauri/src/storage/retry_handler.rs`

- retry 時の処理:
  1. pending store から復元した `data` の `data_hash` を**再計算**する（データ自体は同一なのでハッシュも同一）。
  2. 新しい preparation を送信して新しい `upload_jti` と `nonce` を取得する。
  3. 新しい `upload_jti` + `nonce` + 既存の `data_hash` で attestation message を**再構築・再署名**する。
  4. execution を新しい attestation で送信する。

## 10.3 fusou-upload

既存の `UploadRequest` 構造体は **変更しない**。integrity フィールドは `handshake_body`（`serde_json::Value`）と `headers`（`HashMap<String, String>`）に呼び出し元（`fusou-storage/src/providers/r2/provider.rs`）でマージする。

既存の `Uploader::perform_upload()` 内の `content_hash` マージ処理は維持する（後方互換）。Binding Gate が `data_hash` に置換するため、`content_hash` は Phase 1 デプロイ完了後に deprecate。

## 10.4 fusou-auth

Phase 0 で以下を変更:

既存変更: `Cargo.toml`

- `reqwest` を `"0.11"` → `"0.12"` に更新
- `features` から `"native-tls"` を削除し `"rustls-tls"` を追加

これにより全パッケージで `reqwest 0.12` + `rustls` に統一され、Phase 2 の pinning が全通信経路をカバーする。

## 10.5 FUSOU-WEB

新規: `src/server/services/integrity/verify-binding.ts`

- `verifyBinding({ expectedHash, actualBytes }): Promise<boolean>`

新規: `src/server/services/integrity/verify-app-attestation.ts`

- `verifyAppAttestation(args): Promise<AttestationResult>`
- 内部で `user_devices` テーブルから `device_pubkey`（bytea）を取得
- `crypto.subtle.verify("Ed25519", ...)` で署名検証

新規: `src/server/services/integrity/verify-binary.ts`

- `verifyBinaryWhitelist(db, appHash, proxyHash): Promise<BinaryVerifyResult>`

新規: `src/server/services/integrity/pinset.ts`

- `buildSignedPinset(env): Promise<PinsetResponse>`

新規: `src/server/services/integrity/hw-verify.ts`（Phase 3）

- `verifyHwAttestation(args): Promise<HwVerifyResult>` — `hw_attestation.kind` に応じた検証ディスパッチ
- `parseTpmsAttest(quoteB64): TpmsAttest` — Linux TPM Quote パーサー
- `verifyTpmQuote(args): Promise<HwVerifyResult>` — Linux TPM Quote 検証
- `verifyEcdsaP256(args): Promise<HwVerifyResult>` — Windows CNG / macOS SE 共通の ECDSA 検証

既存変更: `src/server/routes/battle_data.ts`

- preparation 側の `tokenPayload` 構築時に `upload_jti`, `nonce`, `api_path`, `integrity_version` を追加（battle-data 専用）

既存変更: `src/server/routes/battle_data.ts`

- `executionProcessor` 内に gate 実行順序を固定した integrity 検証を追加
- 既存の `content_hash` 検証を Binding Gate に統合
- `INTEGRITY_DB` への `batch()` 書き込みを追加

新規: `src/server/routes/integrity.ts`

- `POST /bootstrap` — pinset 返却
- `POST /admin/register-binary` — CI/CD からのバイナリハッシュ登録（admin token 必須）

既存変更: `src/server/types.ts`

- `Bindings` 型に `INTEGRITY_DB: D1Database` を追加
- `Bindings` 型に `INTEGRITY_PINSET_SIGNING_PRIVATE_KEY?: string` を追加
- `Bindings` 型に `INTEGRITY_PINSET_SIGNING_KEY_ID?: string` を追加

既存変更: `src/server/utils.ts`

- `injectEnv()` に `INTEGRITY_DB`, `INTEGRITY_PINSET_SIGNING_PRIVATE_KEY`, `INTEGRITY_PINSET_SIGNING_KEY_ID` を追加

---

## 11. フェーズ計画

## Phase 0（1週間）

- API / message / hash 仕様凍結
- `fusou-auth` の `reqwest` を 0.12 + `rustls-tls` に統一
- `INTEGRITY_DB` 用 D1 データベース作成
- D1 migration 作成（`ingest_receipts`, `ingest_attestations`, `ingest_quarantine`, `binary_whitelist`）
- エラーコード定義
- `wrangler.toml` に `INTEGRITY_DB` バインディング追加
- `types.ts` / `utils.ts` の Bindings 更新

受入基準:

- `fusou-auth` のテスト全通過（`reqwest` 0.12 + `rustls-tls`）
- `cargo build` で全パッケージビルド成功
- `wrangler d1 migrations apply` で migration 適用成功

## Phase 1（2-3週間）

- Proxy binding 実装（`proxy_data_hash` 計算・伝搬）
- Device attestation + Binding 実装
- battle-data route へ gate 組込
- replay 防止 D1 実装
- 既存 `content_hash` 検証の Binding Gate への統合

受入基準:

- 改ざん payload reject 100%（テスト方法: e2e テストで payload を bit flip して送信）
- 署名偽装 reject 100%（テスト方法: 別の Ed25519 keypair で署名したリクエストを送信）
- 正常誤拒否率 < 1%（テスト方法: 100 回連続正常 upload を実行）
- replay 試行 reject 100%（テスト方法: 同一 `upload_jti` で 2 回 execution 送信）

## Phase 2（2週間）

- bootstrap route
- signed pinset（Ed25519）
- APP pinning client 切替
- pinset 期限切れフォールバック実装

受入基準:

- 非 pin 証明書接続拒否（対象: FUSOU 管理下 endpoint のみ）
- pin rotation 時に切断なし
- pinset 期限切れ + grace period 超過で upload 一時停止 → 復帰
- 外部ゲームサーバー証明書ローテーション時に upload 継続（audit 記録）

## Phase 3a（3-4週間）— Binary Measurement + Linux TPM + Windows CNG

- `HardwareAttestor` trait 設計・実装
- Binary Self-Measurement 実装（Linux/Windows。macOS は 3b）
- CI/CD からの `binary_whitelist` 自動登録
- Linux: `tss-esapi` bundled による TPM Quote 生成
- Windows: CNG API による TPM 鍵署名
- Workers 内 HW attestation 検証（TPMS_ATTEST パーサー + ECDSA P-256 verify）
- `user_devices` テーブルに `hw_pubkey`（bytea）カラム追加
- policy rollout（audit → enforce）

受入基準:

- 改変バイナリ検知（テスト方法: バイナリの 1 byte を変更して upload → `binary_hash` 不一致で audit/reject）
- Linux TPM 搭載端末で Quote 生成・検証成功 1,000 連続
- Windows TPM 搭載端末で CNG 署名・検証成功 1,000 連続
- TPM 非搭載端末で `hw_attestation_kind = "none"` が正しくサーバーに報告される
- `tss-esapi` bundled ビルドが CI/CD で成功（Linux x86_64）
- Windows ビルドが CI/CD で成功（MSVC x86_64）

## Phase 3b（将来）— macOS Secure Enclave

- `SecureEnclaveAttestor` 実装
- Apple Developer 証明書によるコード署名設定
- macOS CI/CD パイプライン構築

受入基準:

- macOS (Apple Silicon) で Secure Enclave 署名・検証成功
- 古い Intel Mac（Secure Enclave なし）で `hw_attestation_kind = "none"` 報告

---

## 12. エラーコード

- `INTEGRITY_REPLAY_DETECTED` (409)
- `INTEGRITY_HASH_MISMATCH` (400)
- `INTEGRITY_APP_ATTESTATION_INVALID` (401)
- `INTEGRITY_APP_POLICY_REJECTED` (403)
- `INTEGRITY_BINARY_NOT_WHITELISTED` (403)
- `INTEGRITY_PINSET_EXPIRED` (401)
- `INTEGRITY_PIN_VALIDATION_FAILED` (401)
- `INTEGRITY_TPM_QUOTE_INVALID` (401)
- `INTEGRITY_HW_ATTESTATION_INVALID` (401)
- `INTEGRITY_HW_NOT_AVAILABLE` (403) — policy が `reject` 時のみ

---

## 13. 禁止事項

1. JSON stringify ハッシュ
2. 可変順序署名対象
3. pinset ディスク永続化
4. KV 単体 replay 制御
5. `tpm2-tools` CLI への subprocess 依存（`tss-esapi` bundled を使う）
6. ランタイムでの外部ライブラリ/ツールの存在チェックによるフォールバック
7. 独立した TPM/HW verify service の構築（Workers 内で完結する）
8. HW 非搭載を「ライブラリ未インストール」と混同すること
9. 外部ゲームサーバー通信に対する fail-closed pinning の強制

---

## 14. 実装完了時に必須で報告する項目

- 変更ファイル一覧
- gate の判定順序と実装位置
- migration 適用結果
- 実行した検証コマンドと結果
- 未検証リスク
- `fusou-auth` の `reqwest` 統一結果
- `INTEGRITY_DB` のバインディング確認
- `binary_whitelist` の初期登録結果
