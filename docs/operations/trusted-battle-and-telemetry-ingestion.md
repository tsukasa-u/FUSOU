# FUSOU: Game Account Identity Attestation & Dataset Attribution 仕様書 (v1 Scope 完全確定版)

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-hudsucker`, `packages/fusou-proxy-tlsn`, `packages/fusou-telemetry`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers / Dedicated Verifier Service）  
> **v1 Core Security Goal**:  
> **「FUSOU v1 は、ログイン時の `POST /kcsapi/api_get_member/require_info` に含まれる `/api_data/api_basic/api_member_id` についてのみ TLSNotary による Game Server provenance を確立し、その証明済み Game Account を `public_id` へ固定する。その後の Telemetry は内容を信頼せず、認証済み Dataset/Device credential からサーバー側で所属 Dataset を決定して保存する（Dataset Attribution / Provenance 保証）。」**  
> 対象 API: **`POST /kcsapi/api_get_member/require_info`**（HTTP/1.1、Game Server 認証セッション単位で最初に TLSNotary Identity Attestation に成功した 1 回のみ）  
> 対象データ: **`/api_data/api_basic/api_member_id`**（kc-api-dto: internal Rust representation = `i64`, Wire: JSON JSON Number token, Canonical Internal: Decimal String `^[0-9]{1,16}$` 前置ゼロ正規化済み, DB: `BIGINT`）  
> **最重要設計原則**:  
> 1. **旧自己申告経路の完全根絶と Implementation Acceptance Criteria の確立**:  
>    - **「すべての公開関数 / HTTP ルート / RPC において、`api_member_id` $\rightarrow$ `public_id` $\rightarrow$ `dataset_token` のコールグラフが、TLSNotary Verified Claim を先祖（ancestor）に持たない経路をコードベース上に 0 本とすること（Call Graph 0本保証）」** を最優先の Implementation Acceptance Criteria とする。  
>    - 旧 `POST /anonymous-sync/v2/register`、旧 `POST /anonymous-sync/v2/pending/:token/complete`、および `signInAnonymously()` による未検証匿名ユーザー自動生成（`ensureCanonicalUserForPublicId`）は **完全廃止・削除（HTTP 404 Not Found / コードベースから除去）** とする。  
>    - 汎用 RPC `rpc_register_public_id` は DB から完全に DROP し（`REVOKE EXECUTE`等の権限制御ではなく削除）、`claim_verified_device_v3` 内部の SQL トランザクションとして完全にインライン化・カプセル化する。
 2. **Identity Attestation と Telemetry Submission の完全分離**:  
>    - **① Identity Attestation（暗号学的保証）**: ログインセッションの最初の `require_info` を FUSOU-Prover と FUSOU Dedicated Verifier (MPC Verifier & Notary) 間の TLSNotary MPC-TLS セッションで公証し、Game Account（`api_member_id`）$\rightarrow$ `member_id_mapping` $\rightarrow$ Dataset（`public_id`）$\rightarrow$ Social User（`web_user_member_map`）$\rightarrow$ Authorized Device（`user_devices`）の身元連鎖（Identity Chain）を確立する。  
>    - **② Telemetry Submission（内容は UNTRUSTED / 所属先 Dataset は TRUSTED）**: 戦闘等のテレメトリデータ自体は暗号公証せず、クライアントはリクエスト内に `member_id`, `public_id`, `dataset_id`, `owner user_id` などの所属識別子を一切含めない。  
> 3. **保証境界の厳格な明文化（Credential Attribution $\neq$ Real-time Game Session Freshness）**:  
>    - FUSOU v1 が保証するのは **「この Telemetry が、Game Account A にバインドされた Dataset U1 の正規 Credential から提出された事実（Credential Attribution）」** であり、**「この Telemetry が、現在 Game Server 上でリアルタイムにプレイされているゲームセッションとリアルタイムに一致していること（Real-time Session Freshness）」までは保証しない（Non-Guarantee）**。  
> 4. **Selective Disclosure（最小構造開示）& JS Number 変換完全禁止**:  
>    - TLSNotary の Selective Disclosure では、Response 内の `HTTP/1.1 200 OK`、`svdata=`、`"api_result": 1`、`"api_data": { "api_basic": { "api_member_id": <digits> } }` を含む **必要最小限の構造化 Byte Range** を開示する。このとき HTTP 200 OK を Root level で検証し、`svdata=` prefix の exact syntax 検証も必須とする。  
>    - FUSOU-WEB の Canonical Identity Parser（`packages/FUSOU-WEB/src/server/utils/require_info_parser.ts` [Planned File]）は、`JSON.parse()` による IEEE 754 丸め誤差や、Regex・部分一致検索の脆弱性を 100% 排除するため、**専用の Strict Lossless JSON Tokenizer を用いて `/api_data/api_basic/api_member_id` の JSON Pointer 階層構造を厳密に辿り、エスケープなしの ASCII digits トークンとして直接抽出** します。仕様として、重複キー (duplicate object key) の拒否、Unicode escape (`\u0031` 等) の拒否を厳格に実行します。また `api_member_id` の型が String なのか Number なのか（それによる Leading Zero 許容可否含む）は、Phase 0 において Game Server 実データの wire type を実測した上でただ 1 つの型仕様に完全固定します。
> 5. **Device ↔ Proof の暗号学的バインディング（長さ 24 bytes `proof_purpose` & 完全固定 Binary Layout）**:  
>    - `public_id` はクライアントが任意選択せず、サーバーが `verified_member_id` に対してランダムな UUIDv4 を一度だけ割り当て・永続化する。  
>    - **Trust Authority の厳格な分離**:  
>      - **`Cryptographic Verification Authority` (`FUSOU Dedicated Verifier`)**: Prover との MPC-TLS 共同復号（MPC Verifier）および Session Header 署名（Notary）を担当し、Attestation Proof、`transcript_commitments` による Transcript Proof の暗号検証、開示平文バイト列および `Attestation.header().id` の抽出・認証付き結果返却（Ed25519 署名 / Key Registry 仕様 / FUSOU-WEB と秘密鍵非共有）を行う。  
>      - **`Application / Identity / Dataset Authorization Authority` (`FUSOU-WEB` & Supabase)**: 開示平文からの唯一の Canonical Application Parser による `verified_member_id` 抽出、DB-backed One-Time Challenge（`public.claim_challenges` / 32-byte CSPRNG `BYTEA` / 5分 TTL / 単一消費）の発行・管理、`ClaimBindingBytes` raw bytes 署名検証（`verifyEd25519ClaimBinding`）、DB Claim、Dataset Token 発行。  
>    - **`ClaimBindingBytes` への `proof_purpose`（24 bytes US-ASCII）導入 & 公式 canonical byte 採用**:  
>      `ClaimBindingBytes` には用途識別子 `proof_purpose = "GAME_ACCOUNT_IDENTITY_V1" (ASCII length = 24 bytes, 厳密に自動テストで検証)`（正確に 24 US-ASCII octets）および TLSNotary 公式 canonical serialization による `tlsn_attestation_id = Attestation.header().id` の byte representation を格納し、Length-delimited binary framing（Domain: `"FUSOU-IDENTITY-CLAIM-V1"`, `uint16_be(len)`）によりバイト列を安全に固定する。  
>    - **Attestation 再利用の DB 遮断 (Anti-Reuse)**:  
>      `member_identity_claims` テーブルに `UNIQUE (tlsn_attestation_id)` 制約を課し、同一 Attestation に対し複数 Presentation が生成された場合でも、Identity Claim は Attestation 単位で 1 度しか行えない（Presentation は何度生成されてもよいが Claim は 1 回限り）。  
> 6. **Telemetry Ingest パイプラインにおける厳格な 7 段階検証順序 & Immutable 帰属保証**:  
>    - **検証順序**:  
>      ① JWT 検証 (`sub = device_id`, `dataset_id = public_id`) $\rightarrow$ ② Server-side Lookup (`user_devices` 存在・`device_status = 'VERIFIED'`・`revoked_at IS NULL`) $\rightarrow$ ③ 3-way 整合性検証（`JWT.dataset_id === SignDoc.public_id === user_devices.public_id`） $\rightarrow$ ④ Ed25519 Device Signature 検証 (raw SignDoc binary framing) $\rightarrow$ ⑤ Idempotency Lookup（既存同一 Body は 200 返却・Nonce 再消費なし / 異 Body は 409 Conflict） $\rightarrow$ ⑥ 新規リクエスト時：同一 DB トランザクション内で Nonce アトミック消費 (`telemetry_nonces`: 30分保持) & `telemetry_events` INSERT。  
>    - 提出された Telemetry レコードの `(public_id, submitted_by_device_id)` は **提出時点（submission time）の事実として Immutable に保存** され、将来のデバイス再バインドや所有者変更時にも過去データは一切更新されない。  
> 7. **再送信ゼロ（No Re-submission の厳格定義）**:  
>    - **「For each intercepted logical require_info request, the Game Server must observe exactly one corresponding upstream request generated by FUSOU. (0 = failure, 1 = normal, 2+ = protocol violation)」**  
> 8. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 9. **Fallback 時のステータス明示**:  
>    送信前 Notary 障害時は `GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED` の状態へ安全に通常 TLS フォールバックしゲームプレイを継続。リクエスト送信後の Notary 障害時は再送厳禁（`UNATTESTED`）。  
> **ステータス**: 実装開始前完全確定マスター仕様書 (Freeze for Phase 0 Implementation)  

---

## 目次

1. [Goal & Concept (Identity Attestation と Dataset Attribution の分離)](#1-goal--concept-identity-attestation-と-dataset-attribution-の分離)
2. [Threat Model & Security Guarantees（脅威モデルと保証境界）](#2-threat-model--security-guarantees脅威モデルと保証境界)
   - 2.1 [防げる攻撃（Security Guarantees: シナリオ追跡）](#21-防げる攻撃security-guarantees-シナリオ追跡)
   - 2.2 [防げない事項（Non-Guarantees: Credential Attribution $\neq$ Real-time Game Session Attribution）](#22-防げない事項non-guarantees-credential-attribution-neq-real-time-game-session-attribution)
   - 2.3 [インフラ侵害時の保証境界（Threat Assumption & Trust Model）](#23-インフラ侵害時の保証境界threat-assumption--trust-model)
3. [Trust Boundary & Authority Separation（検証機関・認可機関の厳格分離）](#3-trust-boundary--authority-separation検証機関認可機関の厳格分離)
4. [Identity Architecture & Invariant（ID基盤と不変条件の段階的成立）](#4-identity-architecture--invariantid基盤と不変条件の段階的成立)
5. [require_info TLSNotary Protocol (`POST /kcsapi/api_get_member/require_info`)](#5-require_info-tlsnotary-protocol-post-kcsapiapi_get_memberrequire_info)
   - 5.1 [Game Login Session の検知・判定モデル (SessionKey) と再試行ポリシー](#51-game-login-session-の検知判定モデル-sessionkey-と再試行ポリシー)
   - 5.2 [MPC-TLS 処理 3 段階と Browser 待機のイベント分離 (T0〜T6)](#52-mpc-tls-処理-3-段階と-browser-待機のイベント分離-t0t6)
   - 5.3 [Transcript Range Selection (最小構造開示) & Wire Representation 要件](#53-transcript-range-selection-最小構造開示--wire-representation-要件)
   - 5.4 [Application-level Validation & Decimal String カノニカルパース (JS Number 変換完全禁止)](#54-application-level-validation--decimal-string-カノニカルパース-js-number-変換完全禁止)
6. [Device ↔ Proof Binding & Social Account Linking](#6-device--proof-binding--social-account-linking)
   - 6.1 [TLSNotary Attestation.header().id と ClaimBindingBytes の完全固定 Byte Layout](#61-tlsnotary-attestationheaderid-と-claimbindingbytes-の完全固定-byte-layout)
   - 6.2 [初回 Claim 決定論的 8 ステップ順序 & DB トランザクション (claim_verified_device_v3)](#62-初回-claim-決定論的-8-ステップ順序--db-トランザクション-claim_verified_device_v3)
   - 6.3 [Attestation Reuse Prevention（同一証明書の多重 Claim 遮断）](#63-attestation-reuse-prevention同一証明書の多重-claim-遮断)
   - 6.4 [Social Account Binding と 認証済み POST /identity/bind-social フロー](#64-social-account-binding-と-認証済み-post-identitybind-social-フロー)
   - 6.5 [Dataset Token の発行条件 & リアルタイム失効セマンティクス](#65-dataset-token-の発行条件--リアルタイム失効セマンティクス)
7. [Telemetry Submission Protocol (Dual Auth: Token + Device Signature)](#7-telemetry-submission-protocol-dual-auth-token--device-signature)
   - 7.1 [Telemetry Ingest 原則 & Immutable 帰属保証](#71-telemetry-ingest-原則--immutable-帰属保証)
   - 7.2 [リクエスト仕様 & Idempotency / DB Nonce Retention (30分保持)](#72-リクエスト仕様--idempotency--db-nonce-retention-30分保持)
   - 7.3 [サーバー側処理パイプライン & 厳格な検証順序 (3-way 照合 & アトミックコミット)](#73-サーバー側処理パイプライン--厳格な検証順序-3-way-照合--アトミックコミット)
8. [Rust Workspace クレート分割設計 & utils/pepper.ts 移行](#8-rust-workspace-クレート分割設計--utilspepperts-移行)
9. [FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier & Key Registry)](#9-fusou-web-verifier-アーキテクチャ-workers-vs-dedicated-rust-verifier--key-registry)
10. [DB Schema（Supabaseマイグレーション: Challenge, Nonce, Telemetry, 拡張監査）](#10-db-schemasupabaseマイグレーション-challenge-nonce-telemetry-拡張監査)
11. [Failure Handling & Fallback Semantics (Phase A / Phase B)](#11-failure-handling--fallback-semantics-phase-a--phase-b)
12. [Recovery & Re-binding Policy（用語の明確な分離）](#12-recovery--re-binding-policy用語の明確な分離)
13. [Migration & Token Revocation Semantics（既存データの安全な移行）](#13-migration--token-revocation-semantics既存データの安全な移行)
14. [Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）](#14-phase-0-poc--gono-go-criteria実測検証計画と判定基準)
15. [Security Invariant $\rightarrow$ Enforcement $\rightarrow$ Test 対応表](#15-security-invariant--enforcement--test-対応表)
16. [Security Progress Checklist（開発進捗チェックリスト）](#16-security-progress-checklist開発進捗チェックリスト)

---

## 1. Goal & Concept (Identity Attestation と Dataset Attribution の分離)

### 1.1 背景と旧自己申告経路の完全根絶
旧来の FUSOU `anonymous-sync-v2` では、`POST /anonymous-sync/v2/register` がクライアント自己申告の `api_member_id` を受け取り、`rpc_register_public_id` $\rightarrow$ `ensureCanonicalUserForPublicId`（匿名ユーザー自動生成） $\rightarrow$ `rpc_register_user_device` $\rightarrow$ `issueDatasetToken` を実行して即座に `dataset_token` を発行していました。

この構造では、攻撃者が TLSNotary を完全にスキップして任意の `api_member_id` で Dataset を作成・詐称できる致命的な脆弱性が存在していました。

v1 では、**自己申告で Dataset Token を取得できるコード経路をコードベース全域から 100% 根絶（Call graph 上で 0 本であることを保証）** し、**セッション最初の `require_info` で TLSNotary による Game Server provenance を確立した後にのみ Dataset Token を発行する** アーキテクチャへ完全移行します。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ① Identity Attestation (SessionKey 単位 / 最初 1 回のみ / 暗号学的に保証)         │
│                                                                                 │
│  FUSOU-Prover ──(MPC-TLS)──▶ Game Server (require_info)                         │
│       │                              │                                          │
│       ▼                              ▼                                          │
│  FUSOU Dedicated Verifier (MPC Verifier & Notary) ──▶ Attestation 署名 & 検証   │
│                                                                   │             │
│                                                                   ▼             │
│                                                   Authenticated Verifier Result │
│                                                   { att_id, revealed_spans, sig}│
│                                                                   │             │
│                                                                   ▼             │
│                                                   FUSOU-WEB Canonical Parser    │
│                                                   - HTTP/1.1 厳格マッチ         │
│                                                   - verified api_member_id      │
│                                                     (Decimal ASCII 文字列抽出)   │
│                                                   - expected public_id 解決     │
│                                                   - Issue One-Time Challenge    │
│                                                     (32-byte CSPRNG BYTEA)      │
│                                                                   │             │
│                                                                   ▼             │
│                                                   ClaimBindingBytes 署名検証    │
│                                                   (Domain + Purpose(24B) +      │
│                                                    AttID + MemberID + DevID +   │
│                                                    PubID + ChallengeID + Nonce) │
│                                                   ※ verifyEd25519ClaimBinding   │
│                                                   (raw Uint8Array 直接検証)     │
│                                                                   │             │
│                                                                   ▼             │
│                                                   DB Atomic Claim (10 Steps)    │
│                                                   - UNIQUE(tlsn_attestation_id) │
│                                                   - 64-bit Advisory Lock        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ 発行: Dataset Token (Triple Verified 後発行)
                                       ※ 旧 register / pending / 匿名自動生成は完全廃止
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ② Telemetry Submission (常時・軽量 / 内容は UNTRUSTED / 所属先 Dataset は TRUSTED)│
│                                                                                 │
│  Device A ──▶ POST /telemetry/upload                                            │
│               - Authorization: Bearer <dataset-token> (sub=device_id)           │
│               - X-FUSOU-Signature: Ed25519(SignDoc binary framing)              │
│               - X-FUSOU-Nonce (DB telemetry_nonces 単一消費: 30分保持)          │
│               ※ Payload に member_id / public_id / dataset_id は一切含めない     │
│                                                                                 │
│  FUSOU-WEB の厳格な 7 段階検証パイプライン:                                      │
│  1. JWT 検証 (sub=device_id, dataset_id=public_id)                              │
│  2. Server-side Lookup (user_devices: device_status='VERIFIED', revoked_at IS NULL)      │
│  3. 3-way 整合性検証 (JWT.dataset_id === SignDoc.public_id === user_devices.pub)│
│  4. Ed25519 Device 署名検証 (SignDoc raw binary framing)                         │
│  5. Idempotency Lookup (同一 Body は 200 返却 / 異 Body は 409 Conflict)         │
│  6. 新規時: アトミック Nonce 消費 & Telemetry INSERT (同一 DB トランザクション)  │
│  7. 結果返却 (提出時点の事実として Immutable に永続化)                           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Model & Security Guarantees（脅威モデルと保証境界）

### 2.1 防げる攻撃（Security Guarantees: シナリオ追跡）
* **A. 攻撃者が任意の `member_id` を自己申告登録する攻撃**:  
  自己申告登録エンドポイント（旧 `register`）および匿名ユーザー自動生成関数は完全削除され、未検証の自己申告登録による Dataset Token 取得は物理的に不可能です。正規オーナーが `require_info` 証明を提出した時点で正当な身元が確立されます（自己申告による先回り登録攻撃を無力化）。
* **B. 被害者の有効な Proof P を盗聴・傍受して攻撃者端末にバインドする攻撃**:  
  Server-issued Challenge（`challenge_nonce`）に対する署名には被害者端末の秘密鍵が必要なため、有効な Device B の公開鍵では Device A にバインドされた Claim を暗号学的に検証できず拒絶されます（端末すり替え拒絶）。
* **C. クライアントが Telemetry 内で他人の `member_id` を指定する攻撃**:  
  Telemetry ペイロード内の `member_id` はサーバーの認可判断から完全排除され、無視されます。
* **D. クライアントが Telemetry 内で他人の `public_id` / Dataset ID を指定する攻撃**:  
  サーバーは `dataset_token` から `public_id` を導出するため、クライアント指定の `public_id` は完全無視されます。
* **E. クライアントが Telemetry 内で他人の `owner user_id` を指定する攻撃**:  
  同様に認可判断から完全排除され、無視されます。
* **F. 同一 Telemetry リクエストの再生（Replay 攻撃）**:  
  `telemetry_nonces` テーブル（30分保持）と ±5 分のタイムスタンプ窓により、同一 Nonce の再送信は 401/403 で拒絶されます。
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

### 2.2 防げない事項（Non-Guarantees: Credential Attribution $\neq$ Real-time Game Session Attribution）
* **Telemetry 内容の真正性**: 戦闘結果、ドロップ、資源、艦隊、装備等の内容自体が Game Server 由来であることは v1 では判定しません（UNTRUSTED payload）。
* **自端末の資格情報盗難時のデータ捏造**: 攻撃者がユーザー PC を完全支配して `Device A` の秘密鍵/トークンを窃取した場合、`Device A`（Dataset U1）として偽の戦闘データを送ることは防げません（TPM 等がない限り不可）。
* **Credential Attribution と Real-time Game Session の分離**:  
  FUSOU v1 が保証するのは **「この Telemetry が、Game Account A にバインドされた Dataset U1 の正規 Credential から提出された事実（Credential Attribution）」** であり、**「この Telemetry が、現在 Game Server 上でリアルタイムにプレイされているゲームセッションとリアルタイムに一致していること（Real-time Session Freshness）」までは保証しません**。

### 2.3 インフラ侵害時の保証境界（Threat Assumption & Trust Model）
* **FUSOU Dedicated Verifier の Trust Assumption**:  
  FUSOU Dedicated Verifier は、Prover との間で MPC-TLS を正しく実行し、Web PKI および Allowlist に適合した通信のみに Notary 署名を行って Authenticated Verifier Result を生成する信頼された機関（Cryptographic Verification Authority）として前提とします。もし Verifier が侵害された場合、偽の検証結果が生成され得ますが、FUSOU-WEB と Verifier 間で秘密鍵を共有しない（Ed25519 署名と公開鍵レジストリ）ことにより、FUSOU-WEB 自身が Verifier の署名を捏造することは不可能です。
* **FUSOU-WEB / Supabase の Trust Assumption**:  
  FUSOU-WEB および Supabase DB は、Application & Authorization Authority として動作します。FUSOU-WEB のサービスロールが侵害された場合、データベースの改ざんは防げませんが、Client からの直接的な SQL / RPC 呼び出しは Row-Level Security および厳格な GRANT 制御により完全に遮断されます。

---

## 3. Trust Boundary & Authority Separation（検証機関・認可機関の厳格分離）

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
                            │ 2. ClaimSignature = Ed25519(ClaimBindingBytes) [raw Uint8Array]
                            ▼
═════════════════════ TRUST BOUNDARY ═════════════════════
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ FUSOU Dedicated Verifier (MPC Verifier & Notary)       │
│ (Dedicated Rust Service: Cryptographic Authority)      │
│                                                        │
│  - Joint MPC-TLS Decryption with Prover                │
│  - Sign Session Header as Notary -> Attestation gen    │
│  - Verify Web PKI Certificate Chain (Allowlist Check)  │
│  - Verify Attestation Proof & Merkle Root              │
│  - Verify Transcript Proof with transcript_commitments │
│  - Extract Attestation.header().id (canonical bytes)   │
│  - Return Authenticated Verification Result Bundle:    │
│    { version: 1, issuer, key_id, attestation_id,       │
│      server_identity, revealed_spans, notary_time, sig }│
│    ※ Verifier 秘密鍵による Ed25519 署名 (FUSOU-WEBと秘密鍵非共有)│
└───────────────────────────┬────────────────────────────┘
                            │ Authenticated Verification Result
                            ▼
┌────────────────────────────────────────────────────────┐
│ FUSOU-WEB (Application / Authorization Authority)      │
│                                                        │
│  - Verify Verifier Signature via Key Registry (Pubkey) │
│  - Parse canonical verified_member_id (Decimal ASCII)  │
│    (Planned: packages/FUSOU-WEB/.../require_info_parser.ts)
│  - Derive expected_public_id from verified_member_id   │
│  - Issue Server One-Time Challenge into DB (5min TTL)  │
│    (Bound to public_id, device_id, attestation_id)     │
│  - Verify ClaimBindingBytes via verifyEd25519ClaimBinding│
│  - Issue Dataset Token post-verification (sub=dev_id)  │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ [SECURITY BOUNDARY]
┌────────────────────────────────────────────────────────┐
│ Supabase Database (Trusted Core Storage: RPC Layer)    │
│                                                        │
│  - 64-bit Advisory Lock & Row-Level Locking            │
│  - Atomic Ownership Transfer (Strict 10 Steps)         │
│  - Enforce Quad Invariant (Post-Social Binding)        │
│  - Enforce UNIQUE (tlsn_attestation_id) (Anti-Reuse)   │
│  - Atomic Challenge & Proof Consumption Enforcement    │
│  - Append-Only Audit Trail (Parent cascade prevented by ON DELETE RESTRICT; row modifications physically prevented by REVOKE UPDATE, DELETE and trg_protect_member_claims_audit) with proof_purpose & spans  │
│                                                        │
│  Stored State = ACCEPTED Verified Evidence Only        │
└────────────────────────────────────────────────────────┘
```

