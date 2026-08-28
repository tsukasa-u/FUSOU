# FUSOU: Game Account Identity Attestation & Dataset Attribution 仕様書 (v1 Scope)

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-hudsucker`, `packages/fusou-proxy-tlsn`, `packages/fusou-telemetry`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers / Dedicated Verifier Service）  
> **v1 Core Security Goal**:  
> **「FUSOU v1 は、ログイン時の `POST /kcsapi/api_get_member/require_info` に含まれる `/api_data/api_basic/api_member_id` についてのみ TLSNotary による Game Server provenance を確立し、その証明済み Game Account を `public_id` へ固定する。その後の Telemetry は内容を信頼せず、認証済み Dataset/Device credential からサーバー側で所属 Dataset を決定して保存する（Dataset Attribution / Provenance 保証）。」**  
> 対象 API: **`POST /kcsapi/api_get_member/require_info`**（1つの Game Login Session で最初に正常取得された 1 回のみ）  
> 対象データ: **`/api_data/api_basic/api_member_id`**（Wire: `i64` from `kc-api-dto`, Canonical Internal: Decimal String）  
> **最重要設計原則**:  
> 1. **Identity Attestation と Telemetry Submission の完全分離**:  
>    - **① Identity Attestation（暗号学的保証）**: ログインセッション開始時の最初の `require_info` を FUSOU-Prover と Game Server 間の TLSNotary MPC-TLS セッションで公証し、Game Account（`api_member_id`）$\rightarrow$ `member_id_mapping` $\rightarrow$ Dataset（`public_id`）$\rightarrow$ Social User（`web_user_member_map`）$\rightarrow$ Authorized Device（`user_devices`）の身元連鎖（Identity Chain）を確立する。  
>    - **② Telemetry Submission（内容は UNTRUSTED / 所属先 Dataset は TRUSTED）**: 戦闘等のテレメトリデータ自体は暗号公証せず、クライアントはリクエスト内に `member_id`, `public_id`, `dataset_id`, `owner user_id` などの所属識別子を一切含めない。  
> 2. **MPC-TLS 処理 3 段階と Browser 待機の分離**:  
>    - **Phase A**: Request routing / upstream connection  
>    - **Phase B**: MPC-TLS による Response plaintext 取得（**MPC-TLS response acquisition remains on the login API path** / 許容遅延は Phase 0 で実測）  
>    - **Phase C**: Presentation 生成 + Remote verification + DB claim（**Post-processing is not on critical path**）  
> 3. **Device ↔ Proof の暗号学的バインディング（Server-issued One-Time Challenge & Byte Layout 完全固定）**:  
>    - `public_id` はクライアントが任意選択せず、サーバーが `verified_member_id` から導出する。  
>    - **Trust Authority の分離**: TLSNotary Verifier を `Cryptographic Verification Authority`、FUSOU-WEB / Supabase を `Application / Identity / Dataset Authorization Authority` として役割を明確化。  
>    - **TLSNotary 公式 Attestation 識別子の一本化**: `ClaimBindingBytes` には、Phase 0 で採用する exact TLSNotary revision の公式識別子 **`tlsn_attestation_id = Attestation.header().id` の exact binary bytes** を格納し、Length-delimited binary framing（Domain: `"FUSOU-IDENTITY-CLAIM-V1"`, `uint16_be(len)`）によりバイト列を安全に固定する。  
>    - **Attestation 再利用の DB 遮断**: `member_ownership_claims` テーブルに `UNIQUE (tlsn_attestation_id)` 制約を課し、同一 Attestation による二重 Claim を確実に拒絶する。  
> 4. **Telemetry Ingest における厳格な Attribution 決定権 & Immutable 記録**:  
>    - **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。`api_path` は informational metadata であり認可判断には使用しない。」**  
>    - 提出された Telemetry レコードの `(public_id, submitted_by_device_id)` は **提出時点（submission time）の事実として Immutable に保存** され、将来のデバイス再バインド時にも過去データは一切更新されない。  
> 5. **Dual Authentication & Replay Protection（DB 永続化 Nonce + Raw Body Hash Idempotency）**:  
>    - Telemetry アップロード時は `Authorization: Bearer <dataset-token>` に加え、`X-FUSOU-Device-ID`, `X-FUSOU-Nonce`, `X-FUSOU-Timestamp`, `X-FUSOU-Signature`（Ed25519）を要求。  
>    - サーバー側で `telemetry_nonces` テーブルに記録してリプレイを遮断（許容窓 ±5 分、保持期間 10 分、`device_id` は Never-reused）。  
>    - `body_hash = sha256(raw_body_bytes)` と `ingest_item_id` により、同一 ID かつ Body 一致時は 200/201 冪等成功、Body 不一致時は 409 Conflict で拒絶。  
> 6. **再送信ゼロ（No Re-submission）**:  
>    - **設計要件 (Design Requirement)**: FUSOU must not intentionally retry the same logical request.（FUSOU は同一 logical request を意図的に再送してはならない）  
>    - **検証結果 (Verification Instrument)**: Phase 0 test instrumentation must demonstrate zero FUSOU-generated duplicate sends.  
> 7. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 8. **Fallback 時のステータス明示**:  
>    Notary 障害時は `GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED` の状態へ安全にフォールバックし、ゲームプレイを継続する。  
> **ステータス**: 実装開始前最終確定・完全凍結版マスター仕様書 (Freeze for Phase 0)  

---

## 目次

1. [Goal & Concept (Identity Attestation と Dataset Attribution の分離)](#1-goal--concept-identity-attestation-と-dataset-attribution-の分離)
2. [Threat Model & Security Guarantees（脅威モデルと保証境界）](#2-threat-model--security-guarantees脅威モデルと保証境界)
3. [Trust Boundary & Authority Separation（信頼境界 & 認証・検証機関の分離）](#3-trust-boundary--authority-separation信頼境界--認証検証機関の分離)
4. [Identity Architecture & Invariant（ID基盤と不変条件の段階的成立）](#4-identity-architecture--invariantid基盤と不変条件の段階的成立)
5. [require_info TLSNotary Protocol (`POST /kcsapi/api_get_member/require_info`)](#5-require_info-tlsnotary-protocol-post-kcsapiapi_get_memberrequire_info)
   - 5.1 [セッション最初の 1 回の定義と再試行ポリシー](#51-セッション最初の-1-回の定義と再試行ポリシー)
   - 5.2 [MPC-TLS 処理 3 段階と Browser 待機の分離](#52-mpc-tls-処理-3-段階と-browser-待機の分離)
   - 5.3 [Transcript Range Selection & 構造化 HTTP Parser](#53-transcript-range-selection--構造化-http-parser)
   - 5.4 [Application-level Validation & 多段抽出 (kc-api-dto 整合)](#54-application-level-validation--多段抽出-kc-api-dto-整合)
6. [Device ↔ Proof Binding & Social Account Linking](#6-device--proof-binding--social-account-linking)
   - 6.1 [TLSNotary Attestation.header().id と ClaimBindingBytes の完全固定 Byte Layout](#61-tlsnotary-attestationheaderid-と-claimbindingbytes-の完全固定-byte-layout)
   - 6.2 [Server-issued One-Time Challenge の DB ライフサイクル](#62-server-issued-one-time-challenge-の-db-ライフサイクル)
   - 6.3 [Attestation Reuse Prevention（同一証明書の多重 Claim 遮断）](#63-attestation-reuse-prevention同一証明書の多重-claim-遮断)
   - 6.4 [Social Account Binding と Invariant 段階的成立](#64-social-account-binding-と-invariant-段階的成立)
   - 6.5 [Dataset Token の発行条件（Triple Verified Issuance）](#65-dataset-token-の発行条件triple-verified-issuance)
7. [Telemetry Submission Protocol (Dual Auth: Token + Device Signature)](#7-telemetry-submission-protocol-dual-auth-token--device-signature)
   - 7.1 [Telemetry Ingest 原則 & Immutable 帰属保証](#71-telemetry-ingest-原則--immutable-帰属保証)
   - 7.2 [リクエスト仕様 & Idempotency / DB Nonce Retention](#72-リクエスト仕様--idempotency--db-nonce-retention)
   - 7.3 [サーバー側処理パイプライン](#73-サーバー側処理パイプライン)
8. [Rust Workspace クレート分割設計 & utils/pepper.ts 移行](#8-rust-workspace-クレート分割設計--utilspepperts-移行)
9. [FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)](#9-fusou-web-verifier-アーキテクチャ-workers-vs-dedicated-rust-verifier)
10. [DB Schema（Supabaseマイグレーション: Challenge, Nonce, Telemetry）](#10-db-schemasupabaseマイグレーション-challenge-nonce-telemetry)
11. [Failure Handling & Fallback Semantics (Phase A / Phase B)](#11-failure-handling--fallback-semantics-phase-a--phase-b)
12. [Recovery & Re-binding Policy（用語の明確な分離）](#12-recovery--re-binding-policy用語の明確な分離)
13. [Testing（網羅的セキュリティ・競合テストケース）](#13-testing網羅的セキュリティ競合テストケース)
14. [Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）](#14-phase-0-poc--gono-go-criteria実測検証計画と判定基準)
15. [Migration & Rollout Plan](#15-migration--rollout-plan)
16. [Security Progress Checklist（開発進捗チェックリスト）](#16-security-progress-checklist開発進捗チェックリスト)

---

## 1. Goal & Concept (Identity Attestation と Dataset Attribution の分離)

### 1.1 背景と設計思想の転換
FUSOU において真に防ぐべき攻撃は、**「悪意ある第三者が、他人のゲームアカウント（`api_member_id`）や他人の Social アカウントになりすまして偽の戦闘データを送信し、特定プレイヤーの統計やコミュニティデータを汚染すること（Attribution 偽装 / なりすまし攻撃）」** です。

したがって、v1 では「戦闘データの中身が本物か」を毎戦闘ごとに重い MPC-TLS で公証する過剰設計を排し、**ログインセッション最初の `require_info` で 1 回だけ強固に Game Account の身元（Identity Provenance）を暗号公証し、以降の全テレメトリはその確定された Dataset Identity（`public_id`）にサーバー側で自動帰属（Attribution）させる** アーキテクチャを採用します。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ① Identity Attestation (セッション最初 1 回のみ / 暗号学的に保証)                │
│                                                                                 │
│  FUSOU-Prover ──(MPC-TLS)──▶ Game Server (require_info) ──▶ TLSNotary Proof     │
│                                                                   │             │
│                                                                   ▼             │
│                                                          verified api_member_id │
│                                                                   │             │
│                                                                   ▼             │
│                                                          member_id_mapping      │
│                                                                   │             │
│                                                                   ▼             │
│                                                          expected public_id     │
│                                                          ├── Social User A      │
│                                                          └── Device A (署名検証)│
│                                                              (One-Time Challenge│
│                                                               binary framing)   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ 発行: Dataset Token (Triple Verified 後発行)
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ② Telemetry Submission (常時・軽量 / 内容は UNTRUSTED / 所属先 Dataset は TRUSTED)│
│                                                                                 │
│  Device A ──▶ POST /telemetry/upload                                            │
│               - Authorization: Bearer <dataset-token>                           │
│               - X-FUSOU-Signature: Ed25519(SignDoc)                             │
│               - X-FUSOU-Nonce (DB telemetry_nonces 単一消費: 10分保持)          │
│               ※ Payload に member_id / public_id / dataset_id は一切含めない     │
│                                                                                 │
│  FUSOU-WEB が Credential から Dataset U1 を確定し、U1 のデータとして DB 保存       │
│  (提出時点の所属事実として Immutable に永続化 / 同一 ID 異 Body は 409 Conflict)    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Model & Security Guarantees（脅威モデルと保証境界）

### 2.1 防げる攻撃（Security Guarantees: シナリオ追跡）
* **A. 攻撃者が任意の `member_id` を自己申告登録する攻撃**:  
  自己申告登録は `PRE_REGISTERED`（未検証 Dataset Claim）として扱われ、Game Account Identity の身元保証は一切付与されません。正規オーナーが `require_info` 証明を提出した時点でアトミックに無力化されます。
* **B. 被害者の有効な Proof P を盗聴・傍受して攻撃者端末にバインドする攻撃**:  
  Server-issued Challenge（`challenge_nonce`）に対する署名には被害者端末の秘密鍵が必要なため、有効な Device B の公開鍵では Device A にバインドされた Claim を暗号学的に検証できず拒絶されます（端末すり替え拒絶）。
* **C. クライアントが Telemetry 内で他人の `member_id` を指定する攻撃**:  
  Telemetry ペイロード内の `member_id` はサーバーの認可判断から完全排除され、無視されます。
* **D. クライアントが Telemetry 内で他人の `public_id` / Dataset ID を指定する攻撃**:  
  サーバーは `dataset_token` から `public_id` を導出するため、クライアント指定の `public_id` は完全無視されます。
* **E. クライアントが Telemetry 内で他人の `owner user_id` を指定する攻撃**:  
  同様に認可判断から完全排除され、無視されます。
* **F. 同一 Telemetry リクエストの再生（Replay 攻撃）**:  
  `telemetry_nonces` テーブル（10分保持）と ±5 分のタイムスタンプ窓により、同一 Nonce の再送信は 401/403 で拒絶されます。
* **G. クライアントによる Telemetry 本文の改ざん**:  
  Telemetry 内容自体は UNTRUSTED ですが、改ざんされたデータであっても「どの Dataset に所属して提出されたか（Attribution）」はサーバー側で厳格に確定されます。
* **H. 既存オーナー A の Game Account に対し第三者 B が Proof を提出する攻撃**:  
  Game Account アクセス証明 $\neq$ Social Account 所有権証明。一度確立された `member_ownership` は別ユーザーからの Claim で自動移転することはなく、`EXISTING_VERIFIED_OWNER_CONFLICT` で拒絶されます。
* **I. 端末の交換・追加（Device Replacement）**:  
  同一オーナー（同一 `canonical_user_id`）による新端末は、同一の `public_id` に対する追加端末として安全に登録されます。
* **J. Notary サーバーの障害**:  
  送信前障害時は通常 TLS へ切り替えて `GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED` でゲームプレイを継続。送信後障害時は同一リクエストの再送を厳禁とし `UNATTESTED` 扱いとします。
* **K. ゲーム API の二重送信・BAN リスク**:  
  FUSOU 自身によるリクエスト再送コードを完全排除し、設計要件および計測により FUSOU-generated duplicate = 0 を保証します。

### 2.2 防げない事項（Non-Guarantees）
* **Telemetry 内容の真正性**: 戦闘結果、ドロップ、資源、艦隊、装備等の内容自体が Game Server 由来であることは v1 では判定しません（UNTRUSTED payload）。
* **自端末の資格情報盗難時のデータ捏造**: 攻撃者がユーザー PC を完全支配して `Device A` の秘密鍵/トークンを窃取した場合、`Device A`（Dataset U1）として偽の戦闘データを送ることは防げません（TPM 等がない限り不可）。
  **ただしその場合でも、「登録済み Device / Dataset / Game Account の関係をクライアントが別の identity へ変更することを防ぐ」という保証は維持されます**。

---

## 3. Trust Boundary & Authority Separation（信頼境界 & 認証・検証機関の分離）

```
                     UNTRUSTED ZONE
