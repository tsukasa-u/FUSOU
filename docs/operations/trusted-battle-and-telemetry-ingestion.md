# FUSOU: Game Account Identity Attestation & Dataset Attribution 仕様書 (v1 Scope)

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-hudsucker`, `packages/fusou-proxy-tlsn`, `packages/fusou-telemetry`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers / Dedicated Verifier Service）  
> **v1 Core Security Goal**:  
> **「FUSOU v1 は、ログイン時の `require_info` に含まれる `api_member_id` についてのみ TLSNotary による Game Server provenance を確立し、その証明済み Game Account を `public_id` へ固定する。その後の Telemetry は内容を信頼せず、認証済み Dataset/Device credential からサーバー側で所属 Dataset を決定して保存する（Dataset Attribution / Provenance 保証）。」**  
> 対象 API: **`POST /kcsapi/api_get_member/require_info`**（1つの Game Login Session で最初に正常取得された 1 回のみ）  
> 対象データ: **`/api_data/api_basic/api_member_id`**（Wire: `i64`, Canonical Internal: Decimal String）  
> **最重要設計原則**:  
> 1. **Identity Attestation と Telemetry Submission の完全分離**:  
>    - **① Identity Attestation（暗号学的保証）**: ログインセッション開始時の最初の `require_info` を FUSOU-Prover と Game Server 間の TLSNotary MPC-TLS セッションで公証し、Game Account（`api_member_id`）$\rightarrow$ `member_id_mapping` $\rightarrow$ Dataset（`public_id`）$\rightarrow$ Social User（`web_user_member_map`）$\rightarrow$ Authorized Device（`user_devices`）の身元連鎖を確立する。  
>    - **② Telemetry Submission（内容は UNTRUSTED / 所属先 Dataset は TRUSTED）**: 戦闘等のテレメトリデータ自体は暗号公証せず、クライアントはリクエスト内に `member_id`, `public_id`, `dataset_id`, `owner user_id` などの所属識別子を一切含めない。  
> 2. **MPC-TLS 処理 3 段階と Browser 待機の分離**:  
>    - **Phase A**: Request routing / upstream connection  
>    - **Phase B**: MPC-TLS による Response plaintext 取得（**MPC-TLS response acquisition remains on the login API path** / 許容遅延は Phase 0 で実測）  
>    - **Phase C**: Presentation 生成 + Remote verification + DB claim（**Post-processing is not on critical path**）  
> 3. **Device ↔ Proof の暗号学的バインディング（Server-issued One-Time Challenge & Byte Layout 完全固定）**:  
>    - `public_id` はクライアントが任意選択せず、サーバーが `verified_member_id` から導出する。  
>    - サーバーが発行・DB 記録する One-Time Challenge（`challenge_id`, `challenge_nonce`）に対して、完全固定されたバイト列（Length-delimited binary framing）で `ClaimBindingMessage` を構築・署名する。  
> 4. **Telemetry Ingest における厳格な Attribution 決定権 & Immutable 記録**:  
>    - **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。`api_path` は informational metadata であり認可判断には使用しない。」**  
>    - 提出された Telemetry レコードの `(public_id, submitted_by_device_id)` は **提出時点（submission time）の事実として Immutable に保存** され、将来のデバイス再バインド時にも過去データは一切更新されない。  
> 5. **Dual Authentication & Replay Protection（DB 永続化 Nonce + Raw Body Hash Idempotency）**:  
>    - Telemetry アップロード時は `Authorization: Bearer <dataset-token>` に加え、`X-FUSOU-Device-ID`, `X-FUSOU-Nonce`, `X-FUSOU-Timestamp`, `X-FUSOU-Signature`（Ed25519）を要求。  
>    - サーバー側で `telemetry_nonces` テーブルに記録してリプレイを遮断（許容窓 ±5 分、保持期間 10 分、`device_id` は Never-reused）。  
>    - `body_hash = sha256(raw_body_bytes)` と `ingest_item_id` により、同一 ID かつ Body 一致時は 200/201 冪等成功、Body 不一致時は 409 Conflict で拒絶。  
> 6. **再送信ゼロ（No Re-submission）**: FUSOU 自身が同一 logical request を二重送信しないことを徹底する（FUSOU-generated duplicate = 0）。  
> 7. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 8. **Fallback 時のステータス明示**:  
>    Notary 障害時は `GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED` の状態へ安全にフォールバックし、ゲームプレイを継続する。  
> **ステータス**: Byte Layout完全固定・One-Time Challenge DB管理・Immutable Telemetry完全反映マスター  

---

## 目次

1. [Goal & Concept (Identity Attestation と Dataset Attribution の分離)](#1-goal--concept-identity-attestation-と-dataset-attribution-の分離)
2. [Threat Model & Security Guarantees（脅威モデルと保証境界）](#2-threat-model--security-guarantees脅威モデルと保証境界)
3. [Architecture Overview（身元連鎖とデータフロー）](#3-architecture-overview身元連鎖とデータフロー)
4. [Identity Attestation Protocol (`api_get_member/require_info`)](#4-identity-attestation-protocol-api_get_memberrequire_info)
   - 4.1 [セッション最初の 1 回の定義と再試行ポリシー](#41-セッション最初の-1-回の定義と再試行ポリシー)
   - 4.2 [MPC-TLS 処理 3 段階と Browser 待機の分離](#42-mpc-tls-処理-3-段階と-browser-待機の分離)
   - 4.3 [構造化 HTTP Parser & Trusted Server Identity Policy](#43-構造化-http-parser--trusted-server-identity-policy)
   - 4.4 [Application-level Validation & 多段抽出](#44-application-level-validation--多段抽出)
5. [Device ↔ Proof Binding & Social Account Linking](#5-device--proof-binding--social-account-linking)
   - 5.1 [ClaimBindingMessage の厳密な Byte Layout と Canonical Serialization](#51-claimbindingmessage-の厳密な-byte-layout-と-canonical-serialization)
   - 5.2 [Server-issued One-Time Challenge の DB ライフサイクル](#52-server-issued-one-time-challenge-の-db-ライフサイクル)
   - 5.3 [Social Account Linking と Invariant 段階的成立](#53-social-account-linking-と-invariant-段階的成立)
   - 5.4 [Dataset Token の発行条件（Triple Verified Issuance）](#54-dataset-token-の発行条件triple-verified-issuance)
6. [Telemetry Submission Protocol (Dual Auth: Token + Device Signature)](#6-telemetry-submission-protocol-dual-auth-token--device-signature)
   - 6.1 [Telemetry Ingest 原則 & Immutable 帰属保証](#61-telemetry-ingest-原則--immutable-帰属保証)
   - 6.2 [リクエスト仕様 & Idempotency / DB Nonce Retention](#62-リクエスト仕様--idempotency--db-nonce-retention)
   - 6.3 [サーバー側処理パイプライン](#63-サーバー側処理パイプライン)
7. [Rust Workspace クレート分割設計 & 命名整合](#7-rust-workspace-クレート分割設計--命名整合)
8. [Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）](#8-phase-0-poc--gono-go-criteria実測検証計画と判定基準)
9. [FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)](#9-fusou-web-verifier-アーキテクチャ-workers-vs-dedicated-rust-verifier)
10. [DB Schema（Supabaseマイグレーション: Challenge, Nonce, Telemetry）](#10-db-schemasupabaseマイグレーション-challenge-nonce-telemetry)
11. [Failure Handling & Fallback Semantics (Phase A / Phase B)](#11-failure-handling--fallback-semantics-phase-a--phase-b)
12. [Security Progress Checklist（開発進捗チェックリスト）](#12-security-progress-checklist開発進捗チェックリスト)

---

## 1. Goal & Concept (Identity Attestation と Dataset Attribution の分離)

### 1.1 背景と設計思想の転換
FUSOU において真に防ぐべき攻撃は、**「悪意ある第三者が、他人のゲームアカウント（`api_member_id`）や他人の Social アカウントになりすまして偽の戦闘データを送信し、特定プレイヤーの統計やコミュニティデータを汚染すること（Attribution 偽装 / なりすまし攻撃）」** です。

したがって、v1 では「戦闘データの中身が本物か」を毎戦闘ごとに重い MPC-TLS で公証する過剰設計を排し、**ログインセッション最初の `require_info` で 1 回だけ強固に Game Account の身元（Identity）を暗号公証し、以降の全テレメトリはその確定された Dataset Identity（`public_id`）にサーバー側で自動帰属（Attribution）させる** アーキテクチャを採用します。

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
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ 発行: Dataset Token (JWT)
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
│  (同一 ingest_item_id で raw body_hash 不一致は 409 Conflict で即時拒絶)          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Model & Security Guarantees（脅威モデルと保証境界）

### 2.1 防げる攻撃（Security Guarantees）
* **A. 他人の `member_id` を名乗る攻撃**:
  クライアントは送信ペイロードに `member_id` を含めず、サーバー側が `dataset_token` $\rightarrow$ `public_id` $\rightarrow$ `verified member_id` から決定するため、他人の `member_id` への付け替えは不可能です（Client cannot select or override the Dataset identity）。
* **B. 他人の Social Account になりすます攻撃**:
  Supabase Auth（OAuth）により認証されたユーザーと `public_id` が `web_user_member_map` でバインドされているため、クライアントが別ユーザーを自称しても無効です。
* **C. 未検証端末・別端末からの不正投稿**:
  `dataset_token` と `device_signature` の Dual Authentication および DB レベルの Nonce 消費チェックにより、公証を経ていない第三者端末からの投稿やリプレイは拒絶されます。
* **D. 事前登録攻撃（先回り登録）の無力化**:
  被害者がセッション開始時に `require_info` の TLSNotary 証明を提出することで、攻撃者の未検証端末をアトミックに Revoke し、所有権を正規オーナーへ奪還します。

### 2.2 防げない事項（Non-Guarantees）
* **Telemetry 内容の真正性**: 戦闘結果、ドロップ、資源、艦隊、装備等の内容自体が Game Server 由来であることは v1 では判定しません（UNTRUSTED payload）。
* **自端末の資格情報盗難時のデータ捏造**: 攻撃者がユーザー PC を完全支配して `Device A` の秘密鍵/トークンを窃取した場合、`Device A`（Dataset U1）として偽の戦闘データを送ることは防げません（TPM 等がない限り不可）。
  **ただしその場合でも、「登録済み Device / Dataset / Game Account の関係をクライアントが別の identity へ変更することを防ぐ」という保証は維持されます**。

---

## 3. Architecture Overview（身元連鎖とデータフロー）

### 3.1 完全な身元連鎖（Identity Chain）
```
[FUSOU-Prover ↔ 艦これ公式ゲームサーバー (MPC-TLS)]
         │
         │ (セッション最初の通信: POST /kcsapi/api_get_member/require_info)
         ▼