---

## 4. Identity Architecture & Invariant（ID基盤と不変条件の段階的成立）

### 4.1 責任階層（Security Authority Hierarchy）
* **`member_id_mapping`**: Game Account Identity Root（暗号学的に検証された `api_member_id` と安定 UUID `public_id` の 1:1 双方向一意マッピング）。
* **`member_ownership`**: Owner / Device Authorization Root（Security Truth: 現在の検証済み所有者と認証済みプライマリ端末）。
* **`user_member_map` & `web_user_member_map`**: Derived / Application Projection Mappings（Web UI / Social Account 連携用の派生マッピング）。

```
api_member_id (例: 12345678: Decimal String, DB: BIGINT)
       │
       │ (TLSNotary provenance 検証)
       ▼
member_id_mapping (Service-role only: UNIQUE(api_member_id), UNIQUE(public_id))
       │
       ▼
public_id = UUIDv4 (Random UUID: Dataset U1)
       │
       ├───────────────▶ member_identity_claims (Audit Trail: 誰がいつ証明したか)
       ├───────────────▶ user_member_map (Application Projection)
       ├───────────────▶ web_user_member_map (Social Projection: UNIQUE public_id -> 1 Dataset = 1 Social User)
       ├───────────────▶ user_devices (device_id = Device A)
       └───────────────▶ telemetry_events (public_id = U1)
```