┌────────────────────────────────────────────────────────┐
│ User PC (Client Environment)                           │
│                                                        │
│  - FUSOU binary (Tamperable)                           │
│  - Local Memory / Process (Inspectable)                │
│  - Local SQLite DB (Modifiable)                        │
│  - Browser / OS (Untrusted)                            │
│                                                        │
│  Client-provided metadata = NEVER trusted              │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ 1. TLSNotary Presentation (require_info)
                            │ 2. ClaimSignature = Ed25519(ClaimBindingBytes)
                            ▼
═════════════════════ TRUST BOUNDARY ═════════════════════
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ TLSNotary Verifier (Cryptographic Verification Auth)   │
│ (Cloudflare Workers WASM or Dedicated Rust Verifier)   │
│                                                        │
│  - Verify Web PKI Certificate Chain                    │
│  - Verify Attestation Proof & Merkle Root              │
│  - Verify Transcript Proof with transcript_commitments │
│  - Extract & Canonicalize verified_member_id           │
│  - Extract Attestation.header().id                     │
│  - Return Signed Verification Result (if Dedicated)   │
└───────────────────────────┬────────────────────────────┘
                            │ Verified Plaintext & Attestation.header().id
                            ▼
┌────────────────────────────────────────────────────────┐
│ FUSOU-WEB (Application / Authorization Authority)      │
│                                                        │
│  - Derive expected_public_id from verified_member_id   │
│  - Issue Server One-Time Challenge into DB (5min TTL)  │
│  - Verify ClaimBindingBytes Ed25519 Device Signature   │
│  - Strict Server-Side Canonical Validation (Zod)       │
│  - Issue Dataset Token post-verification               │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ [SECURITY BOUNDARY]
┌────────────────────────────────────────────────────────┐
│ Supabase Database (Trusted Core Storage: RPC Layer)    │
│                                                        │
│  - 64-bit Advisory Lock & Row-Level Locking            │
│  - Atomic Ownership Transfer (Strict 10 Steps)         │
│  - Enforce Quad Invariant (Post-Social Binding)        │
│  - Enforce Unique tlsn_attestation_id (Anti-Reuse)     │
│  - Atomic Challenge & Proof Consumption Enforcement    │
│  - Append-Only Audit Trail with proof_purpose          │
│                                                        │
│  Stored State = ACCEPTED Verified Evidence Only        │
└────────────────────────────────────────────────────────┘
```

---

## 4. Identity Architecture & Invariant（ID基盤と不変条件の段階的成立）

### 4.1 `api_member_id` と `public_id` の責務分離
```
api_member_id (例: 12345678: i64)
       │
       │ (TLSNotary provenance 検証)
       ▼