[TLSNotary Proof Verification]
         │
         │ verified api_member_id = 12345678
         ▼
[public.member_id_mapping] ──▶ server-derived public_id = UUID (Dataset U1)
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼                                                         ▼
[public.web_user_member_map]                              [public.user_devices]
   Social User A (OAuth)                                     Authorized Device A (Ed25519)
   (明示的バインディング操作)                                (One-Time Challenge 署名検証)
         │                                                         │
         └────────────────────────────┬────────────────────────────┘
                                      │
                                      ▼
                      [Dataset Token 発行 (JWT)]
                                      │
                                      │ Telemetry 送信 (Dual Auth + DB Nonce)
                                      ▼
                      [FUSOU-WEB Telemetry Ingest]
                         所属先: Dataset U1 (確定・提出時点 Immutable)
```

---

## 4. Identity Attestation Protocol (`api_get_member/require_info`)

### 4.1 セッション最初の 1 回の定義と再試行ポリシー
* **対象**: 1 つの Game Login Session において **最初に正常取得された `require_info` のみ** を Identity Attestation の対象とします。
* **セッション中の再試行**: 最初に成功した `require_info` のうち、TLSNotary-capable session で正常取得できたものを公証対象とします。同一 session 中に証明が成立していない場合は同一リクエストの再送を行わず、ゲームクライアント自身の自然な再試行が発生した場合のみ、新しい TLSNotary session として扱います。

### 4.2 MPC-TLS 処理 3 段階と Browser 待機の分離
コードレベルおよびアーキテクチャ上で処理パイプラインを以下の 3 段階に厳格分離します：

1. **Phase A (Request Routing / Upstream Connection)**:  
   ブラウザから受信したリクエストを検知し、Game Server への MPC-TLS 接続を確立。
2. **Phase B (MPC-TLS Response Acquisition)**:  
   Prover と Notary 間で MPC ハンドシェイクおよび共同復号を実行し、Response plaintext を取得。  
   > **注意**: この区間は Browser が待つ同期区間となります（**MPC-TLS response acquisition remains on the login API path**）。この追加遅延の許容範囲は Phase 0 PoC で実測検証します。
3. **Phase C (Presentation Generation & Verification & DB Claim)**:  
   バックグラウンドタスク（`tokio::spawn`）で Presentation を構築し、FUSOU-WEB での検証および DB Claim を実行。  
   > **原則**: この区間は Browser の待機条件から完全に除外されます（**Post-processing is not on critical path**）。

### 4.3 構造化 HTTP Parser & Trusted Server Identity Policy
* **構造化 HTTP Parser**: 正規表現による文字列検索を排し、構造化 HTTP パーサーにより `method === POST`, `path === /kcsapi/api_get_member/require_info`, `HTTP version === 1.1` を検証。
* **Trusted Server Identity Policy**: 単一のホスト名固定ではなく、TLS Certificate Chain、Expected DNS パターン（`*.kcs.dmm.com`）、および Allowed Hostname Policy に基づいて Game Server の真正性を検証。

### 4.4 Application-level Validation & 多段抽出
開示バイト範囲（Byte Range）：
* **Request**: `POST /kcsapi/api_get_member/require_info HTTP/1.1`, `Host: <trusted_game_host>`
* **Response**: `HTTP/1.1 200 OK`, `svdata={"api_result":1,"api_data":{"api_basic":{"api_member_id":<REVEALED>}}}`

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

## 5. Device ↔ Proof Binding & Social Account Linking

### 5.1 `ClaimBindingMessage` の厳密な Byte Layout と Canonical Serialization
曖昧さを排除するため、各フィールドのデータ型、エンコーディング、およびバイト列組み立てルールを以下のように完全固定します：

| フィールド名 | データ型 / エンコーディング | バイト長 | 説明 |
|---|---|---|---|
| `protocol_version` | ASCII string `"fusou-identity-v1"` | 17 bytes | プロトコル識別子 |
| `transcript_commitment` | Binary SHA-256 Digest | 32 bytes | TLSNotary Transcript Commitment |
| `verified_member_id` | UTF-8 decimal ASCII (例: `"12345678"`) | 1〜16 bytes | 検証済みゲームアカウント ID |
| `device_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | 提出端末の Device UUID |
| `expected_public_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー導出 Dataset UUID |
| `challenge_id` | Binary UUID (RFC 4122 Big-endian) | 16 bytes | サーバー発行 Challenge UUID |
| `challenge_nonce` | Binary Random Bytes | 32 bytes | サーバー発行 One-Time Nonce |

* **Length-Delimited Binary Framing**:
  各フィールドの直前に 2 バイトの Big-endian 長さヘッダー（`uint16_be(len)`）を付加して連結：
  $$\text{ClaimBindingBytes} = \text{u16}(17) \Vert \text{"fusou-identity-v1"} \Vert \text{u16}(32) \Vert \text{comm} \Vert \text{u16}(\text{len(mid)}) \Vert \text{mid} \Vert \text{u16}(16) \Vert \text{dev} \Vert \text{u16}(16) \Vert \text{pub} \Vert \text{u16}(16) \Vert \text{cid} \Vert \text{u16}(32) \Vert \text{nonce}$$
  $$\text{ClaimSignature} = \text{Ed25519\_Sign}(sk_{\text{device}}, \text{ClaimBindingBytes})$$

### 5.2 Server-issued One-Time Challenge の DB ライフサイクル
1. **Challenge 発行 (`issue`)**:  
   FUSOU-WEB は TLSNotary Presentation を検証し `verified_member_id` から `expected_public_id` を導出後、暗号論的乱数 `challenge_nonce` (32 bytes) を生成し `public.claim_challenges` に 5 分の有効期限（`expires_at = NOW() + INTERVAL '5 minutes'`）で INSERT。
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
   更新行数が 0 件の場合は `INVALID_OR_EXPIRED_CHALLENGE` として即座に拒絶。

### 5.3 Social Account Linking と Invariant 段階的成立
* **状態の段階的遷移**:
  1. `GAME_IDENTITY_VERIFIED`: TLSNotary Proof により `api_member_id` $\leftrightarrow$ `public_id` $\leftrightarrow$ `user_devices` が確定した状態。
     $$\text{member\_ownership.verified\_user\_id} \equiv \text{user\_devices.canonical\_user\_id} \equiv \text{user\_member\_map.user\_id} \quad (\text{Triple Invariant 成立})$$
  2. `SOCIAL_ACCOUNT_BOUND`: OAuth 認証済み Web ユーザーが明示的なバインディング操作を行い、`web_user_member_map` に登録された状態。
     $$\text{上記 3 者} \equiv \text{web\_user\_member\_map.user\_id} \quad (\text{Quad Invariant 成立})$$

### 5.4 Dataset Token の発行条件（Triple Verified Issuance）
Telemetry 投稿用 `dataset_token` は、**Game Identity Verified + Device Authorized + Social Account Bound** の 3 条件がすべて揃った時点で発行されます：
$$\text{require\_info verified} \longrightarrow \text{device claim accepted} \longrightarrow \text{social account bound} \longrightarrow \text{dataset\_token issued}$$

---

## 6. Telemetry Submission Protocol (Dual Auth: Token + Device Signature)

### 6.1 Telemetry Ingest 原則 & Immutable 帰属保証
> **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。`api_path` は informational metadata であり認可判断には使用しない。」**  
> **「DB に格納された Telemetry レコードの `(public_id, submitted_by_device_id)` は提出時点の事実として Immutable であり、将来のデバイス再バインドや所有者変更によって過去データが更新されることはない。」**

### 6.2 リクエスト仕様 & Idempotency / DB Nonce Retention
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

### 6.3 サーバー側処理パイプライン
1. `Authorization` ヘッダーから `dataset_token` を検証し `public_id` (U1) を抽出。
2. `X-FUSOU-Signature` を `user_devices.device_pubkey` で検証。
3. `telemetry_nonces` に `(device_id, nonce)` を消費記録（重複時は即座に遮断）。
4. `user_devices` が `is_verified = TRUE AND revoked_at IS NULL` であることを確認。
5. テレメトリレコードを **`public_id`（Dataset U1）の所有データとして INSERT**（Idempotency チェック適用）。

---

## 7. Rust Workspace クレート分割設計 & 命名整合

```
packages/
├── fusou-auth/               # DeviceKey / Ed25519 署名 / Token管理
├── fusou-proxy-core/         # Proxy ライフサイクル・HTTP 抽象化・UpstreamTransport Trait
├── fusou-proxy-hudsucker/    # 通常ゲーム通信用 MITM プロキシ実装 (低遅延最優先)
├── fusou-proxy-tlsn/         # require_info 専用 TLSNotary MPC-TLS Upstream トランスポート（PoC対象）
├── fusou-telemetry/          # 軽量テレメトリ キュー・SQLite 永続化・バッチ送信
└── FUSOU-APP/                # Composition Root (DI コンテナ)
```

> **命名リファクタリング**: `packages/FUSOU-WEB/src/server/utils/pepper.ts` は、設計意図（member_id pepper 廃止 / Device 認証ヘルパー）に合致するよう **`packages/FUSOU-WEB/src/server/utils/device-auth.ts`** へ改称・整理します。

---

## 8. Phase 0 PoC & GO/NO-GO Criteria（実測検証計画と判定基準）

### 8.1 検証項目
母港通信ではなく、**`POST /kcsapi/api_get_member/require_info`** 1 本に絞り、以下の検証を実施します：

1. FUSOU local proxy から Game Server への直接接続（Direct Connection）
2. FUSOU 自身が同一 logical request を二重送信しないこと（FUSOU-generated duplicate = 0）
3. TLSNotary Prover が `require_info` を正常に処理できること
4. MPC 復号遅延の実測と Browser 描画への影響測定
5. selective disclosure による `/api_data/api_basic/api_member_id` のみのピンポイント抽出
6. request path（`POST /kcsapi/api_get_member/require_info`）のサーバー側検証
7. Trusted Server Identity Policy によるサーバー真正性検証
8. Server-issued One-Time Challenge による `ClaimBindingMessage`（固定 Byte Layout）の署名検証
9. Presentation generation の正常完了
10. remote verification の動作確認
11. duplicate proof rejection の確認
12. Notary 障害時の通常 TLS 切替とログイン継続
13. Keep-Alive 接続の維持
14. FUSOU-WEB での canonical member_id 抽出成功
15. `dataset_token` 発行と Dual Auth + DB Nonce による Telemetry 送信の Attribution 一致確認

### 8.2 Phase 0 PASS / FAIL 判定基準 (GO Criteria)
以下の全条件を満たした場合にのみ、Phase 1（本番実装・マイグレーション）へ移行を承認します：

| 分類 | 必須条件 (MUST PASS) | 判定基準 |
|---|---|:---:|
| **プロトコル** | FUSOU 生成の二重送信ゼロ | FUSOU-generated duplicate = 0 |
| **暗号検証** | TLSNotary Proof 検証成功 | Notary 署名・Merkle Root 完全一致 |
| **データ抽出** | `api_member_id` の正確な抽出 | レスポンス平文と抽出値が 100% 一致 |
| **バインディング** | `ClaimBindingMessage` 偽造不能 | 他端末秘密鍵・別 Nonce での Claim を 100% 遮断 |
| **端末すり替え拒絶** | 検証済み Proof に対する別 Device 署名拒絶 | **Proof P (member 1234) + Device B 署名 $\rightarrow$ 403 拒絶** |
| **所属決定権** | クライアントによる Dataset 選択排除 | Payload 内の `public_id` 改変を完全無視 |
| **リプレイ防御** | DB Nonce & Idempotency 検証 | 同一 Nonce 拒絶、同一 ID 異 Body で 409 Conflict |
| **耐障害性** | 送信前 Notary 障害時のログイン継続 | 通常 TLS フォールバックでゲームプレイ 100% 継続 |
| **接続性** | 外部中継プロキシ排除 | クライアントローカルから直接接続維持 |
| **性能目標** | `require_info` MPC 復号追加遅延 | **P95 < 300ms**（実測値を記録・評価） |

---

## 9. FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)

Phase 0 PoC において以下の両構成をベンチマーク測定し、最終選定します：
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
  - ゲームログインは 100% 継続し、未検証状態を維持します。
* **Phase B（リクエスト送信後）**:
  リクエスト送信後に MPC session が失敗した場合、**同一リクエストの再送は厳格に禁止（BAN 回避 / FUSOU-generated duplicate = 0）**。
  - 状態: `UNATTESTED`
  - `MPC-TLS request sent -> Verifier failure -> NO automatic replay, NO second upstream request -> If plaintext already fully available: may return original response; else: cannot reconstruct response from TLS.`
  - Browser への継続可否は「Prover が既に取得済みの plaintext が存在するか」に依存します（Phase 0 で実測検証）。公証タスクのみ破棄し、次回以降の自然な再試行時に新しい TLSNotary session として扱います。

---

## 12. Security Progress Checklist（開発進捗チェックリスト）

- [D] ゲーム通信に外部プロキシを使用しない直接接続設計
- [D] FUSOU 生成の二重送信ゼロ（FUSOU-generated duplicate = 0）設計
- [D] MPC 復号遅延と Proof 後処理（非同期化）の 3 段階分離設計
- [D] `ClaimBindingBytes` の厳密な Byte Layout & Binary Framing 設計
- [D] Server-issued One-Time Challenge の DB 管理 & 単一消費ライフサイクル設計
- [D] `require_info` によるセッション最初 1 回限りの Identity Attestation 設計
- [D] Telemetry ペイロードからの所属識別子完全排除 & 提出時点 Immutable 帰属設計
- [D] Dual Authentication & `telemetry_nonces`（10分保持）による Replay Protection 設計
- [D] `member_id_hash` / Pepper 体系の完全削除と UUID `public_id` への一本化
- [D] Quad Invariant（$\text{verified\_user\_id} \equiv \text{canonical\_user\_id} \equiv \text{user\_id} \equiv \text{web\_user\_id}$）の段階的成立定義
- [D] 64-bit Advisory Lock & 親行ロック契約による並行実行競合排除設計
- [D] `member_ownership`（現在状態）と `member_ownership_claims`（監査履歴）の分離
- [D] 排他ロック取得後の Proof Consumption Policy（重複消費排除）設計
- [P] Phase 0 PoC（GO/NO-GO 基準付き実測検証 15 項目）
- [P] Verifier 実行環境ベンチマーク（Workers vs Dedicated Rust Verifier）
- [I] 実装および DB マイグレーション適用
- [T] 単体テスト・端末すり替え遮断テスト