### 4.2 Invariant の段階的成立と「Binding」の定義
*Note: DB名上の「ownership」は、アプリケーション上の Binding (認可状態) を指すものであり、法的・暗号学的な Game Account 所有権の恒久証明ではありません（TLSNotaryが証明するのは「その瞬間、Game Serverがこのmember_idを返した」という事実のみです）。*

1. **`GAME_IDENTITY_VERIFIED` 時点**:
   - `user_devices.canonical_user_id` = `authenticated Supabase user` (操作者) に設定。
   - ただし、この時点ではまだ Social Account (外部OAuthなど) とは結びついておらず、`web_user_member_map.social_user_id` は `NULL` です（Device Verified ≠ Social Account Bound）。
2. **`SOCIAL_ACCOUNT_BOUND`（OAuth 明示的バインディング完了）以降**:
   - `web_user_member_map` に OAuth の `social_user_id` が格納され、Token 発行が可能になります。
   $$\text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \equiv \text{<OAuth authenticated user>} \quad (\text{Triple Invariant 成立})$$

---

## 5. require_info TLSNotary Protocol (`POST /kcsapi/api_get_member/require_info`)

### 5.1 Game Login Session の検知・判定モデル (SessionKey) と再試行ポリシー
* **SessionKey 定義 & Cookie Canonicalization**:
  > **重要原則**: `SessionKey` は Proxy 内のキャッシュ・ルーティング最適化ヒューリスティックであり、**暗号学的 Game Identity や Security Authority そのものではありません**。Identity の根はあくまで TLSNotary で検証された `api_member_id` です。
  $$\text{SessionKey} = \text{SHA256}(\text{Target World Host} \mathbin{\Vert} \text{Canonicalized Auth Cookies/Token Headers})$$
  - **Authentication Cookie Allowlist (Phase 0 固定)**:
    セッション認証に関与する Cookie 名（例: `login_id`, `session_token` 等の Allowlist）のみを抽出し、`name=value` を辞書順（lexicographic order）でソート・結合して SHA256 ハッシュ化。Cookie 平文のログ出力は完全禁止。
* **観測ポリシー**:
  1. **初回公証トリガー**: 新しい `SessionKey` が観測された直後の最初の `POST /kcsapi/api_get_member/require_info` を TLSNotary Identity Attestation の対象とする。
  2. **同一セッション内バイパス**: 当該 `SessionKey` で一度 Identity Attestation が成功した後は、後続の `require_info` は通常のプロキシとして中継し、再度 MPC 公証は行わない。
  3. **アカウント切り替え検知**: ログアウトや別アカウントログインにより `SessionKey` が変化した場合、新しいセッションとして次の `require_info` に対し改めて TLSNotary Identity Attestation を適用する。

### 5.2 MPC-TLS 処理 3 段階と Browser 待機のイベント分離 (T0〜T6)
第三者実装における同期待ちの混乱を防ぐため、イベントタイムラインを以下のように厳格に定義します：

```
Timeline:
T0: Browser HTTP POST /kcsapi/api_get_member/require_info 受信
T1: FUSOU-Proxy が検知し、FUSOU-Prover と FUSOU Dedicated Verifier 間で MPC-TLS 接続確立
T2: Game Server から Response 共同復号完了 (Response plaintext 取得)
T1/T2: MPC-TLS (Prover + Notary). Notary processes only encrypted data; Prover gets plaintext. ※レガシー端末向けの送信前 Fallback は TLS ClientHello ではなく Application Request Byte 基準で判定する。
T3: Browser response sent. BUT TLSNotary prover/notary state required for finalization remains alive.
...
T4: Finalize online phase. Notary signs Session Header -> Prover generates Presentation.
T5: Application Verifier (FUSOU-WEB) が Presentation 検証 -> Parser が member_id 抽出
T6: 【Identity 確定完了】FUSOU-WEB が Challenge 検証・DB Claim コミット
```

> **重要**: `Browser completion = T3`、`Identity completion = T6` であり、T3 以降の公証処理遅延はブラウザのゲーム進行を一切ブロックしません。

### 5.3 Transcript Range Selection (最小構造開示) & Wire Representation 要件
* **プロトコルスコープ**: FUSOU v1 が対応するゲーム API 通信は **HTTP/1.1 (Redirect 禁止)** に限定します。
* **Transcript Range Selection (最小構造開示)**:
  FUSOU-WEB が唯一の Canonical Application Parser として機能するため、TLSNotary の Selective Disclosure では以下の構造化 Byte Range を開示します：
  - **Request**: `POST /kcsapi/api_get_member/require_info HTTP/1.1`、`Host: <expected-host>`
  - **Response**: `HTTP/1.1 200 OK`、`svdata=` プレフィックス、`"api_result": 1`、`"api_data": { "api_basic": { "api_member_id": <digits> } }` を含む構造境界。
  > **Commit Strategy 最適化方針**: TLSNotary の commit 構造（BLAKE3）では、開示 range 数が増えると Secret サイズが 1 range あたり約 250 bytes 増加します。そのため、必要以上に細かく range を断片化させず、`api_member_id` を含む意味的な構造境界をなるべく少数の連続 range で Reveal します。
* **Wire Representation & gzip 圧縮順序 (Phase 0)**:
  TLSNotary が証明するのは wire 上の TLS plaintext bytes です。gzip 圧縮時は wire 平文上で `api_member_id` 文字列が連続して存在しないため、`compressed bytes -> Range Proof -> Decompress -> Canonical Parse` の順序を厳格に適用します。
* **Trusted Server Identity Policy (Explicit Allowlist)**:
  以下の 4 項目完全一致 Allowlist に基づいて Game Server の真正性を検証します：
  1. `TLS Certificate chain must validate against configured root_store`
  2. `Server name must match configured allowlist (TLS SNI === HTTP Host === expected origin)`
  3. `Method === POST AND HTTP Path === /kcsapi/api_get_member/require_info`
  4. `HTTP Redirect (3xx) is strictly forbidden on identity attestation path`

### 5.4 Application-level Validation & Decimal String カノニカルパース (JS Number 変換完全禁止)
JavaScript の `JSON.parse()` を通さず、raw ASCII / UTF-8 バイト列からバイトレベルで抽出して前置ゼロを正規化します：

```typescript
// packages/FUSOU-WEB/src/server/utils/require_info_parser.ts (Planned File)

import { z } from 'zod';

const CanonicalRequireInfoSchema = z.object({
  api_path: z.literal('/kcsapi/api_get_member/require_info'),
  api_member_id: z.string().regex(/^[1-9][0-9]{0,15}$|^0$/), // Normalized decimal ASCII string (1..16 digits, no leading zeros)
});

export type CanonicalRequireInfoResult = z.infer<typeof CanonicalRequireInfoSchema>;

/**
 * TLSNotary 開示平文バイト列から、JSON.parse() による浮動小数点数変換を一切行わずに
 * api_member_id を Decimal ASCII 文字列として直接抽出・正規化するカノニカルパーサー。
 */
export function parseCanonicalRequireInfo(
  revealedReq: Uint8Array,
  revealedRecv: Uint8Array
): CanonicalRequireInfoResult {
  // 1. 構造化 Request パース (HTTP/1.1 限定)
  const reqStr = new TextDecoder('utf-8', { fatal: true }).decode(revealedReq);
  const matchReq = reqStr.match(/^POST\s+(\/kcsapi\/api_get_member\/require_info)\s+HTTP\/1\.1/m);
  if (!matchReq) {
    throw new Error('invalid_or_unauthorized_request_path');
  }

  // 2. Response svdata プレフィックスおよび JSON 構造の厳格多段パース
  const recvStr = new TextDecoder('utf-8', { fatal: true }).decode(revealedRecv);
  const headerEnd = recvStr.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('http_headers_malformed');

  // svdata= のプレフィックス検証 (svdata=<JSON> の完全一致のみ許可)
  const bodyStr = recvStr.slice(headerEnd + 4).trim();
  if (!bodyStr.startsWith('svdata=')) {
    throw new Error('svdata_prefix_missing_at_body_start');
  }
  const jsonStr = bodyStr.slice(7); // "svdata=" 以降の完全なJSON文字列

  // 構造的JSON Pointer検証 (lossless JSON tokenizerによる完全一致検証)
  // 以下のポリシーを強制する専用のTokenizerを使用します：
  // 1. JSON.parse は禁止（Number丸め誤差防止）
  // 2. Duplicate keys はエラーとして拒絶 (first/last wins を許容しない)
  // 3. key/value の \uXXXX エスケープは拒絶 (literal ASCII のみ許可)
  // 4. Regex による部分検索・抽出は一切禁止
  const tokenizer = new StrictLosslessJsonTokenizer(jsonStr);
  
  // root.api_result の厳格検証 (Key exactly once, Type: Number, Value: 1)
  const apiResult = tokenizer.getNumber('/api_result');
  if (apiResult !== '1') {
    throw new Error('api_result_not_integer_1');
  }

  // /api_data/api_basic/api_member_id の階層構造を JSON Pointer として厳密に追跡
  // 途中のオブジェクト構造をスキップしたり、文字列として検索したりすることは禁止
  const rawMemberIdToken = tokenizer.getNumber('/api_data/api_basic/api_member_id');
  if (!rawMemberIdToken || !/^[1-9]\d*$/.test(rawMemberIdToken)) {
    throw new Error('api_member_id_missing_or_invalid_format');
  }

  return CanonicalRequireInfoSchema.parse({
    api_path: '/kcsapi/api_get_member/require_info', // Regex で抽出せず固定パスを検証
    api_member_id: rawMemberIdToken,
  });
}
```

---

## 6. Device ↔ Proof Binding & Social Account Linking

### 6.1 TLSNotary `Attestation.header().id` と `ClaimBindingBytes` の完全固定 Byte Layout

#### 6.1.1 Attestation 識別子の一本化 & Canonical Serialization
`tlsn_attestation_id` は、Rust 内部表現や Debug/String representation ではなく、**Phase 0 で採用・固定する exact TLSNotary revision が定義する canonical serialization によって得られる `Attestation.header().id` の byte representation を使用** します（Phase 0 前は parameter TBD、Phase 0 completion gate で確定して freeze）。

#### 6.1.2 全 8 フィールドの厳密な Encoding・Byte Layout 定義
将来の用途拡張（イベント証明等）におけるドメイン混同を防ぐため、`proof_purpose` を含む全 8 フィールドを完全固定します：