member_id_mapping (Service-role only: Root of Game Identity)
       │
       ▼
public_id = UUIDv4 (Random UUID: Dataset U1)
       │
       ├───────────────▶ member_ownership (verified_user_id = Auth User A)
       ├───────────────▶ user_member_map (user_id = Auth User A)
       ├───────────────▶ web_user_member_map (user_id = Social User A)
       ├───────────────▶ user_devices (device_id = Device A)
       └───────────────▶ telemetry_events (public_id = U1)
```

### 4.2 Invariant の段階的成立
1. **`GAME_IDENTITY_VERIFIED` 時点**:
   $$\text{member\_ownership.verified\_user\_id} \equiv \text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \quad (\text{Triple Invariant})$$
2. **`SOCIAL_ACCOUNT_BOUND`（OAuth 明示的バインディング完了）以降**:
   $$\text{上記 3 者} \equiv \text{web\_user\_member\_map.user\_id} \quad (\text{Quad Invariant})$$

---

## 5. require_info TLSNotary Protocol (`POST /kcsapi/api_get_member/require_info`)

### 5.1 セッション最初の 1 回の定義と再試行ポリシー
* **対象**: 1 つの Game Login Session において **最初に正常取得された `require_info` のみ** を Identity Attestation の対象とします。
* **セッション中の再試行**: 最初に成功した `require_info` のうち、TLSNotary-capable session で正常取得できたものを公証対象とします。同一 session 中に証明が成立していない場合は同一リクエストの再送を行わず、ゲームクライアント自身の自然な再試行が発生した場合のみ、新しい TLSNotary session として扱います。

### 5.2 MPC-TLS 処理 3 段階と Browser 待機の分離
1. **Phase A (Request Routing / Upstream Connection)**:  
   ブラウザから受信したリクエストを検知し、Game Server への MPC-TLS 接続を確立。
2. **Phase B (MPC-TLS Response Acquisition)**:  
   Prover と Notary 間で MPC ハンドシェイクおよび共同復号を実行し、Response plaintext を取得。  
   > **注意**: この区間は Browser が待つ同期区間となります（**MPC-TLS response acquisition remains on the login API path**）。この追加遅延の許容範囲は Phase 0 PoC で実測検証します。
3. **Phase C (Presentation Generation & Verification & DB Claim)**:  
   バックグラウンドタスク（`tokio::spawn`）で Presentation を構築し、FUSOU-WEB での検証および DB Claim を実行。  
   > **原則**: この区間は Browser の待機条件から完全に除外されます（**Post-processing is not on critical path**）。

### 5.3 Transcript Range Selection & 構造化 HTTP Parser
* **Transcript Range Selection**:
  Phase 0 PoC において、`revealedReq` および `revealedRecv` が HTTP リクエスト/レスポンスの完全な境界（HTTP Method, Path, Headers, Body の開始・終了）を過不足なく含んでいることを TLSNotary Transcript Range 抽出機構にて保証・確認します。
* **構造化 HTTP Parser**: 正規表現による文字列検索を排し、構造化 HTTP パーサーにより `method === POST`, `path === /kcsapi/api_get_member/require_info`, `HTTP version === 1.1` を検証。
* **Trusted Server Identity Policy**: 単一のホスト名固定ではなく、TLS Certificate Chain、Expected DNS パターン（`*.kcs.dmm.com`）、および Allowed Hostname Policy に基づいて Game Server の真正性を検証。

### 5.4 Application-level Validation & 多段抽出 (kc-api-dto 整合)
```typescript
// packages/FUSOU-WEB/src/server/utils/require_info_parser.ts

import { z } from 'zod';

const CanonicalRequireInfoSchema = z.object({
  api_path: z.literal('/kcsapi/api_get_member/require_info'),
  api_member_id: z.string().regex(/^[0-9]{1,16}$/), // Canonical internal representation = decimal string
});

export type CanonicalRequireInfoResult = z.infer<typeof CanonicalRequireInfoSchema>;

export function parseCanonicalRequireInfo(
  revealedReq: Uint8Array,
  revealedRecv: Uint8Array
): CanonicalRequireInfoResult {
  // 1. 構造化 Request パース
  const reqStr = new TextDecoder().decode(revealedReq);
  const matchReq = reqStr.match(/^POST\s+(\/kcsapi\/api_get_member\/require_info)\s+HTTP\/1\.[01]/m);
  if (!matchReq) {
    throw new Error('invalid_or_unauthorized_request_path');
  }

  // 2. Response svdata プレフィックスおよび JSON 構造の厳格多段パース
  const recvStr = new TextDecoder().decode(revealedRecv);
  const headerEnd = recvStr.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('http_headers_malformed');

  const bodyStr = recvStr.slice(headerEnd + 4).trim();
  if (!bodyStr.startsWith('svdata=')) {
    throw new Error('svdata_prefix_missing_at_body_start');
  }

  const rawJson = JSON.parse(bodyStr.slice(7).trim());
  if (rawJson.api_result !== 1) throw new Error('api_result_not_ok');
  if (!rawJson.api_data || !rawJson.api_data.api_basic) throw new Error('api_basic_missing');

  const rawMemberId = rawJson.api_data.api_basic.api_member_id;
  if (typeof rawMemberId !== 'number' || !Number.isSafeInteger(rawMemberId)) {
    throw new Error('api_member_id_invalid_integer');
  }

  return CanonicalRequireInfoSchema.parse({
    api_path: matchReq[1],
    api_member_id: String(rawMemberId),
  });
}
```

---

## 6. Device ↔ Proof Binding & Social Account Linking

### 6.1 TLSNotary `Attestation.header().id` と `ClaimBindingBytes` の完全固定 Byte Layout

#### 6.1.1 Attestation 識別子の一本化
曖昧な候補（canonical proof digest 等）を完全排除し、Phase 0 で採用する exact TLSNotary revision の **`tlsn_attestation_id = Attestation.header().id`（exact binary bytes）** に一本化します。

#### 6.1.2 全フィールドの厳密な Encoding・Byte Layout 定義
各フィールドのバイナリ型・エンコーディング・バイト長を以下のように完全固定します：

| 順序 | フィールド名 | データ型 / エンコーディング | バイト長 | 説明 |
|:---:|---|---|---|---|
| 1 | `domain_tag` | Raw ASCII bytes | 23 bytes | `"FUSOU-IDENTITY-CLAIM-V1"` |
| 2 | `tlsn_attestation_id` | Exact Binary Bytes | $N$ bytes (Phase 0 固定) | `Attestation.header().id` |
| 3 | `verified_member_id` | UTF-8 decimal ASCII | 1〜16 bytes | 検証済みゲームアカウント ID（例: `"12345678"`） |
| 4 | `device_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | 提出端末の Device UUID |
| 5 | `expected_public_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー導出 Dataset UUID |
| 6 | `challenge_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー発行 Challenge UUID |
| 7 | `challenge_nonce` | Raw Binary Bytes | 32 bytes | サーバー発行 One-Time Nonce |