| 順序 | フィールド名 | データ型 / エンコーディング | バイト長 | 説明 |
|:---:|---|---|---|---|
| 1 | `domain_tag` | US-ASCII octets | 23 bytes | `"FUSOU-IDENTITY-CLAIM-V1"` |
| 2 | `proof_purpose` | US-ASCII octets | **24 bytes** | `"GAME_ACCOUNT_IDENTITY_V1"` |
| 3 | `tlsn_attestation_id` | TLSNotary Canonical Bytes | $N$ bytes (Phase 0 固定) | `Attestation.header().id` の公式シリアライズバイト列 |
| 4 | `verified_member_id` | UTF-8 decimal ASCII | 1〜16 bytes | 検証・正規化済みゲームアカウント ID（例: `"12345678"`） |
| 5 | `device_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | 提出端末の Device UUID |
| 6 | `expected_public_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー割当 Dataset UUID |
| 7 | `challenge_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー発行 Challenge UUID |
| 8 | `challenge_nonce` | Raw Binary Bytes | 32 bytes | サーバー発行 One-Time Nonce (`Server-issued: crypto.random_bytes(32)`) |

* **Length-Delimited Binary Framing (Protobuf 風 field-id は不使用)**:
  全フィールドの直前に 2 バイトの Big-endian 長さヘッダー（`uint16_be(len)`）を付加して連結：
  $$\text{ClaimBindingBytes} = \text{u16}(23) \Vert \text{"FUSOU-IDENTITY-CLAIM-V1"} \Vert \text{u16}(24) \Vert \text{"GAME_ACCOUNT_IDENTITY_V1"} \Vert \text{u16}(\text{len(att\_id)}) \Vert \text{att\_id} \Vert \text{u16}(\text{len(mid)}) \Vert \text{mid} \Vert \text{u16}(16) \Vert \text{dev} \Vert \text{u16}(16) \Vert \text{pub} \Vert \text{u16}(16) \Vert \text{cid} \Vert \text{u16}(32) \Vert \text{nonce}$$
  $$\text{ClaimSignature} = \text{Ed25519\_Sign}(sk_{\text{device}}, \text{ClaimBindingBytes})$$

### 6.2 初回 Claim 決定論的 8 ステップ順序 & DB トランザクション (claim_verified_device_v3)


### 4.2 Claim Challenge API (PENDING Device 登録と Challenge 発行の統合)
第三者実装のブレをなくすため、`POST /identity/challenge` (Auth: OAuth Session) のスキーマを完全に固定します。
PENDING Device の紐付け先を一意に決定するため、Verifier Result と Device Public Key は同一の API で送信されます。

**Request Body**:
```json
{
  "verifier_result": {
    "version": 1,
    "issuer": "FUSOU Dedicated Verifier",
    "key_id": "...",
    "tlsn_attestation_id": "...",
    "server_identity": "...",
    "revealed_request_spans": [...],
    "revealed_response_spans": [...],
    "notary_time": "...",
    "created_at": "...",
    "signature": "..."
  },
  "device_public_key": "<base64url>"
}
```

**Response Body**:
```json
{
  "challenge_id": "<uuidv4>",
  "challenge_nonce": "<base64url_32bytes>",
  "expires_at": "<iso8601_timestamp>",
  "device_id": "<uuidv4>",
  "attestation_id": "<base64url>",
  "verified_member_id": "<digits_string>",
  "expected_public_id": "<uuidv4>"
}
```

クライアントは、Response に含まれる `attestation_id`, `verified_member_id`, `device_id`, `expected_public_id`, `challenge_id`, `challenge_nonce` を用いて `ClaimBindingBytes` を構築し、デバイス秘密鍵で署名します。

第三者が実装しても完全に同一の動作となるよう、初回 Claim の論理順序を以下のように完全固定します：

1. **Step 1 (API 受領 & 厳格な検証順序)**: クライアントから `POST /identity/challenge` により `verifier_result` と `device_public_key` を受領。FUSOU-WEB は以下の順序を絶対に守って検証します：
   1. OAuth Session authentication
   2. Verifier Result signature verification (不正なら即拒否。**署名検証前に member_id を Security Decision に用いることは絶対禁止**)
   
※ **Verifier Result Wire Protocol (厳格仕様)**
Client から FUSOU-WEB への提出ペイロードにおける `verifier_result` は、以下の 2 層構造の仕様を強制します。

1. **Transport Representation: Canonical JSON**
   通信上の JSON は以下の順序・型を強制し、一切のフォーマット揺れや未定義フィールドを許容しません（重複キー、Unicode エスケープ、指数表記等も全てパーサーレベルで拒絶）。
   - **Field Order**: `version`, `issuer`, `key_id`, `tlsn_attestation_id`, `server_identity`, `revealed_request_spans`, `revealed_response_spans`, `created_at`, `signature`
   - **Field Type**:
     - `version`: Number
     - `issuer`: String
     - `key_id`: String
     - `tlsn_attestation_id`: String (base64url strict, padding なし)
     - `server_identity`: String (TLS Application の Canonical Hostname) ※TLS Certificate verification は Verifier 側で別途証明されている前提
     - `revealed_request_spans` / `revealed_response_spans`: Array of Object (start: uint64 checked_add 対策済み, length: uint64 (fixed-width), bytes: base64url strict)
     - `notary_time`: Number (TLSNotary Proofの完了時刻のNumericDate秒)
     - `created_at`: Number (Verifier Result 生成時刻の NumericDate 秒。notary_time とは別)
     - `signature`: String (base64url strict, padding なし)
   - **Range Constraints**: TLS application plaintext transcript offset を基準とし、start >= 0, length > 0, Overlap は禁止、Range bytes length との一致を Parser で検証。

2. **Signature Representation: VerifierResultSignBytes (Canonical Binary Encoding)**
   署名検証アルゴリズム (Ed25519) の入力には JSON 文字列そのものは使用しません。JSON をパース後、型付けされたフィールドを決定論的な Canonical Binary Encoding（厳格な length-delimited binary format (完全仕様)）で直列化したものを署名対象とします。当然、`signature` フィールド自体は入力に含めません。

**VerifierResultSignBytes Canonical Field Layout (完全仕様):**
| Order | Field | Type / Serialization Format | Description |
| :--- | :--- | :--- | :--- |
| 1 | `version` | `u16_be` | Protocol version (currently `1`) |
| 2 | `issuer` | `u16_be(len)` + `UTF-8 bytes` | Issuing authority string |
| 3 | `key_id` | `u16_be(len)` + `UTF-8 bytes` | Key identifier string |
| 4 | `attestation_id` | `[u8; 32]` (Fixed array) | 32-byte TLSNotary Session ID |
| 5 | `server_identity` | `u16_be(len)` + `UTF-8 bytes` | Verified TLS host |
| 6 | `request_spans` | `u16_be(count)` + Array of `[u64_be(start), u64_be(length)]` | List of requested HTTP span offsets |
| 7 | `response_spans` | `u16_be(count)` + Array of `[u64_be(start), u64_be(length)]` | List of responded HTTP span offsets |
| 8 | `notary_time` | `u64_be` | NumericDate (Seconds since epoch) |
| 9 | `created_at` | `u64_be` | NumericDate (Seconds since epoch) |

   3. issuer / key_id / version validation
   4. TLSNotary proof validity validation
   5. server identity validation
   6. revealed spans validation
   7. lossless parser による `verified_member_id` 抽出
2. **Step 2 (64-bit Advisory Lock 取得)**: FUSOU-WEB が `member_id` に基づく 64-bit Advisory Lock を取得。
3. **Step 3 (Public ID 確定)**: 単一のサーバーサイド RPC / Helper である `get_or_create_public_id(canonical_member_id)` を呼び出し `public_id` を確定します（※ Claim RPC と Challenge エンドポイントの両方で必ずこの単一の実装を共有し、同一の member_id 由来の canonical lock domain 下で実行します）。
※ `member_ownership` テーブルは `GAME_IDENTITY_VERIFIED` 状態（デバイス署名検証完了後）でのみレコードが作成されるため、`primary_device_id UUID NOT NULL` 制約は状態機械と完全に整合します。
4. **Step 4 (PENDING Device 独立登録)**: FUSOU-WEB は独立した別トランザクションとして、サーバーが生成した `device_id` と OAuth の `authenticated_user` を紐付け `device_status = 'PENDING'` (24h TTL) で `user_devices` へ INSERT します。※この時点でサーバーは `public_id` を知っているため、DB上で `authenticated_user ↓ PENDING Device ↓ public_id` の束縛を安全に確立します。
**【PENDING Device の生成・権限制約】**
- `canonical_user_id` と `public_id` の**両方**に基づく Advisory Lock を取得し、`max 5 PENDING` デバイス（VERIFIEDとは別枠）の制限を Race なしで強制します。
- **PENDING Device自体へAttestation IDを持たせる必要はない**（どの Proof 由来かは Challenge の tlsn_attestation_id で最終Claim時に結びつければ十分であり、余計な FK を増やさない）と明記します。
- デバイスの `device_public_key` は `UNIQUE` 制約とし、transport は base64url とします。既に同じ公開鍵が存在する場合は既存Deviceを返さず、厳格に `409 DEVICE_ALREADY_EXISTS` として Reject します。
- `user_devices.public_id` は PENDING 登録以降、変更不可 (immutable) であることを DB レベル（権限またはトリガー）で保証します。これにより Claim 前の差し替え攻撃を防ぎます。
- Client Role から `UPDATE user_devices SET device_status='VERIFIED'` と直接更新することは DB 権限で禁止され、`claim_verified_device_v3` 経由のみ許可されます。
- `REVOKED` なデバイスを `VERIFIED` に戻すことは禁止されます。
- Challenge エンドポイントおよび Claim エンドポイントの双方において、`device_status = 'PENDING'` かつ `pending_expires_at > NOW()` であることを厳格に確認します。**PENDING Device DoS対策として、per-user および per-public_id で同時に存在できる未検証デバイス数をそれぞれ最大 5 台に制限し、Cron ジョブは `pending_expires_at < NOW()` を基準とし、超過分は論理無効化（`revoked_at = NOW()` / `revoked_reason = 'expired_pending'`）し、`device_id` の UUID 再利用防止（Never Reuse）を DB 履歴として永続保証します。**
5. **Step 5 (Server Challenge 発行)**: 登録した PENDING デバイスに対して `public.claim_challenges` (5分 TTL) を発行し、クライアントへ Response Body を返却。
   **【Challenge発行トランザクションの擬似SQL】**
   1. `SELECT pg_advisory_xact_lock( ('x' || substr(md5(encode(tlsn_attestation_id, 'hex')), 1, 16))::bit(64)::bigint );` -- canonical 64-bit advisory lock. ※ 異なる Attestation でハッシュ衝突が発生しても Security Hole ではなく、unnecessary serialization（余計な直列化）が起きるだけです。
   2. `UPDATE public.claim_challenges SET challenge_status = 'EXPIRED' WHERE tlsn_attestation_id = p_attestation_id AND challenge_status = 'ACTIVE' AND expires_at <= NOW();`
   3. `SELECT * FROM public.claim_challenges WHERE tlsn_attestation_id = p_attestation_id AND challenge_status = 'ACTIVE';`
   4. 存在すれば、**必ずその既存の Challenge をそのまま返す** (ACTIVE exists → always return existing Challenge).
   5. 存在しなければ、新規 INSERT して返す。
   ※ **Every path that creates a Challenge must acquire the same attestation-derived advisory lock.**（これを忘れると Concurrent INSERT で Unique Violation が発生します）※発行前に `member_identity_claims` 等を確認し同一 `tlsn_attestation_id` からは1つのChallengeしか発行できないよう、DB上で `UNIQUE(tlsn_attestation_id) WHERE challenge_status = 'ACTIVE'` 制約により別デバイスへの流用等も含めて物理拒絶します（同時有効なChallengeを最大1個に制限するものであり、期限切れ後の再発行による復旧は妨げません）。
6. **Step 6 (ClaimBindingBytes 構築 & 署名)**: 端末が `(domain, purpose, attestation_id, verified_member_id, device_id, expected_public_id, challenge_id, challenge_nonce)` から `ClaimBindingBytes` を構築し、端末秘密鍵で Ed25519 署名。※`public_key` は署名対象に含めず、サーバー側で `user_devices` から取得する。
7. **Step 7 (Claim 提出 & 署名検証)**: クライアントは `{ "challenge_id", "signature" }` のみを FUSOU-WEB へ提出（攻撃面を最小化するため Client から public_id 等は受け付けない）。FUSOU-WEB は DB から関連 ID (`expected_public_id` 含む) を復元し `verifyEd25519ClaimBinding(pubkey, bytes, sig)` で raw byte 署名を検証します。**不正な署名によるリトライ攻撃（Signature Oracle Abuse）を防ぐため、署名検証に失敗した場合でも対象の Challenge は即座に `CONSUMED` として消費・無効化されます**。
   ※ 実装上の注意: `claim_verified_device_v3` は署名検証を伴わない内部 RPC であるため、不正署名時の Challenge 消費は FUSOU-WEB の API サーバー側 (Challenge/Claim service transaction) の責務です。FUSOU-WEB は署名検証に失敗した場合、専用の RPC (`SELECT public.consume_invalid_challenge(p_challenge_id);`) を呼び出してただちに Challenge を消費した上で `401 Unauthorized` を返します。
   ※ `consume_invalid_challenge` は authenticated server のみが実行可能な単一引数の冪等な関数であり、内部で `UPDATE claim_challenges SET challenge_status = 'CONSUMED' WHERE challenge_id = p_challenge_id AND challenge_status = 'ACTIVE'` のみを実行します。同時に正規 Claim と競合した場合は「First consume wins」となります。
   ※ Threat Model 補足: Invalid signature consumes challenge intentionally to prevent unlimited signature retries. これは意図的な UX/DoS トレードオフであり、攻撃者が不正署名を送ることで正規ユーザーの Challenge を消費させることも理論上可能ですが、攻撃者は 5 分の有効期間内の競合 (race condition) に勝つ必要があります。
※ Claim の重複・Idempotency ルール (統一仕様):
1. 先に `member_identity_claims` で既存 Claim を検索します。
2. もし同一 Attestation が既に存在する場合：
   - 同一 Device ID (同一 Identity) であれば、対象の Challenge が消費済・期限切れに関わらず Idempotent Success として既存の Claim 結果を早期 return します。
   - 異なる Device 等への流用であれば `DUPLICATE_ATTESTATION_CLAIMED` として厳格に reject します。
3. もし未 Claim（新規 Attestation）の場合：
   - デバイスが PENDING で未期限切れの場合のみ normal claim を進行します。
   - すでに VERIFIED のデバイスに新しい Attestation を適用しようとした場合は `ALREADY_VERIFIED` として reject します。

1. 先に `member_identity_claims` で既存 Claim を検索します。
2. もし同一 Attestation が既に存在する場合：
   - 同一 Device ID (同一 Identity) であれば、対象の Challenge が消費済・期限切れに関わらず Idempotent Success として既存の Claim 結果を早期 return します。
   - 異なる Device 等への流用であれば `DUPLICATE_ATTESTATION_CLAIMED` として厳格に reject します。
3. もし未 Claim（新規 Attestation）の場合：
   - デバイスが PENDING で未期限切れの場合のみ normal claim を進行します。
   - すでに VERIFIED のデバイスに新しい Attestation を適用しようとした場合は `ALREADY_VERIFIED` として reject します。
8. **Step 8 (Atomic DB Commit)**: `claim_verified_device_v3` を実行しアトミックに検証・適用：
   - Challenge 単一消費 (`challenge_status = 'CONSUMED',
    consumed_at = NOW()`)
   - `UNIQUE(tlsn_attestation_id)` 検証 (再利用防止)
   - `authenticated_user == PENDING device.canonical_user_id` および `device.public_id == expected_public_id` の一致再検証
   - `member_identity_claims` への Audit Log 記録
   - Device を `device_status = 'VERIFIED'` へ昇格 (VERIFIED化)
   ※ `claim_verified_device_v3` は暗号学的検証器ではなく、**FUSOU-WEB による署名検証と認可境界を信頼して DB を更新する内部 RPC** です。クライアントからの直接呼び出しは完全に禁止 (`REVOKE EXECUTE FROM PUBLIC`) されます。

### 6.3 Attestation Reuse Prevention（同一証明書の多重 Claim 遮断）
`public.member_identity_claims` テーブルに `tlsn_attestation_id BYTEA NOT NULL` を保持し、`CONSTRAINT uq_member_claims_attestation UNIQUE (tlsn_attestation_id)` 制約を定義。同一 Attestation を別 Challenge で再利用した二重 Claim は `DUPLICATE_ATTESTATION_CLAIMED` 例外として即時ロールバックされます（**Presentation は何度生成されてもよいが、FUSOU Identity Claim は Attestation 単位で 1 度限り**）。

### 6.4 Social Account Binding と 認証済み `POST /identity/bind-social` フロー
* **状態の段階的遷移**:
  1. `GAME_IDENTITY_VERIFIED`: TLSNotary Proof により `api_member_id` $\leftrightarrow$ `public_id` $\leftrightarrow$ `user_devices` が確定した状態。
     $$\text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \equiv \text{<OAuth authenticated user>} \quad (\text{Triple Invariant 成立})$$
  2. `SOCIAL_ACCOUNT_BOUND`: OAuth 認証済み Web ユーザーが明示的なバインディング操作を行い、`web_user_member_map` に登録された状態。
     $$\text{上記 3 者} \equiv \text{web\_user\_member\_map.user\_id} \quad (\text{Quad Invariant 成立})$$
* **1 Dataset = 1 Social User ポリシー**:
  `web_user_member_map` は `public_id UNIQUE` を保持し、同一 Game Account Dataset を複数の異なる Social アカウントに重複バインドすることを禁止します。
* **`POST /identity/bind-social` の認証・認可仕様**:
  1. **CSRF 防御**: `assertCsrfSafe(c, hasCookieAuth)` の実行。
  2. **Supabase OAuth User 認証**: 認証済み `authenticated_user_id` を抽出。
  3. **所有権検証**: サーバー側で `target public_id` の `member_ownership` を照合し、`GAME_IDENTITY_VERIFIED` かつ `user_member_map.user_id == authenticated_user_id` であることを確認（別ユーザーによる乗っ取り Binding は 403 拒絶）。
  4. **DB 登録**: `web_user_member_map` に `(user_id, public_id)` をアトミックに INSERT。

### 6.5 Dataset Token の発行条件 & リアルタイム失効セマンティクス
* **Triple Verified Issuance（公証後発行ルール）**:
  必ず以下の順序で発行され、事前発行は行われません：
  $$\text{require\_info verified} \longrightarrow \text{device claim accepted} \longrightarrow \text{social account bound} \longrightarrow \text{dataset\_token issued}$$
* **JWT Claims 仕様**:
  ```json
  {
    "iss": "fusou-identity",
    "aud": "fusou-upload",
    "kid": "fusou-jwt-key-2026-01",
    "sub": "<device_id>",
    "dataset_id": "<public_id>",
    "typ": "dataset",
    "credential_version": 1,
    "iat": 1720000000,
    "exp": 1720086400
  }
  ```
  ※ JWT の `iat` / `exp` は JSON Number の NumericDate です。
* **リアルタイム失効セマンティクス**:
  JWT の NumericDate (iat/exp) は JSON String ではなく Number としてエンコードされます。また JWT は認証資格情報（Authentication Credential）であり、現在の認可状態（Current Authorization State）は DB の `user_devices` および `member_ownership` で管理されます。Social 解除や Device Revoke が発生した場合、Token は次のリクエスト時に即座に 401/403 で拒絶されます。

---

## 7. Telemetry Submission Protocol (Dual Auth: Token + Device Signature)

### 7.1 Telemetry Ingest 原則 & Immutable 帰属保証
> **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。`api_path` は informational metadata（最大 128 UTF-8 bytes）であり認可判断には使用しない。」**  
> **「DB に格納された Telemetry レコードの `(public_id, submitted_by_device_id)` は提出時点の事実として Immutable であり、将来のデバイス再バインドや所有者変更によって過去データが更新されることはない。」**

### 7.2 リクエスト仕様 & Idempotency / DB Nonce Retention (30分保持)
```http
POST /api/v1/telemetry/ingest HTTP/1.1
Host: api.fusou.dev
Authorization: Bearer <dataset-token>
X-FUSOU-Device-ID: 00000000-0000-4000-8000-000000000000
X-FUSOU-Timestamp: 1756200000
X-FUSOU-Nonce: a1b2c3d4e5f6
X-FUSOU-Signature: <base64url-encoded-ed25519-signature>
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