* **Length-Delimited Binary Framing**:
  全フィールドの直前に 2 バイトの Big-endian 長さヘッダー（`uint16_be(len)`）を付加して連結：
  $$\text{ClaimBindingBytes} = \text{u16}(23) \Vert \text{"FUSOU-IDENTITY-CLAIM-V1"} \Vert \text{u16}(\text{len(att\_id)}) \Vert \text{att\_id} \Vert \text{u16}(\text{len(mid)}) \Vert \text{mid} \Vert \text{u16}(16) \Vert \text{dev} \Vert \text{u16}(16) \Vert \text{pub} \Vert \text{u16}(16) \Vert \text{cid} \Vert \text{u16}(32) \Vert \text{nonce}$$
  $$\text{ClaimSignature} = \text{Ed25519\_Sign}(sk_{\text{device}}, \text{ClaimBindingBytes})$$

### 6.2 Server-issued One-Time Challenge の DB ライフサイクル
1. **Challenge 発行 (`issue`)**:  
   FUSOU-WEB は TLSNotary Verifier からの検証結果を受け取り `verified_member_id` から `expected_public_id` を導出後、暗号論的乱数 `challenge_nonce` (32 bytes) を生成し `public.claim_challenges` に 5 分の有効期限（`expires_at = NOW() + INTERVAL '5 minutes'`）で INSERT。
2. **Challenge 送信**: クライアントへ `{ challenge_id, expected_public_id, challenge_nonce, expires_at }` を返却。
3. **Challenge 検証 & 単一消費 (`consume`)**:  
   クライアントから署名を受信した際、`claim_verified_device_v3` 内で以下のアトミック消費を実行：
   ```sql
   UPDATE public.claim_challenges
   SET consumed_at = NOW()
   WHERE challenge_id = p_challenge_id
     AND challenge_nonce = p_challenge_nonce
     AND public_id = v_public_id
     AND device_id = p_device_id
     AND consumed_at IS NULL
     AND expires_at > NOW();
   ```
   更新行数が 0 件の場合は `INVALID_OR_EXPIRED_CHALLENGE` として即座にロールバック。

### 6.3 Attestation Reuse Prevention（同一証明書の多重 Claim 遮断）
Challenge の One-Time 性（Replay 防御）に加え、**同一の Attestation（Proof）を別 Challenge で複数回 Identity Claim に持ち込む Attestation Reuse 攻撃を遮断** するため、`member_ownership_claims` テーブルに `tlsn_attestation_id` を格納し `UNIQUE` 制約を課します。
`claim_verified_device_v3` 内で同一 `tlsn_attestation_id` が既に存在する場合は `DUPLICATE_ATTESTATION_CLAIMED` 例外を送出し、即時ロールバックします。

### 6.4 Social Account Binding と Invariant 段階的成立
* **状態の段階的遷移**:
  1. `GAME_IDENTITY_VERIFIED`: TLSNotary Proof により `api_member_id` $\leftrightarrow$ `public_id` $\leftrightarrow$ `user_devices` が確定した状態。
     $$\text{member\_ownership.verified\_user\_id} \equiv \text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \quad (\text{Triple Invariant 成立})$$
  2. `SOCIAL_ACCOUNT_BOUND`: OAuth 認証済み Web ユーザーが明示的なバインディング操作を行い、`web_user_member_map` に登録された状態。
     $$\text{上記 3 者} \equiv \text{web\_user\_member\_map.user\_id} \quad (\text{Quad Invariant 成立})$$

### 6.5 Dataset Token の発行条件（Triple Verified Issuance）
Telemetry 投稿用 `dataset_token` は、**Game Identity Verified + Device Authorized + Social Account Bound** の 3 条件がすべて揃った時点で発行されます：
$$\text{require\_info verified} \longrightarrow \text{device claim accepted} \longrightarrow \text{social account bound} \longrightarrow \text{dataset\_token issued}$$

---

## 7. Telemetry Submission Protocol (Dual Auth: Token + Device Signature)

### 7.1 Telemetry Ingest 原則 & Immutable 帰属保証
> **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。`api_path` は informational metadata であり認可判断には使用しない。」**  
> **「DB に格納された Telemetry レコードの `(public_id, submitted_by_device_id)` は提出時点の事実として Immutable であり、将来のデバイス再バインドや所有者変更によって過去データが更新されることはない。」**

### 7.2 リクエスト仕様 & Idempotency / DB Nonce Retention
```http
POST /api/v1/telemetry/ingest HTTP/1.1
Host: api.fusou.dev
Authorization: Bearer <dataset-token>
X-FUSOU-Device-ID: 00000000-0000-4000-8000-000000000000
X-FUSOU-Timestamp: 1756200000
X-FUSOU-Nonce: a1b2c3d4e5f6
X-FUSOU-Signature: <base64-encoded-ed25519-signature>
Content-Type: application/json

{
  "ingest_item_id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "api_path": "/kcsapi/api_req_sortie/battleresult",
  "event_time": "2026-08-28T04:00:00Z",
  "data": {
    "api_win_rank": "S",
    "api_get_ship": { "api_ship_id": 421 }
  }
}
```

* **署名対象ペイロード（Canonical Serialization）**:
  $$\text{SignDoc} = \text{POST} \mathbin{\Vert} \text{/api/v1/telemetry/ingest} \mathbin{\Vert} \text{Nonce} \mathbin{\Vert} \text{Timestamp} \mathbin{\Vert} \text{SHA256(RawBodyBytes)} \mathbin{\Vert} \text{public\_id}$$
* **DB レベル Nonce Replay Protection & クリーンアップ運用**:
  - `device_id` は UUIDv4 であり **Never-reused**。
  - `X-FUSOU-Timestamp` は ±5 分（±300秒）以内のみ受理。
  - `telemetry_nonces` に `(device_id, nonce)` を INSERT して消費。データは 10 分間保持し、定期ジョブ（pg_cron: `DELETE FROM telemetry_nonces WHERE first_seen_at < NOW() - INTERVAL '10 minutes'`）で自動パージ。
* **Raw Body Hash による厳格な Idempotency**:
  同一 `ingest_item_id` が既に存在する場合、保存済み `body_hash`（`sha256(raw_body_bytes)`）と完全一致すれば 200/201 冪等成功、不一致であれば 409 Conflict で拒絶。
* **Time Distinction**: `event_time` は UNTRUSTED なクライアント申告時刻であり、DB の `received_at`（TRUSTED サーバー受信時刻）と明確に区別して記録。

### 7.3 サーバー側処理パイプライン
1. `Authorization` ヘッダーから `dataset_token` を検証し `public_id` (U1) を抽出。
2. `X-FUSOU-Signature` を `user_devices.device_pubkey` で検証。
3. `telemetry_nonces` に `(device_id, nonce)` を消費記録（重複時は即座に遮断）。
4. `user_devices` が `is_verified = TRUE AND revoked_at IS NULL` であることを確認。
5. テレメトリレコードを **`public_id`（Dataset U1）の所有データとして INSERT**（Idempotency チェック適用）。

---

## 8. Rust Workspace クレート分割設計 & utils/pepper.ts 移行

```
packages/
├── fusou-auth/               # DeviceKey / Ed25519 署名 / Token管理 (既存実装再利用)
├── fusou-proxy-core/         # Proxy ライフサイクル・HTTP 抽象化・UpstreamTransport Trait
├── fusou-proxy-hudsucker/    # 通常ゲーム通信用 MITM プロキシ実装 (低遅延最優先)
├── fusou-proxy-tlsn/         # require_info 専用 TLSNotary MPC-TLS Upstream トランスポート（PoC対象）
├── fusou-telemetry/          # 軽量テレメトリ キュー・SQLite 永続化・バッチ送信
└── FUSOU-APP/                # Composition Root (DI コンテナ)
```

> **命名 & 実装リファクタリング**: `packages/FUSOU-WEB/src/server/utils/pepper.ts` はレガシーな stateless HMAC チャレンジであるため、これを DB-backed One-Time Challenge（`public.claim_challenges`）および Ed25519 デバイス署名検証を行う **`packages/FUSOU-WEB/src/server/utils/device-auth.ts`** へ完全移行・改称します。

---

## 9. FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)

TLSNotary は active development 中（breaking changes が発生し得る）であるため、**Phase 0 終了時に採用する exact git tag / commit revision を確定・固定** します。

1. **Option A (Cloudflare Workers + WASM Verifier)**:
   Workers 内で `@tlsnotary/tlsn-js` または `tlsn-verifier-wasm` を直接実行。