* **署名対象ペイロード（Length-Delimited Binary Framing / US-ASCII Domain）**:
  Client は Dataset Token の Claims から `public_id` をデコードして署名に含めます（Query string は禁止）：
  $$\text{SignDoc} = \text{u16}(23) \Vert \text{"FUSOU-TELEMETRY-SIGN-V1"} \Vert \text{u16}(\text{len(method)}) \Vert \text{method} \Vert \text{u16}(\text{len(path)}) \Vert \text{path} \Vert \text{u16}(16) \Vert \text{public\_id} \Vert \text{u16}(16) \Vert \text{device\_id} \Vert \text{u16}(8) \Vert \text{timestamp} \Vert \text{u16}(\text{len(nonce)}) \Vert \text{nonce} \Vert \text{u16}(32) \Vert \text{sha256(raw\_body)}$$
* **DB レベル Nonce Replay Protection & クリーンアップ運用**:
  - `device_id` は UUIDv4 であり **Never-reused**。
  - `X-FUSOU-Timestamp` は ±5 分（±300秒: サーバー側 wall clock 判定）以内のみ受理。
  - `telemetry_nonces` に `(device_id, nonce)` を INSERT して消費。データは 30 分間保持し、定期ジョブ（pg_cron）で自動パージ（Cleanup はストレージ維持用であり、Replay 防御自体の判定は DB UNIQUE 制約による）。
* **Raw Body Hash による厳格な Idempotency**:
  `body_hash = sha256(raw_body_bytes)` は改ざん防止ではなく **Idempotency 判定専用**。同一 `ingest_item_id` が既に存在する場合、保存済み `body_hash` と完全一致すれば 200/201 冪等成功（Nonce 再消費は行わない）、不一致であれば 409 Conflict で拒絶。

### 7.3 サーバー側処理パイプライン & 厳格な検証順序 (3-way 照合 & アトミックコミット)
1. **JWT 検証**: `Authorization` ヘッダーから `dataset_token` を検証し、Claims (`sub = device_id`, `dataset_id = public_id`) を抽出。
2. **Server-side Device Lookup**: 抽出した `device_id` をキーとして DB の `user_devices` レコードを検索し、`device_status = 'VERIFIED' AND revoked_at IS NULL` を確認。
3. **3-way 整合性検証**: `JWT.dataset_id === SignDoc.public_id === user_devices.public_id` を照合（不一致時は 401/403 拒絶）。
4. **Ed25519 Device Signature 検証**: `raw_body_bytes` から `SHA256(raw_body_bytes)` を算出し、`user_devices.device_pubkey` を用いて `SignDoc` バイナリフレーミングに対する `X-FUSOU-Signature` を検証。
5. **Idempotency Lookup**:
   - `ingest_item_id` が既に存在し、`body_hash` が一致 $\rightarrow$ 200 OK (既存結果返却、Nonce 再消費は行わない)
   - `ingest_item_id` が既に存在し、`body_hash` が不一致 $\rightarrow$ 409 Conflict
6. **新規リクエスト時（アトミック DB コミット）**:
   同一 DB トランザクション内で、`telemetry_nonces` への Nonce アトミック消費と `telemetry_events` への INSERT を実行（Nonce 重複時は即座に 401/403 遮断、INSERT 失敗時は Nonce 消費もロールバック）。

---

## 8. Rust Workspace クレート分割設計 & utils/pepper.ts 移行

```
packages/
├── fusou-auth/               # DeviceKey / Ed25519 署名 / Token管理 (既存実装再利用)
├── fusou-proxy-core/         # Proxy ライフサイクル・HTTP 抽象化・UpstreamTransport Trait (Interception decision)
├── fusou-proxy-hudsucker/    # 通常ゲーム通信用 MITM プロキシ実装 (Local MITM transport / 低遅延最優先)
├── fusou-proxy-tlsn/         # require_info 専用 TLSNotary MPC-TLS Upstream トランスポート（PoC対象）
├── fusou-telemetry/          # 軽量テレメトリ キュー・SQLite 永続化・バッチ送信
└── FUSOU-APP/                # Composition Root (DI コンテナ)
```

> **`utils/pepper.ts` の完全削除と `device-auth.ts` 移行**:  
> レガシーな stateless HMAC チャレンジ（`pepper.ts`）は完全削除し、DB-backed One-Time Challenge（`public.claim_challenges`）および raw bytes 署名検証 API **`verifyEd25519ClaimBinding(publicKey: Uint8Array, messageBytes: Uint8Array, signatureBytes: Uint8Array): boolean`** を備えた **`packages/FUSOU-WEB/src/server/utils/device-auth.ts`** へ完全移行します。

---

## 9. FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier & Key Registry)

TLSNotary は active development 中（breaking changes が発生し得る）であるため、**Phase 0 終了時に採用する exact git tag / commit revision を確定・固定** します（過去の archive された `@tlsnotary/tlsn-js` は採用せず、現行の tagged release / extension / wasm / native prover を使用）。

1. **FUSOU Dedicated Verifier の責務**:
   Dedicated Rust Service が MPC Verifier と Notary の両方を兼任し、Attestation 生成と検証をワンストップで実行。
2. **Verifier Result Bundle (秘密鍵共有の完全排除)**:
   ```json
   {
     "version": 1,
     "issuer": "FUSOU Dedicated Verifier",
     "key_id": "verifier-key-2026-01",
     "tlsn_attestation_id": "<canonical_bytes_hex>",
     "server_identity": "api.kancolle-server.jp",
     "revealed_request_spans": [ { "start": 0, "length": 512, "bytes": "<base64url_raw_bytes>" } ],
     "revealed_response_spans": [ { "start": 123, "length": 456, "bytes": "<base64url_raw_bytes>" } ],
     "notary_time": 1724932800,
     "created_at": 1724932805,
     "signature": "<base64url_ed25519_signature>"
   }
   ```
   *Note*: `start` は TLS application plaintext transcript 上の offset です (HTTP body offset ではありません)。
   *Note*: 署名対象は JSON 文字列 (`JSON.stringify`) ではなく、wire format に依存しない Canonical Binary Serialization (length-delimited) を用います。
   
   **Transport confidentiality/authentication is supplementary. Security acceptance requires cryptographic signature verification over the Verifier Result.**  
   FUSOU-WEB 側は HTTPS 通信のみを信頼するのではなく、Verifier の **公開鍵のみ** を Key Registry に保持し、`VerifierResultSignBytes` に対する Ed25519 署名を検証することで初めて結果を受容します。`public_id` は Verifier Result に含めず、FUSOU-WEB が `verified_member_id` から導出します。

---

## 10. DB Schema（Supabaseマイグレーション: Challenge, Nonce, Telemetry, 拡張監査）