2. **Option B (Dedicated Rust Verifier Service: 推奨フォールバック)**:
   `FUSOU-APP -> TLSNotary Verifier Service (Rust Native: Ed25519署名付き検証結果返却) -> FUSOU-WEB -> Supabase`。

---

## 10. DB Schema（Supabaseマイグレーション: Challenge, Nonce, Telemetry）

### `20260826010000_create_telemetry_attribution_tables.sql`
```sql
BEGIN;

-- 1. Server-issued One-Time Claim Challenge テーブル
CREATE TABLE IF NOT EXISTS public.claim_challenges (
    challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    challenge_nonce BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_challenges_active 
    ON public.claim_challenges (challenge_id, expires_at) 
    WHERE consumed_at IS NULL;

-- 2. Telemetry リプレイ防御用 Nonce テーブル (10分保持)
CREATE TABLE IF NOT EXISTS public.telemetry_nonces (
    device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    nonce TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (device_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_nonces_cleanup 
    ON public.telemetry_nonces (first_seen_at);

ALTER TABLE public.telemetry_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full access to telemetry_nonces"
    ON public.telemetry_nonces
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 3. Telemetry イベント格納テーブル (Immutable イベントストア)
CREATE TABLE IF NOT EXISTS public.telemetry_events (
    ingest_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    submitted_by_device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    api_path TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_dataset_time 
    ON public.telemetry_events (public_id, event_time DESC);

ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full access to telemetry_events"
    ON public.telemetry_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMIT;
```

---

## 11. Failure Handling & Fallback Semantics (Phase A / Phase B)

* **Phase A（リクエスト送信前）**:
  Game Server へのリクエスト送信前に MPC session が成立しない場合、直ちに通常の TLS 接続へ切り替えて `require_info` を送信。
  - 状態: `GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED`
  - ゲームログインは継続し、未検証状態を維持します。
* **Phase B（リクエスト送信後）**:
  リクエスト送信後に MPC session が失敗した場合、**同一リクエストの再送は厳格に禁止（BAN 回避 / FUSOU-generated duplicate = 0）**。
  - 状態: `UNATTESTED`
  - `MPC-TLS request sent -> Verifier failure -> NO automatic replay, NO second upstream request -> If plaintext already fully available: may return original response; else: cannot reconstruct response from TLS.`
  - Browser への継続可否は「Prover が既に取得済みの plaintext が存在するか」に依存します（Phase 0 で実測検証）。公証タスクのみ破棄し、次回以降の自然な再試行時に新しい TLSNotary session として扱います。

---

## 12. Recovery & Re-binding Policy（用語の明確な分離）

概念および用語を厳格に分離して運用します：
1. **Game Account Identity Provenance**: TLSNotary による「その時点で正規の `api_member_id` セッションを所持・操作している事実の証明」。
2. **Dataset Attribution**: Telemetry データを特定 Dataset (`public_id`) にサーバー側で確定・帰属させる保証。
3. **Social Account Binding**: OAuth 認証ユーザーによる明示的なアカウント紐付け操作。
4. **Device Replacement (端末追加・失効)**: 同一オーナー（同一 `canonical_user_id`）が新端末を導入する場合、同一 `public_id` に対して新端末を `user_devices` に追加登録（Owner は不変）。
5. **Re-binding & Transfer Policy**: Game Account アクセス証明 $\neq$ Social Account 所有権証明。異なる Web ユーザーからの Claim は自動移転せず、明示的なリカバリ / 移転プロトコルを通じてのみ実行可能。

---

## 13. Testing（網羅的セキュリティ・競合テストケース）

1. **事前登録攻撃奪還テスト**: 攻撃者が `PRE_REGISTERED` 登録後に正規ユーザーが公証提出 $\rightarrow$ 攻撃者端末のみ Revoke され所有権が正規ユーザーへ移転。
2. **端末すり替え遮断テスト**: Proof P（`member_id = 1234`）に対し別 Device B の署名を提出 $\rightarrow$ 有効な Device B の公開鍵では Claim を検証できず拒絶。
3. **Attestation 再利用遮断テスト**: 同一 `tlsn_attestation_id` で別 Challenge を提出 $\rightarrow$ `DUPLICATE_ATTESTATION_CLAIMED` で拒絶。
4. **`public_id` 改変遮断テスト**: クライアントが署名メッセージ内の `public_id` を書き換えて提出 $\rightarrow$ 400/403 拒絶。
5. **Challenge 再生遮断テスト**: 同一 `challenge_nonce` を 2 回提出 $\rightarrow$ 400 拒絶。
6. **期限切れ Challenge 遮断テスト**: 5 分以上経過した Challenge で提出 $\rightarrow$ 400 拒絶。
7. **Telemetry Replay 遮断テスト**: 同一 `device_id + nonce` を再送信 $\rightarrow$ 401/403 拒絶。
8. **Telemetry 冪等性テスト**: 同一 `ingest_item_id` で Body 一致時は 200/201、Body 不一致時は 409 Conflict。
9. **並行 Claim 競合テスト**: 2 台の端末から同時に Claim 実行 $\rightarrow$ 64-bit Advisory Lock と親行ロックにより直列化。

---

## 14. Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）