### `20260826010000_create_telemetry_attribution_tables.sql`
```sql
-- 共通の Identity Lock Key 導出関数
CREATE OR REPLACE FUNCTION public.fn_identity_lock_key(p_api_member_id BIGINT) RETURNS BIGINT AS $$
BEGIN
  RETURN ('x' || substr(md5(p_api_member_id::text), 1, 16))::bit(64)::bigint;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

BEGIN;

-- 1. Server-issued One-Time Claim Challenge テーブル (RLS: Service-role only)
CREATE TABLE IF NOT EXISTS public.claim_challenges (
    challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    tlsn_attestation_id BYTEA NOT NULL,
    challenge_nonce BYTEA NOT NULL CHECK (octet_length(challenge_nonce) = 32),
    notary_time TIMESTAMPTZ NOT NULL,
    notary_key_id TEXT NOT NULL,
    request_range_start BIGINT NOT NULL CHECK (request_range_start >= 0),
    request_range_length BIGINT NOT NULL CHECK (request_range_length > 0),
    response_range_start BIGINT NOT NULL CHECK (response_range_start >= 0),
    response_range_length BIGINT NOT NULL CHECK (response_range_length > 0),
    challenge_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (challenge_status IN ('ACTIVE', 'CONSUMED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (challenge_status = 'ACTIVE' AND consumed_at IS NULL) OR
        (challenge_status = 'CONSUMED' AND consumed_at IS NOT NULL) OR
        (challenge_status = 'EXPIRED' AND consumed_at IS NULL)
    )
);

-- 同時に有効な Challenge は 1 つまでとする制約 (期限切れ後は再発行可能)
-- NOW() のような mutable な関数は Partial Index に使えないため、challenge_status = 'ACTIVE' で一意性を担保します。
CREATE UNIQUE INDEX uq_active_claim_challenge_attestation 
ON public.claim_challenges (tlsn_attestation_id) 
WHERE challenge_status = 'ACTIVE';

ALTER TABLE public.claim_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service_role full access to claim_challenges"
    ON public.claim_challenges
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Telemetry リプレイ防御用 Nonce テーブル (30分保持)
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
    -- Idempotency のため、クライアントが生成・送信する UUIDv4 を必須とする (DEFAULT gen_random_uuid() 廃止)
    ingest_item_id UUID PRIMARY KEY,
    public_id UUID NOT NULL REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    submitted_by_device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    api_path VARCHAR(128) NOT NULL,
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
4. **Device Replacement (端末追加・失効)**: 同一オーナー（同一 `canonical_user_id`）が新端末を導入する場合、同一 `public_id` に対して新端末を `user_devices` に追加登録（Owner は不変）。**旧 Device の署名だけで新しい `member_id` の証明を代替することは不可（必ず新規 TLSNotary Proof が必要）**。
5. **Re-binding & Transfer Policy**: Game Account アクセス証明 $\neq$ Social Account 所有権証明。異なる Web ユーザーからの Claim は自動移転せず、明示的なリカバリ / 移転プロトコルを通じてのみ実行可能。

---

## 13. Migration & Token Revocation Semantics（既存データの安全な移行）

1. **既存 Dataset Token の一括失効**:
   移行開始時、旧自己申告経路で発行されたすべての Dataset Token を無効化（`user_devices.device_status = 'PENDING'` へのリセット）。
2. **既存自己申告 Device の扱い**:
   旧 Device 登録は一律無効化（`device_status = 'REVOKED'`）され、新システムでの `require_info` TLSNotary Claim を完了して初めて `device_status = 'VERIFIED'` に昇格し新 Dataset Token が発行されます。
3. **旧テーブル・RPC の無効化**:
   `pending_member_syncs` は削除。`rpc_register_public_id` は完全に DROP。

- **Legacy Cleanup と Route 撤去 (404 統一)**
  旧ルート `signInAnonymously`, `rpc_register_public_id`, `rpc_register_user_device`, `pending_member_syncs` は関連する全てのファイル、ルート、RPC、スキーマ、テストから完全物理削除されます。
  後方互換性としての HTTP 410 は実装せず、Router から完全に撤去することで Platform Generic 404 を返し、Security 上の攻撃面をゼロにします。


### 既存データベースに対するマイグレーション適用順序（Migration Execution Order）
既存の `user_devices` データに制約違反を起こさず安全に移行するため、以下の順序で DDL/DML を実行します：
1. **Add Columns**: `device_status`, `pending_expires_at`, `verified_at`, `revoked_at`, `revoked_reason`, `last_notary_time` の列を `user_devices` に追加する（この時点では CHECK 制約を入れない）。
2. **Backfill Existing Rows**: 既存の `device_status = 'PENDING'` 行に対し `pending_expires_at` などを populate する。
3. **Normalize Legacy Devices**: 古い自己申告 Device を `device_status = 'REVOKED'` へ一律更新し、同時に `revoked_at = NOW()`, `revoked_reason = 'legacy_security_model'` をセットする。
4. **Set Required Timestamps**: その他全行について `verified_at` 等の整合性を取る。
5. **Add CHECK Constraint**: 最後に `user_devices` に `chk_device_status_times` 制約を追加する。


---

## 14. Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）

### 14.1 検証項目（全24項目 / Mock Server 先行検証）
1. `POST /kcsapi/api_get_member/require_info` を対象にできる (Mock Server $\rightarrow$ Real Server の順序で検証)
2. Game Server への request は FUSOU 自身が二重送信しない（Game Server observed requests = 1）
3. TLSNotary proof が正常に verify できる
4. Server identity（Explicit Allowlist: Host + Path + Method + No Redirect）が正常に verify できる
5. `verified_member_id` の抽出（Decimal String / JS Number 変換完全禁止）が成功する
6. Transcript Range Selection による必要最小構造の切り出しが成立する（開示 range 数・Secret サイズ増加実測）
7. Wire Representation（Transfer-Encoding / Content-Encoding / gzip 順序）の実測が完了する
8. Selective disclosure による最小限開示が成立する
9. 正当な Device 署名（`verifyEd25519ClaimBinding`）が accept される
10. 別 Device の署名が reject される
11. 同一 Attestation の再利用が reject される（Anti-Reuse: UNIQUE tlsn_attestation_id）
12. `public_id` 改変が reject される
13. Challenge reuse が reject される
14. Expired challenge が reject される
15. 自己申告登録エンドポイント（旧 register / pending / 匿名自動生成）がコードベースから完全に根絶されている
16. Social account binding が正常に機能する
17. Token 発行順序が正しい（Triple Verified）
18. Telemetry payload による identity 上書きが排除される
19. 同一 Nonce replay が reject される
20. 同一 `ingest_item_id` + 同一 Body が idempotent success となる
21. 同一 `ingest_item_id` + 異なる Body が 409 Conflict となる
22. Device 再バインド時も過去 Telemetry の attribution が書き換わらない
23. リクエスト送信前の Notary 障害時フォールバックが機能する
24. Browser-visible な追加遅延および Proof completion 遅延の実測、および require_info レスポンスが MPC data limits に収まることの確認

### 14.2 Phase 0 GO / NO-GO 判定基準
| 分類 | 必須条件 (MUST PASS) | 判定基準 |
|---|---|:---:|
| **プロトコル** | FUSOU 生成の二重送信ゼロ | Game Server observed requests = 1 (Exactly One) |
| **暗号検証** | TLSNotary Proof 検証成功 | Notary 署名・Attestation Header/Body 検証完全一致 |
| **データ抽出** | `api_member_id` の正確な抽出 | レスポンス平文と抽出値（Decimal String）が一致（JS Number 完全禁止） |
| **バインディング** | `ClaimBindingBytes` 偽造不能 | 他端末秘密鍵・別 Nonce での Claim を遮断（正確な 24B length） |
| **端末すり替え拒絶** | 検証済み Proof に対する別 Device 署名拒絶 | **Proof P (member 1234) + Device B 署名 $\rightarrow$ 拒絶** |
| **Attestation 再利用遮断** | 同一 Attestation の多重 Claim 拒絶 | **Proof P + Challenge C2 $\rightarrow$ 拒絶 (UNIQUE tlsn_attestation_id)** |
| **自己申告完全根絶** | 旧 register / pending からの Token 発行遮断 | **コードベース上に自己申告 member_id で Token を取得できる経路が 0 件** |
| **所属決定権** | クライアントによる Dataset 選択排除 | Payload 内の `public_id` 改変を完全無視 |
| **リプレイ防御** | DB Nonce & Idempotency 検証 | 同一 Nonce 拒絶、同一 ID 異 Body で 409 Conflict |
| **耐障害性** | 送信前 Notary 障害時のログイン継続 | 通常 TLS フォールバックでゲームプレイ継続 |
| **接続性** | 外部中継プロキシ排除 | クライアントローカルから直接接続維持 |
| **性能目標** | `require_info` MPC 復号追加遅延 | **P95 < 300ms**（性能目標として記録・評価） |
| **バージョン固定** | TLSNotary Revision 確定 | Phase 0 終了時に exact git tag/commit を固定 |

---

## 15. Security Invariant $\rightarrow$ Enforcement $\rightarrow$ Test 対応表

第三者実装者およびセキュリティ監査者がシステムを検証するための決定論的対応表：

| # | Security Invariant | DB / Protocol Enforcement Mechanism | Automated Test Case |
|:---:|---|---|---|
| 1 | **Client cannot choose `public_id`** | Server-side `member_id_mapping` lookup & derivation | `test_forged_public_id_ignored` |
| 2 | **Client cannot choose `member_id`** | No client identity input on any route; TLSNotary verified only | `test_client_supplied_member_id_rejected` |
| 3 | **One Attestation = One Identity Claim** | `UNIQUE (tlsn_attestation_id)` on `member_identity_claims` | `test_duplicate_attestation_claim_rejected` |
| 4 | **Claim requires authentic Device** | `verifyEd25519ClaimBinding(pubkey, bytes, sig)` | `test_wrong_device_key_claim_rejected` |
| 5 | **Claim Challenge is Single-Use** | DB atomic update: `challenge_status = 'CONSUMED',
    consumed_at = NOW() WHERE challenge_status = 'ACTIVE'` | `test_challenge_nonce_replay_rejected` |
| 6 | **Telemetry belongs to Token's Dataset** | 3-way check: `JWT.dataset_id === SignDoc.public_id === user_devices.public_id` | `test_telemetry_dataset_substitution_rejected` |
| 7 | **Telemetry body content is unverified** | Payload stored directly without tampering checks under Dataset U1 | `test_arbitrary_telemetry_payload_accepted_under_u1` |
| 8 | **Revocation is effective on next request** | Server-side `user_devices.revoked_at IS NULL` lookup on every call | `test_revoked_device_telemetry_rejected` |
| 9 | **Social binding cannot be stolen** | `web_user_member_map (public_id UNIQUE)` & ownership auth check | `test_competing_user_social_binding_rejected` |
| 10 | **FUSOU generates exactly 1 request** | Direct single-stream MPC pipeline without retry logic | `test_upstream_request_count_equals_one` (Mockだけでなく実ProxyでのIntegration Test必須) |
| 11 | **Direct connection to Game Server** | Local MITM proxy topology without external proxy hops | `test_network_topology_direct_connection` |
| 12 | **Notary failure never causes replay** | Fallback policy: pre-request normal TLS, post-request no retry | `test_notary_fault_injection_no_duplicate_send` |

---

## 16. Security Progress Checklist（開発進捗チェックリスト）

- [D] ゲーム通信に外部プロキシを使用しない直接接続設計
- [D] FUSOU 生成の二重送信ゼロ設計（Game Server observed requests = 1）
- [D] 旧 `/anonymous-sync/v2/register` および `pending` 自己申告登録の完全根絶設計（Call graph 0本）。`rpc_register_public_id`, `ensureCanonicalUserForPublicId`, `signInAnonymously` の完全削除（DB DROP含む）。`issueDatasetToken()` の許可callerを `claim` と `social-bind` のみに完全一致（allowlist化）し、`register` や `refresh` などを FORBIDDEN とする。
- [D] MPC 復号遅延と Proof 後処理（非同期化）のイベント分離 (T0〜T6) および、fusou-proxy-tlsn 内部における MPC 復号ストリームからの Gameplay 転送と EvidenceFrame (session_id, request_id, response_id, transcript_range, raw_bytes 定義による TLSNotary Transcript との同一性の型レベル保証) の単一ストリーム分離（Single Stream Fork）設計
- [D] `ClaimBindingBytes` の厳密な Byte Layout & Binary Framing 設計（`proof_purpose` ＝ `GAME_ACCOUNT_IDENTITY_V1` を正確に 24 bytes として自動テスト。UUID は 16-byte binary、`verified_member_id` は normalized decimal ASCII UTF-8 bytes に完全固定。既存 `verifyDeviceSig(string)` は使用禁止とし `verifyEd25519ClaimBinding(Uint8Array, ...)` へ切り替え）。Telemetry も `FUSOU-TELEMETRY-SIGN-V1` を用い length-delimited に完全固定。
- [D] 初回 Claim 論理プロトコル 8 ステップ順序（Lock -> PublicID -> Challenge -> Signature -> Atomic Commit）
- [D] Server-issued One-Time Challenge の DB 管理（旧 stateless HMAC challenge の完全 DELETE と新 `claim_challenges` の CREATE）。`UPDATE ... WHERE challenge_status = 'ACTIVE'` を用いたアトミック消費と、Attestation 検証完了後のみの Challenge 発行の厳格化。
- [D] 同一 Attestation の多重 Claim 遮断（`UNIQUE (tlsn_attestation_id)`）設計
- [D] `require_info` によるセッション最初 1 回限りの Identity Attestation 設計（SessionKey 単位）
- [D] Telemetry ペイロードからの所属識別子完全排除 & 提出時点 Immutable 帰属設計
- [D] Dual Authentication & `telemetry_nonces`（30分保持）による Replay Protection 設計
- [D] Telemetry 7 段階検証順序 & 新規時 Nonce 消費・INSERT 同一トランザクション設計
- [D] `member_id_hash` / Pepper 体系の完全削除と UUID `public_id` への一本化
- [D] Quad Invariant（$\text{member\_ownership.social\_user\_id} \equiv \text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \equiv \text{web\_user\_member\_map.user\_id}$）の段階的成立定義
- [D] 64-bit Advisory Lock & 親行ロック契約により衝突確率を十分に低減する設計
- [D] `member_ownership`（現在状態）と `member_identity_claims`（ON DELETE RESTRICT とトリガー trg_protect_member_claims_audit により、DB レベルで UPDATE/DELETE を物理禁止する真の Append-Only 監査履歴）の分離
- [D] Advisory Lock 取得後の Proof / Attestation Consumption Policy（同一 transcript_commitment の多重消費を DUPLICATE_PROOF_CONSUMED で即時遮断）設計、および claim_verified_device_v3 は FUSOU-WEB が TLSNotary を完全検証済みであることを前提とする Security Boundary の明文化
- [D] Security Invariant $\rightarrow$ Enforcement $\rightarrow$ Test 対応表の定義
- [P] Phase 0 PoC（公式 tlsn-extension を参考とした prove() / compute_reveal() / handler 機構の調査・流用方針の策定、および alpha 版特定 API への過度な依存排除）
- [P] Verifier 実行環境ベンチマーク（Workers vs Dedicated Rust Verifier）および exact TLSNotary revision 固定（T3 Browser response 返却後に同一 MPC session で T4 Attestation 生成が可能かを Phase 0 で実証必須） (例: FUSOU TLSNotary profile v1 tlsn git commit = ABC, Attestation.header().id serialization = exact canonical bytes) および claim_challenges.attestation_id と member_identity_claims.tlsn_attestation_id の同一ID体系の固定
- [I] 実装および DB マイグレーション適用（旧Tokenの完全失効と refresh 拒絶、旧Deviceの `device_status = 'REVOKED'` への一律無効化、旧Telemetryの `LEGACY_UNVERIFIED` 扱い、および `pending_member_syncs` 関連全コードの削除、`member_id_mapping` の保持）
- [T] 単体テスト・端末すり替え遮断テスト・Attestation 再利用遮断テスト


---

## Implementation Closure Rule (実装凍結要件)

### Appendix: Implementation Closure Matrix (Phase 0 監査対応)

以下のマトリクスは、第三者が完全に同一のセキュリティ強度を実装できるよう、全 Security Invariant を網羅したものです。

| # | Threat (脅威) | Enforcement Point (強制点) | Code/File | DB Constraint | Allowed Caller | Forbidden Caller | Migration Action | Test Case |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| 1 | Identity Spoofing (先回り登録) | 登録経路の物理的遮断 | `/anonymous-sync/` | - | TLSNotary `claim` / `social-bind` のみ | `register`, `pending`, `rpc_register_public_id`, `anonymous user` | `rpc_register_public_id`, `signInAnonymously` 完全 DROP | `test_client_supplied_member_id_rejected` |
| 2 | Attestation Replay / Hijacking | Challenge発行時の検証必須化 | `claim_challenges` | `UNIQUE(tlsn_attestation_id)` | `claim` 検証後の challenge 発行 | 偽装デバイス, Verifier未検証リクエスト | 旧 stateless HMAC challenge 完全 DELETE | `test_duplicate_attestation_claim_rejected` |
| 3 | Telemetry Forgery (帰属偽装) | Server-side 3-way check | JWT `sub` + `dataset_id` | - | `JWT.dataset_id == device.public_id == sig.public_id` | クライアント送信のIDを信じる全処理 | JWT `sub=device_id` 化を全 Token consumer へ適用 | `test_telemetry_dataset_substitution_rejected` |
| 4 | Telemetry Replay (連続送信) | Nonce アトミック消費 | `telemetry_nonces` | `consumed_at` 同一トランザクション | Idempotency Lookup (200 OK) | 異Bodyの再送信 (409 Conflict) | 旧Telemetryを `LEGACY_UNVERIFIED` 分離 | `test_telemetry_nonce_replay_rejected` |
| 5 | Stream Manipulation (すり替え) | Single Stream Fork | `fusou-proxy-tlsn` | - | Proxy内部ストリーム | 分割・遅延された別リクエスト | - | `test_single_stream_fork_consistency` |
| 6 | Audit Trail Tampering | Append-Only 強制 | `member_identity_claims` | `ON DELETE RESTRICT` & Trigger | `claim_verified_device_v3` のみ | admin, cron, CASCADE DELETE | `member_id_mapping` 削除禁止維持 | `test_audit_trail_update_rejected` |
| 7 | Legacy Token Bypass | 旧トークンの更新遮断 | Token Refresh Endpoint | - | Triple Verified User のみ | 旧 legacy token | JWT 検証側で `credential_version: 1` 必須化（device_status 依存だけでなく Token schema レベルで拒絶） | `test_legacy_token_refresh_rejected` |
| 8 | Legacy Device Bypass | 旧デバイスの無効化 | Device Verify Status | - | 新 TLSNotary Proof のみ | 旧 `device_status='VERIFIED'` の無条件継承 | 旧 Device `device_status='REVOKED'` へ一律無効化 (migration_reason = 'legacy_security_model') | `test_legacy_device_unverified_fallback` |
| 9 | Cryptographic Parameter Drift | Wire Serialization 完全固定 | `ClaimBinding`, `TelemetrySignDoc` | - | UUID (16-byte binary), `member_id` (ASCII utf-8) | `verifyDeviceSig(string)`, 単純concat | `GAME_ACCOUNT_IDENTITY_V1` 24 byte 固定 | `test_claim_binding_byte_length_24` |
| 10 | Cryptographic Cross-Reuse | Domain Tag の分離 | `TelemetrySignDoc` | - | `FUSOU-TELEMETRY-SIGN-V1` (length-delimited) | `FUSOU-IDENTITY-CLAIM-V1` (流用禁止) | Telemetry も length-delimited 化 | `test_telemetry_domain_tag_isolation` |
| 11 | JSON Wire Forgery | Lossless JSON Parser | FUSOU-WEB Parser | - | 完全構造一致 `/api_data/api_basic/api_member_id` | `JSON.parse` のNumber変換, Regex検索 | v1 wire (JSON Number vs String) の確定 | `test_lossless_json_pointer_extraction` |
| 12 | Device Claim Race | PENDING Device State | `claim_verified_device_v3` | `device_id` FK | PENDING デバイスへの Challenge 発行 | 未登録デバイスへの Challenge | - | `test_pending_device_claim_lifecycle` |
| 13 | Idempotency Failure | Client-gen UUIDv4 | `telemetry_events` | `ingest_item_id` PK | クライアント送信 UUIDv4 必須化 | サーバー側の自動 UUID 生成 | - | `test_client_generated_idempotency_key` |
| 14 | API Verification Gap | Phase 0 実測確定 | MPC-TLS Lifecycle | - | T3 Browser 返却後の T4 Attestation 成立 | Verifier の plaintext 事前取得 | - | `test_tlsnotary_t3_t4_compatibility` |
| 15 | Verifier Result Serialization | Canonical Encoding | Verifier | - | `base64url` 無し Canonical Binary 署名 | `JSON.stringify` 依存 | - | `test_verifier_result_canonical_serialization` |
| 16 | JSON Duplicate Key Injection | JSON Parser | FUSOU-WEB Parser | - | Duplicate key error 拒絶 | 最初/最後のキーを静かに採用 | - | `test_json_duplicate_key_rejected` |
| 17 | JSON String Escape Bypass | JSON Parser | FUSOU-WEB Parser | - | `api_member_id` の ASCII digits (Number) 完全一致 | `\u0031` 等の Unicode escape 許可 | - | `test_json_unicode_escape_rejected` |
| 18 | JSON Exponential Forgery | JSON Parser | FUSOU-WEB Parser | - | 指数表現(`1e4`), 符号(`-1`) を拒絶 | 浮動小数点/指数パース許可 | - | `test_json_exponential_number_rejected` |
| 19 | Verifier Canonical Framing | Verifier Result | Verifier | - | `VerifierResultSignBytes` = length-delimited binary | JSON field order に依存する署名 | - | `test_verifier_result_binary_framing` |
| 20 | Decoder Padding Attack | Base64URL Strict Decoder | FUSOU-WEB Parser | - | padding (`=`) なしの strict base64url | loose/malleable base64url decoder | - | `test_base64url_strict_decoder` |
| 21 | Verifier Result Issuer Check | Verifier Signatures | FUSOU-WEB Parser | - | `issuer = FUSOU Dedicated Verifier` 必須 | issuer の未確認 | - | `test_verifier_result_issuer_verification` |
| 22 | T3-T4 MPC State Loss | TLSNotary Lifecycle | MPC Proxy | - | Browser response 返却後も MPC state を保持し T4 移行 | T3 後に MPC Connection を破棄 | - | `test_mpc_state_retention_after_t3` |
| 23 | Legacy RPC Orphan | RPC Replacement | DB Migration | - | `rpc_register_user_device` の責務を `claim_verified_device_v3` へ完全統合 | - | `rpc_register_user_device` DROP | - |
| 24 | PENDING Device DoS | Resource Exhaustion | DB Cron / Trigger | - | 24h TTL で expired PENDING device を論理無効化 (Never Reuse 保証) | - | - | `test_pending_device_ttl_cleanup` |
| 25 | PENDING Re-use | Device Isolation | DB Schema | `device_id` 削除後は再利用禁止 | 紛失時は新規 `device_id` を発行 | 期限切れ `device_id` の使い回し | - | `test_pending_device_reuse_rejected` |
| 26 | Challenge Idempotency | Attestation Replay | `claim_challenges` | - | `member_identity_claims` または `claim_challenges` で `tlsn_attestation_id` 確認 | 同一 Attestation での複数 Challenge 発行 | - | `test_challenge_replay_by_attestation_id_rejected` |
| 27 | Claim Idempotency | Attestation Replay | `claim_verified_device_v3` | - | 同一Attestation + public_id + device_id の再Claimは成功扱い | 異なるdeviceへのClaim流用 | - | `test_claim_idempotency_same_device` |
| 28 | HTTP Size Forgery | Resource Exhaustion | FUSOU-WEB Proxy | - | `Content-Length` ではなく実際の受信 Bytes で上限判定 | 偽の Content-Length を信用する | - | `test_http_actual_size_limit_enforced` |
| 29 | Chunked / Gzip Bomb | Memory Exhaustion | FUSOU-WEB Proxy | - | dechunk/decompressed の最終サイズで 500KB 上限判定 | 圧縮時サイズのみで判定 | - | `test_http_decompressed_size_limit` |
| 33 | Fallback Identity Attack | FUSOU-WEB Parser | - | - | Fallback 経由の `member_id` は Identity Claim で利用不可（完全拒絶） | Fallback の `member_id` を信頼 | - | `test_fallback_member_id_identity_rejected` |
| 34 | Telemetry Validation Order | FUSOU-WEB Pipeline | - | - | Signature 検証 -> Idempotency 確認 -> Nonce 消費 -> INSERT の順序を厳格化（Idempotent 返却時でも Signature 検証は必須） | 署名検証前の DB 操作 | - | `test_telemetry_signature_verified_before_idempotency` |
| 35 | Telemetry Idempotency Return | FUSOU-WEB Pipeline | `telemetry_events` | `ingest_item_id` PK | 同一 `ingest_item_id` ＋ 同一 `body_hash` = 200 OK | 同一 `ingest_item_id` ＋ 異 `body_hash` = 409 Conflict | - | `test_telemetry_idempotency_body_hash_match` |
| 36 | Telemetry Nonce DB Schema | DB Schema | `telemetry_nonces` | `PRIMARY KEY(device_id, nonce)` | `device_id` と `nonce` の複合 PK による厳格な単一消費 | 複合PKを持たない設計 | - | `test_telemetry_nonce_composite_pk` |
| 37 | Telemetry SignDoc Framing | SignDoc Encoding | `TelemetrySignDoc` | - | Length-delimited binary framing のみ許可 | 単純 string concatenation | - | `test_telemetry_signdoc_length_delimited` |
| 38 | Telemetry Domain Separation | SignDoc Context | `TelemetrySignDoc` | - | `FUSOU-TELEMETRY-V1` などの明示的な Domain Context 必須 | - | - | `test_telemetry_domain_separation_enforced` |
| 30 | MPC Failure Gameplay Block | Availability Loss | MPC Proxy | - | MPC失敗時は normal TLS fallback に切り替えゲーム影響ゼロ | 送信後のMPC失敗時にゲーム通信まで失敗 | - | `test_mpc_failure_graceful_fallback` |
| 31 | DB Failure Replay | Gameplay Re-submission | MPC Proxy | - | DB書込失敗時でもブラウザへ送信済みなら再送しない | ブラウザ要求をゲームサーバーへ再送 | - | `test_db_failure_no_gameplay_replay` |
| 32 | Queue Unbound Retry | Resource Exhaustion | Background Jobs | - | invalid proof 等の non-retryable error は即時破棄 | 永久再試行 (Infinite Retries) | - | `test_queue_non_retryable_error_discard` |

### 移行における完全削除対象ファイル (Files to DELETE)
新 Security Boundary を迂回する全経路を遮断するため、以下のレガシーコード・RPCは「非推奨」ではなく**物理的に完全削除（DROP / DELETE）**します。
- `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts`（旧 register / pending completion 全ハンドラ）
- `packages/FUSOU-WEB/src/server/utils/pepper.ts`
- 旧 HMAC challenge handler および関連 DB スキーマ
- 匿名ユーザー自動生成関数 (`signInAnonymously`, `ensureCanonicalUserForPublicId`)
- 汎用 RPC (`rpc_register_public_id`, `rpc_register_user_device`)




本仕様書に定義された各 Security Invariant（セキュリティ不変条件）について、以下の8項目を1対1で対応付ける **Implementation Closure Matrix** を作成・維持します。いずれか1項目でも欠落している不変条件が存在する場合、本仕様は「確定（Freeze）」とはみなされません。

1. **Threat (脅威)**: 防御すべき攻撃シナリオ
2. **Enforcement Point (強制点)**: システム上のどこで防御するか
3. **Code/File (コード)**: 該当する処理ファイル
4. **DB Constraint (DB制約)**: DBレベルでの保護（UNIQUE, トリガー, RLSなど）
5. **Allowed Caller (許可経路)**: 実行を許可される単一または限定されたコールグラフ
6. **Forbidden Caller (禁止経路)**: 旧経路など、実行してはならない経路
7. **Migration Action (移行措置)**: 既存データ・旧経路に対するマイグレーション（旧Token失効、旧関数DROP等）
8. **Test Case (テスト)**: 実装を自動証明するテスト名


## Identity State Machine と Transition 厳密定義

以下は、システムの唯一の Source of Truth となる Identity State Machine です。

1. **UNCLAIMED**
   - **証明済み**: OAuth ログイン済みのユーザーであることのみ。
   - **DB状態**: `auth.users` にのみ存在。`user_devices` には存在しない。
   - **未確定**: `member_id`、Game Account との繋がり。
   - **次遷移**: `TLSN_PROOF_VERIFIED` (Challenge 取得等を通じて)。
   - **戻る遷移**: なし。
   - **禁止遷移**: `GAME_IDENTITY_VERIFIED` への直接ジャンプ。

2. **TLSN_PROOF_VERIFIED**
   - **証明済み**: 指定の `member_id` に対する TLSNotary Proof が暗号学的に正しいこと。
   - **DB状態**: FUSOU-WEB のメモリ上でのみ検証成功、DB 上では未コミット（`public_id` 未確定または PENDING 発行前）。
   - **未確定**: デバイスの署名（Claim）、および他者による排他的所有権の有無。
   - **次遷移**: PENDING Device 登録 (クライアントが **`verifier_result` の実体を毎回ステートレスに送信する** 一意な設計とします。identity session handle は用いません) を経て `GAME_IDENTITY_VERIFIED` (Claim API 経由)。
   - **戻る遷移**: `UNCLAIMED` (Proof 期限切れ・破棄)。
   - **禁止遷移**: この状態で `dataset_token` を発行すること。

3. **GAME_IDENTITY_VERIFIED** (Device Bound)
   - **証明済み**: Proof が正しく、かつ PENDING デバイスの秘密鍵による Ed25519 署名が提出・検証され、そのデバイスが正式に Game Identity (`public_id`) と結びついたこと。
   - **DB状態**: `user_devices.device_status = 'VERIFIED'`。`member_identity_claims` に記録完了。`member_ownership` に `primary_device_id` として登録。
   - **未確定**: Social Account（Web ユーザー）との永続的な所有権結びつけ。
   - **次遷移**: `SOCIAL_ACCOUNT_BOUND`。
   - **戻る遷移**: `UNCLAIMED` (Device Revoke)。
   - **禁止遷移**: 他の `public_id` への付け替え。

4. **SOCIAL_ACCOUNT_BOUND**
   - **証明済み**: `GAME_IDENTITY_VERIFIED` なデバイスを持つユーザーが、明示的に Web Application 側で Social Binding 操作を完了したこと。
   - **DB状態**: `user_member_map` および `web_user_member_map` に登録完了（Quad Invariant 成立）。
   - **未確定**: なし。
   - **次遷移**: `DATASET_TOKEN_ISSUED`。
   - **戻る遷移**: `GAME_IDENTITY_VERIFIED` (Social Unbind された場合)。
   - **禁止遷移**: 異なる Social User への勝手な移転（明示的 Transfer API が必要）。

5. **DATASET_TOKEN_ISSUED**
   - **証明済み**: 上記すべての状態を満たすアクティブなセッションに対して JWT が発行されたこと。
   - **DB状態**: 状態自体は DB ではなく、クライアントが有効な JWT (`credential_version=1`) を保持。DB 上の Device や Social Binding が剥奪されれば実質無効（Live Lookup）。
   - **次遷移**: JWT 期限切れによる再取得。
   - **戻る遷移**: DB 側の状態剥奪による JWT 失効。
   - **禁止遷移**: Legacy Token からのリフレッシュ昇格。

※ 旧来のレガシー中間状態はランタイム State Machine から**完全消滅**しています。履歴用の Historical Marker として `TAKEOVER_FROM_UNVERIFIED_DEVICE` を Audit Log (`member_identity_claims.claim_type`) に残すのみです。


## Challenge Lifecycle と DB 処理順序

- **Challenge Lifecycle と DB 処理順序**
  1. `claim_challenges` テーブルにおいて、`challenge_status TEXT CHECK (challenge_status IN ('ACTIVE', 'CONSUMED', 'EXPIRED'))` を設ける。
  2. `CREATE UNIQUE INDEX uq_active_claim_challenge_attestation ON public.claim_challenges (tlsn_attestation_id) WHERE challenge_status = 'ACTIVE';` により、「同一Attestationから同時にACTIVEなChallengeは最大1個」を保証。
  3. **Challenge 取得 Transaction の厳密な処理順序**:
     a. **Challenge issuance always acquires an advisory lock derived deterministically from the canonical `tlsn_attestation_id`; row locking alone is not sufficient** (Because the row might not exist yet).
     b. 既存の ACTIVE Challenge のうち `expires_at <= NOW()` となったものを `challenge_status = 'EXPIRED'` に UPDATE。※この `UPDATE` は一般 Application Role からは実行禁止とし、Challenge issuer transaction 内部の Security Definer 権限でのみ実行されます。
     c. ACTIVE な Challenge がまだ残っているか SELECT して確認。
     d. 残っていれば、**必ずその既存の ACTIVE Challenge をそのまま返します**（エラーにはしません）。無ければ新しい Challenge を INSERT して `ACTIVE` として返します。
     これにより、クライアントからの Timeout/Retry 時には同じ Challenge が返り、期限切れ(`EXPIRED`)の場合は新しい Challenge が発行されるという実装が一意に確定します。
  ※ `challenge_status = 'ACTIVE'` と `expires_at < NOW()` という矛盾状態は、Issuer transaction 開始前には（CronによるCleanupが行われるまで）一時的に存在し得ます。しかし、Claim エンドポイント側で `expires_at > NOW()` を常に検証するため、期限切れ Challenge が消費されることは即座に Reject されます。
  ※ このトランザクション順序により、Cron が停止していても Security Invariant（ACTIVEは最大1個）は絶対に壊れません。
  ※ `expires_at` は状態を自動変更する DB 制約 (trigger/check) ではなく、Challenge access/claim transaction が評価して状態を更新するための期限値です。


## Range Schema と検証 (完全定義)

- **Range Schema と検証 (完全定義)**
  TLSNotary から提出される Revealed Spans の各 Range オブジェクトは、以下の厳密な Schema を満たす必要があります。
  - `start`: uint64
  - `length`: uint64
  - `bytes`: base64url strict (paddingなし)
  **Verifier 検証要件**:
  - `start >= 0` かつ `length > 0`
  - `start + length` 演算時における uint64 オーバーフローのチェック (Rust `checked_add` 必須)
  - `decoded(bytes).length == length` であること
  - Range end が TLS Application Plaintext Transcript size 以下であること（HTTP Body Offset や Decompressed Body Offset と混在させてはならない）
  - 各 Span Array 内部での Overlap は厳格に禁止
  - Array の並び順 (Order deterministic): `start` の昇順であることを強制


## Parser の完全決定論的挙動

- **require_info 解析器の完全決定論的挙動**
  FUSOU-WEB の Application Verifier は `JSON.parse()`, 正規表現検索, 部分文字列検索を**一切使用しません**。
  Strict Lossless JSON Tokenizer によって、`root -> api_result` と `root -> api_data -> api_basic -> api_member_id` の JSON Pointer を構造的に直接トラバースします。
  以下の異常な JSON 表現は Parser レベルで即座に Reject します：
  - Duplicate key (重複キー)
  - Unicode escape (`1` 等)
  - Exponent (指数表記 `1e4`), Negative (負数), Decimal (小数点)
  - Invalid UTF-8
  `api_member_id` の Wire Type は、Phase 0 実測により String か Number のいずれか**1つに固定**（現行仕様では JSON Number に固定）し、それ以外の型表現は許容しません。
  `root.api_result` も同様に、ルートオブジェクト直下に1回のみ出現する JSON Number の `1` であることを構造的に検証します。


## DB 権限と Security Root の保護

- **DB 権限と Security Root の保護**
  - **Security Root**: `member_id_mapping`, `member_identity_claims`, `member_ownership`, `user_devices`
  - **Projection**: `user_member_map`, `web_user_member_map`
  Projection は Security Root からいつでも Rebuild 可能な手続きを用意します。
  **権限 (Defense in Depth)**:
  - `member_id_mapping`: `api_member_id` と `public_id` は Immutable。`REVOKE UPDATE, DELETE ON public.member_id_mapping FROM PUBLIC, authenticated, anon, service_role;` により変更を DB 権限レベルで禁止。
  - `member_identity_claims`: Audit History として Insert-Only。`REVOKE UPDATE, DELETE ON public.member_identity_claims FROM PUBLIC, authenticated, anon, service_role;`
  - `claim_verified_device_v3`: `REVOKE EXECUTE ON FUNCTION public.claim_verified_device_v3 FROM PUBLIC; GRANT EXECUTE TO service_role;` を適用。


## Fallback Security と Integration Test

- **Fallback Security と Integration Test (Exactly 1 upstream request)**
  MPC-TLS 失敗時の Normal TLS への Fallback は、**Game Server へ Application Request が 1 byte でも送信される前**の場合のみ許可され、`DATASET_TOKEN_NOT_ISSUED` として Gameplay のみを継続します。
  送信後に失敗した場合は Fallback および再送を厳格に禁止します。Fallback で得られた `member_id` を Identity として信用することは絶対にありません。
  これを担保するため、Mock ではなく実際の Proxy を通した Integration Test にて「Intercept された 1 つの論理リクエストに対して、Game Server が観測する Upstream Request が Exactly 1 であること」を実測検証します（0=Failure, 1=Correct, 2+=Protocol Violation）。


## PENDING Device Race Condition 排除

- **PENDING Device 5台制限の Race Condition 排除**
  単なる `SELECT COUNT(*) -> INSERT` では競合するため、`canonical_user_id` と `public_id` に基づく Advisory Lock を取得したトランザクション内部で `COUNT` と `INSERT` をアトミックに実行し、`per-user <= 5` および `per-public_id <= 5` を完全に保証します。


## 最終監査トレーサビリティ・マトリクス

| Security Property       | Source of Truth                  | Enforcement     | Code Location | DB Enforcement           | Test              |
| ----------------------- | -------------------------------- | --------------- | ------------- | ------------------------ | ----------------- |
| member_id authenticity  | TLSNotary MPC-TLS                | Verifier Result | FUSOU-WEB API | N/A                      | `test_tlsnotary_proof_validity` |
| public_id uniqueness    | member_id_mapping                | DB Constraint   | Supabase      | UNIQUE, Immutable        | `test_public_id_immutable` |
| Device binding          | ClaimBindingBytes Ed25519 Sig    | FUSOU-WEB API   | FUSOU-WEB API | FK to `user_devices`     | `test_claim_binding_signature` |
| Attestation anti-reuse  | member_identity_claims           | DB Constraint   | Supabase      | UNIQUE (tlsn_attestation_id)| `test_duplicate_attestation_claim_rejected` |
| Challenge single-active | claim_challenges                 | DB Transaction  | Supabase      | UNIQUE partial-by-status | `test_single_active_challenge` |
| Telemetry attribution   | Dataset Token + Device Signature | FUSOU-WEB API   | FUSOU-WEB API | JWT validation, DB live lookup | `test_telemetry_attribution_dataset` |
| No re-submission        | Proxy state machine              | FUSOU-PROXY     | Proxy Core    | N/A                      | integration `exactly_one_upstream` |
| Legacy string absence | Source Code | CI Gate | CI | N/A | `grep -R "is_verified"` == 0 |
| Legacy DB mapping | Source Code | CI Gate | CI | N/A | `grep -R "member_id_hash"` == 0 |
| Legacy state string | Source Code | CI Gate | CI | N/A | `grep -R "PRE_REGISTERED"` == 0 |
| Legacy API absence | Source Code | CI Gate | CI | N/A | `grep -R "verified_user_id"` == 0 |
| Legacy path absence     | call graph / router              | CI Static Check | Router        | N/A                      | grep 404 / AST check |