### 14.1 検証項目（全23項目）
1. `POST /kcsapi/api_get_member/require_info` を対象にできる
2. Game Server への request は FUSOU 自身が二重送信しない（Phase 0 test instrumentation must demonstrate zero FUSOU-generated duplicate sends）
3. TLSNotary proof が正常に verify できる
4. Server identity（Web PKI / DNS）が正常に verify できる
5. `verified_member_id` の抽出が成功する
6. Transcript Range Selection による必要バイト範囲の完全な切り出しが成立する
7. Selective disclosure による最小限開示が成立する
8. 正当な Device 署名が accept される
9. 別 Device の署名が reject される
10. 同一 Attestation の再利用が reject される（Anti-Reuse）
11. `public_id` 改変が reject される
12. Challenge reuse が reject される
13. Expired challenge が reject される
14. Preemptive claim が reject される
15. Social account binding が正常に機能する
16. Token 発行順序が正しい（Triple Verified）
17. Telemetry payload による identity 上書きが排除される
18. 同一 Nonce replay が reject される
19. 同一 `ingest_item_id` + 同一 Body が idempotent success となる
20. 同一 `ingest_item_id` + 異なる Body が 409 Conflict となる
21. Device 再バインド時も過去 Telemetry の attribution が書き換わらない
22. リクエスト送信前の Notary 障害時フォールバックが機能する
23. Browser-visible な追加遅延および Proof completion 遅延の実測

### 14.2 Phase 0 GO / NO-GO 判定基準
| 分類 | 必須条件 (MUST PASS) | 判定基準 |
|---|---|:---:|
| **プロトコル** | FUSOU 生成の二重送信ゼロ | Phase 0 test instrumentation must demonstrate zero FUSOU-generated duplicate sends |
| **暗号検証** | TLSNotary Proof 検証成功 | Notary 署名・Attestation Header/Body 検証完全一致 |
| **データ抽出** | `api_member_id` の正確な抽出 | レスポンス平文と抽出値が一致 |
| **バインディング** | `ClaimBindingBytes` 偽造不能 | 他端末秘密鍵・別 Nonce での Claim を遮断 |
| **端末すり替え拒絶** | 検証済み Proof に対する別 Device 署名拒絶 | **Proof P (member 1234) + Device B 署名 $\rightarrow$ 拒絶** |
| **Attestation 再利用遮断** | 同一 Attestation の多重 Claim 拒絶 | **Proof P + Challenge C2 $\rightarrow$ 拒絶 (Anti-Reuse)** |
| **所属決定権** | クライアントによる Dataset 選択排除 | Payload 内の `public_id` 改変を完全無視 |
| **リプレイ防御** | DB Nonce & Idempotency 検証 | 同一 Nonce 拒絶、同一 ID 異 Body で 409 Conflict |
| **耐障害性** | 送信前 Notary 障害時のログイン継続 | 通常 TLS フォールバックでゲームプレイ継続 |
| **接続性** | 外部中継プロキシ排除 | クライアントローカルから直接接続維持 |
| **性能目標** | `require_info` MPC 復号追加遅延 | **P95 < 300ms**（実測値を記録・評価） |
| **バージョン固定** | TLSNotary Revision 確定 | Phase 0 終了時に exact git tag/commit を固定 |

---

## 15. Migration & Rollout Plan

1. **Phase 0 (ADR-000 Data Plane PoC & Verifier Benchmark)**:
   - `POST /kcsapi/api_get_member/require_info` における Prover 統合と MPC 復号遅延の動作実測（P95 < 300ms）。
   - TLSNotary exact git tag/commit revision の確定。
   - `Attestation.header().id` のバイナリ抽出ルーチン確定。
   - Cloudflare Workers vs Dedicated Rust Verifier のベンチマーク比較。
2. **Phase 1**: Supabase マイグレーション適用（`claim_challenges` 作成 & `claim_verified_device_v3` RPC デプロイ）。
3. **Phase 2**: `FUSOU-WEB` に `/anonymous-sync/v2/verify-tlsn` エンドポイントを有効化。
4. **Phase 3**: `FUSOU-APP` / `fusou-proxy-tlsn` にインライン公証ロジックを配信。

---

## 16. Security Progress Checklist（開発進捗チェックリスト）

- [D] ゲーム通信に外部プロキシを使用しない直接接続設計
- [D] FUSOU 生成の二重送信ゼロ設計（Design Requirement & Verification Instrument）
- [D] MPC 復号遅延と Proof 後処理（非同期化）の 3 段階分離設計
- [D] `ClaimBindingBytes` の厳密な Byte Layout & Binary Framing 設計（`Attestation.header().id` 公式識別子）
- [D] Server-issued One-Time Challenge の DB 管理 & 単一消費ライフサイクル設計
- [D] 同一 Attestation の多重 Claim 遮断（`UNIQUE (tlsn_attestation_id)`）設計
- [D] `require_info` によるセッション最初 1 回限りの Identity Attestation 設計
- [D] Telemetry ペイロードからの所属識別子完全排除 & 提出時点 Immutable 帰属設計
- [D] Dual Authentication & `telemetry_nonces`（10分保持）による Replay Protection 設計
- [D] `member_id_hash` / Pepper 体系の完全削除と UUID `public_id` への一本化
- [D] Quad Invariant（$\text{verified\_user\_id} \equiv \text{canonical\_user\_id} \equiv \text{user\_id} \equiv \text{web\_user\_id}$）の段階的成立定義
- [D] 64-bit Advisory Lock & 親行ロック契約による並行実行競合排除設計
- [D] `member_ownership`（現在状態）と `member_ownership_claims`（監査履歴）の分離
- [D] 排他ロック取得後の Proof / Attestation Consumption Policy（重複消費排除）設計
- [P] Phase 0 PoC（GO/NO-GO 基準付き実測検証 23 項目）
- [P] Verifier 実行環境ベンチマーク（Workers vs Dedicated Rust Verifier）および exact TLSNotary revision 固定
- [I] 実装および DB マイグレーション適用
- [T] 単体テスト・端末すり替え遮断テスト・Attestation 再利用遮断テスト
