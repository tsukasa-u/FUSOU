# FUSOU: Game Account Identity Attestation & Dataset Attribution 仕様書 (v1 Scope)

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-hudsucker`, `packages/fusou-proxy-tlsn`, `packages/fusou-telemetry`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers / Dedicated Verifier Service）  
> **v1 Core Security Goal**:  
> **「Game Server が返した `api_member_id` を暗号学的に検証し、それを FUSOU の Game Account Identity（`public_id`）として確立する。その後 FUSOU へ送信される任意の Telemetry が、クライアントによって別の Game Account / Dataset / Social Account へ付け替えられないようにする（Dataset Attribution / Provenance 保証）。」**  
> 対象 API: **`POST /kcsapi/api_get_member/require_info`**（1つの Game Login Session で最初に正常取得された 1 回のみ）  
> 対象データ: **`/api_data/api_basic/api_member_id`**（Wire: `i64`, Canonical Internal: Decimal String）  
> **最重要設計原則**:  
> 1. **Identity Attestation と Telemetry Submission の完全分離**:  
>    - **① Identity Attestation（暗号学的保証）**: ログインセッション開始時の最初の `require_info` を TLSNotary で 1 回だけ公証し、Game Account（`api_member_id`）$\rightarrow$ `member_id_mapping` $\rightarrow$ Dataset（`public_id`）$\rightarrow$ Social User（`web_user_member_map`）$\rightarrow$ Authorized Device（`user_devices`）の身元連鎖を確立する。  
>    - **② Telemetry Submission（内容は UNTRUSTED / 所属先 Dataset は TRUSTED）**: 戦闘等のテレメトリデータ自体は暗号公証せず、クライアントはリクエスト内に `member_id`, `public_id`, `dataset_id`, `owner user_id` などの所属識別子を一切含めない。  
> 2. **`member_id_hash` / Pepper の完全廃止（UUID `public_id` への一本化）**:  
>    `member_id_hash`、`anon_sync_pepper_runtime`、`anon_sync_pepper_versions`、Vault secret、Pepper rotation、HMAC 計算、hash version を**完全に廃止・削除**し、`public_id`（UUIDv4）を唯一の内部 Dataset Identity として使用する。  
> 3. **Telemetry Ingest における厳格な Attribution 決定権（Security Authority）**:  
>    **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential（Dataset Token + Device Signature）からのみサーバー側で導出する。」**  
> 4. **Dual Authentication（Dataset Token + Ed25519 Device Signature）**:  
>    Telemetry アップロード時は `Authorization: Bearer <dataset-token>` に加え、`X-FUSOU-Device-ID`, `X-FUSOU-Nonce`, `X-FUSOU-Timestamp`, `X-FUSOU-Signature`（Ed25519）を要求し、トークン単体盗用による別端末からの不正投稿を遮断する。  
> 5. **再送信ゼロ（No Re-submission）**: ゲーム API を裏で二重実行・再送することは絶対に排除し、**実際のユーザー操作による 1 回限りの TLS 通信そのものを公証**する。  
> 6. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 7. **Dataset Token の後発行（Post-Verification Issuance）**:  
>    `require_info proof verified` $\rightarrow$ `member_id verified` $\rightarrow$ `claim accepted` $\rightarrow$ `device authorized` $\rightarrow$ **`dataset_token issued`** の順序を厳守し、公証前の事前トークン発行は行わない。  
> **ステータス**: member_id_hash完全撤廃・require_info採用・Dataset Attribution特化マスター  

---

## 目次

1. [Goal & Concept (Identity Attestation と Dataset Attribution の分離)](#1-goal--concept-identity-attestation-と-dataset-attribution-の分離)
2. [Threat Model & Security Guarantees（脅威モデルと保証境界）](#2-threat-model--security-guarantees脅威モデルと保証境界)
3. [Architecture Overview（身元連鎖とデータフロー）](#3-architecture-overview身元連鎖とデータフロー)
4. [Identity Attestation Protocol (`api_get_member/require_info`)](#4-identity-attestation-protocol-api_get_memberrequire_info)
   - 4.1 [セッション最初の 1 回の定義と再試行ポリシー](#41-セッション最初の-1-回の定義と再試行ポリシー)
   - 4.2 [構造化 HTTP Parser & Trusted Server Identity Policy](#42-構造化-http-parser--trusted-server-identity-policy)
   - 4.3 [Selective Disclosure & サーバーサイド多段抽出](#43-selective-disclosure--サーバーサイド多段抽出)
5. [Device Binding & Social Account Linking](#5-device-binding--social-account-linking)
6. [Telemetry Submission Protocol (Dual Auth: Token + Device Signature)](#6-telemetry-submission-protocol-dual-auth-token--device-signature)
7. [Rust Workspace クレート分割設計](#7-rust-workspace-クレート分割設計)
8. [Phase 0 PoC（`require_info` 実測検証計画）](#8-phase-0-pocrequire_info-実測検証計画)
9. [FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)](#9-fusou-web-verifier-アーキテクチャ-workers-vs-dedicated-rust-verifier)
10. [DB Schema（Supabaseマイグレーション & RLS設計）](#10-db-schemasupabaseマイグレーション--rls設計)
11. [Failure Handling & Fallback Semantics](#11-failure-handling--fallback-semantics)
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
│  Game Server (require_info) ──▶ TLSNotary ──▶ verified api_member_id = 12345678 │
│                                                      │                          │
│                                                      ▼                          │
│                                              member_id_mapping                  │
│                                                      │                          │
│                                                      ▼                          │
│                                              Dataset ID = public_id (UUID-U1)   │
│                                              ├── Social User A (OAuth)          │
│                                              └── Authorized Device A (Ed25519)  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ 発行: Dataset Token (JWT)
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ② Telemetry Submission (常時・軽量 / 内容は UNTRUSTED / 所属先 Dataset は TRUSTED)│
│                                                                                 │
│  Device A ──▶ POST /telemetry/upload                                            │
│               - Authorization: Bearer <dataset-token>                           │
│               - X-FUSOU-Signature: Ed25519(...)                                 │
│               ※ Payload に member_id / public_id / dataset_id は一切含めない     │
│                                                                                 │
│  FUSOU-WEB が Credential から Dataset U1 を確定し、U1 のデータとして DB 保存       │
│  (クライアントが member_id を 5678 に改変して他人の Dataset に投稿することは不可能)│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Model & Security Guarantees（脅威モデルと保証境界）

### 2.1 防げる攻撃（Security Guarantees）
* **A. 他人の `member_id` を名乗る攻撃**:
  クライアントは送信ペイロードに `member_id` を含めず、サーバー側が `dataset_token` $\rightarrow$ `public_id` $\rightarrow$ `verified member_id` から決定するため、他人の `member_id` への付け替えは 100% 不可能です。
* **B. 他人の Social Account になりすます攻撃**:
  Supabase Auth（OAuth）により認証されたユーザーと `public_id` が `web_user_member_map` でバインドされているため、クライアントが別ユーザーを自称しても無効です。
* **C. 未検証端末・別端末からの不正投稿**:
  `dataset_token` と `device_signature` の Dual Authentication により、公証を経ていない第三者端末からの投稿は拒絶されます。
* **D. 事前登録攻撃（先回り登録）の無力化**:
  被害者がセッション開始時に `require_info` の TLSNotary 証明を提出することで、攻撃者の未検証端末をアトミックに Revoke し、所有権を正規オーナーへ奪還します。

### 2.2 防げない事項（Non-Guarantees）
* **Telemetry 内容の真正性**: 戦闘結果、ドロップ、資源、艦隊、装備等の内容自体が Game Server 由来であることは v1 では判定しません。
* **自端末の資格情報盗難時のデータ捏造**: 攻撃者がユーザー PC を完全支配して `Device A` の秘密鍵/トークンを窃取した場合、`Device A`（Dataset U1）として偽の戦闘データを送ることは防げません（TPM 等がない限り不可）。
  **ただしその場合でも、「登録済み Device / Dataset / Game Account の関係をクライアントが別の identity へ変更することを防ぐ」という保証は維持されます**。

---

## 3. Architecture Overview（身元連鎖とデータフロー）

### 3.1 完全な身元連鎖（Identity Chain）
```
[艦これ公式ゲームサーバー]
         │
         │ (セッション最初の通信: POST /kcsapi/api_get_member/require_info)
         ▼
[TLSNotary MPC-TLS Prover]
         │
         │ verified api_member_id = 12345678
         ▼
[public.member_id_mapping] ──▶ public_id = UUID (Dataset U1)
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼                                                         ▼
[public.web_user_member_map]                              [public.user_devices]
   Social User A (OAuth)                                     Authorized Device A (Ed25519)
         │                                                         │
         └────────────────────────────┬────────────────────────────┘
                                      │
                                      ▼
                      [Dataset Token 発行 (JWT)]
                                      │
                                      │ Telemetry 送信 (Dual Auth: Token + Signature)
                                      ▼
                      [FUSOU-WEB Telemetry Ingest]
                         所属先: Dataset U1 (確定)
```

---

## 4. Identity Attestation Protocol (`api_get_member/require_info`)

### 4.1 セッション最初の 1 回の定義と再試行ポリシー
* **対象**: 1 つの Game Login Session において **最初に正常取得された `require_info` のみ** を Identity Attestation の対象とします。
* **同一セッション内の再試行**: 通信エラー等で同一セッション内に追加取得された `require_info` は公証対象外（通常 TLS）とし、Replay 防止は `uq_member_claims_transcript` による Proof 消費ポリシーで担保します。

### 4.2 構造化 HTTP Parser & Trusted Server Identity Policy
* **構造化 HTTP Parser**: 正規表現による文字列検索を排し、構造化 HTTP パーサーにより `method === POST`, `path === /kcsapi/api_get_member/require_info`, `HTTP version === 1.1` を検証。
* **Trusted Server Identity Policy**: 単一のホスト名固定ではなく、TLS Certificate Chain、Expected DNS パターン（`*.kcs.dmm.com`）、および Allowed Hostname Policy に基づいて Game Server の真正性を検証。

### 4.3 Selective Disclosure & サーバーサイド多段抽出
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

## 5. Device Binding & Social Account Linking

1. **Explicit Device Binding**:
   - クライアントは `require_info` の TLSNotary Presentation とともに、自身の `device_id` および `device_public_key`（Ed25519）による署名を提出。
   - FUSOU-WEB はこれらをアトミックに照合し、ストアドプロシージャ `claim_verified_device_v3` を実行。
2. **Social Account Linking (`web_user_member_map`)**:
   - 認証済み Web ユーザー（OAuth）が存在する場合、`web_user_member_map` に `public_id` と `user_id` のマッピングを確立。
   - ※ Game Account へのアクセス証明 $\neq$ Social Account 所有権の証明 であることを明記。
3. **Dataset Token の後発行（Post-Verification Issuance）**:
   - 所有権確定後、FUSOU-WEB は以下の Claims を持つ署名済み JWT `dataset_token` を返却：
     ```json
     {
       "sub": "00000000-0000-4000-8000-000000000000", // device_id
       "public_id": "11111111-1111-4000-8000-111111111111", // Dataset U1
       "is_verified": true,
       "exp": 1756300000
     }
     ```

---

## 6. Telemetry Submission Protocol (Dual Auth: Token + Device Signature)

### 6.1 Telemetry Ingest 原則
> **「Telemetry ingest endpoint は、request payload に含まれる member_id、public_id、dataset_id 等の所属識別子を認証・認可判断に使用してはならない。Dataset identity は検証済み Credential からのみサーバー側で導出する。」**

### 6.2 リクエスト仕様 (Dual Auth)
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
  $$\text{SignDoc} = \text{POST} \mathbin{\Vert} \text{/api/v1/telemetry/ingest} \mathbin{\Vert} \text{Nonce} \mathbin{\Vert} \text{Timestamp} \mathbin{\Vert} \text{SHA256(BodyBytes)} \mathbin{\Vert} \text{public\_id}$$

### 6.3 サーバー側処理パイプライン
1. `Authorization` ヘッダーから `dataset_token` を検証し `public_id` (U1) を抽出。
2. `X-FUSOU-Signature` を `user_devices.device_pubkey` で検証。
3. `user_devices` が `is_verified = TRUE AND revoked_at IS NULL` であることを確認。
4. テレメトリレコードを **`public_id`（Dataset U1）の所有データとして直接 INSERT**。

---

## 7. Rust Workspace クレート分割設計

```
packages/
├── fusou-auth/               # DeviceKey / Ed25519 署名 / Token管理
├── fusou-proxy-core/         # Proxy ライフサイクル・HTTP 抽象化・UpstreamTransport Trait
├── fusou-proxy-hudsucker/    # 通常ゲーム通信用 MITM プロキシ実装 (低遅延最優先)
├── fusou-proxy-tlsn/         # require_info 専用 TLSNotary MPC-TLS Upstream トランスポート（PoC対象）
├── fusou-telemetry/          # 軽量テレメトリ キュー・SQLite 永続化・バッチ送信
└── FUSOU-APP/                # Composition Root (DI コンテナ)
```

---

## 8. Phase 0 PoC（`require_info` 実測検証計画）

母港通信ではなく、**`POST /kcsapi/api_get_member/require_info`** 1 本に絞り、以下の検証を実施します：

1. FUSOU local proxy から Game Server への直接接続（Direct Connection）
2. ログイン時の `require_info` が 1 回だけ送信されること（No Re-submission）
3. TLSNotary Prover が `require_info` を正常に処理できること
4. response 平文を Browser へ即座に返却し、ログイン画面描画をブロックしないこと
5. selective disclosure による `/api_data/api_basic/api_member_id` のみのピンポイント抽出
6. request path（`POST /kcsapi/api_get_member/require_info`）のサーバー側検証
7. Trusted Server Identity Policy によるサーバー真正性検証
8. Device binding（Ed25519 署名とのアトミック照合）
9. Presentation generation の正常完了
10. remote verification の動作確認
11. duplicate proof rejection の確認
12. Notary 障害時の通常 TLS 切替とログイン継続
13. Keep-Alive 接続の維持
14. FUSOU-WEB での canonical member_id 抽出成功
15. `dataset_token` 発行と Dual Auth（Token + Device Signature）による Telemetry 送信の Attribution 一致確認

---

## 9. FUSOU-WEB Verifier アーキテクチャ (Workers vs Dedicated Rust Verifier)

1. **Option A (Cloudflare Workers + WASM Verifier)**:
   Workers 内で `@tlsnotary/tlsn-js` または `tlsn-verifier-wasm` を直接実行。
2. **Option B (Dedicated Rust Verifier Service: 推奨フォールバック)**:
   `FUSOU-APP -> TLSNotary Verifier Service (Rust Native / Cloud Run / Fly.io) -> FUSOU-WEB (HMAC/署名付き認証チャネル) -> Supabase`。

---

## 10. DB Schema（Supabaseマイグレーション & RLS設計）

### `20260826010000_create_telemetry_attribution_tables.sql`
```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.telemetry_events (
    ingest_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL REFERENCES public.member_id_mapping(public_id) ON DELETE RESTRICT,
    submitted_by_device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE RESTRICT,
    api_path TEXT NOT NULL,
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

## 11. Failure Handling & Fallback Semantics

* **ログイン時 Notary 障害 (Phase A: 送信前)**:
  通常 TLS 接続を開き直して `require_info` を送信。ログインは 100% 継続し、所有権公証のみスキップ（未検証状態を維持）。
* **ログイン時 Notary 障害 (Phase B: 送信後)**:
  レスポンス平文をブラウザへ即座に中継してログイン完了。通常 TLS での再送は禁止し、公証タスクのみ破棄。次回ログイン時に新しい公証を取得。

---

## 12. Security Progress Checklist（開発進捗チェックリスト）

- [D] ゲーム通信に外部プロキシを使用しない直接接続設計
- [D] ゲーム API の再送信・二重実行コードの完全排除
- [D] `require_info` によるセッション最初 1 回限りの Identity Attestation 設計
- [D] Telemetry ペイロードからの所属識別子完全排除 & Dataset Attribution 設計
- [D] Dual Authentication（Dataset Token + Ed25519 Device Signature）設計
- [D] `member_id_hash` / Pepper 体系の完全削除と UUID `public_id` への一本化
- [D] Trust Boundary Diagram および Security Authority（Verified Opening Bytes）の定義
- [D] 64-bit Advisory Lock & 親行ロック契約による並行実行競合排除設計
- [D] `member_ownership`（現在状態）と `member_ownership_claims`（監査履歴）の分離
- [D] 排他ロック取得後の Proof Consumption Policy（重複消費排除）設計
- [P] Phase 0 PoC（`require_info` 特化実測検証 15 項目）
- [P] Verifier 実行環境ベンチマーク（Workers vs Dedicated Rust Verifier）
- [I] 実装および DB マイグレーション適用
- [T] 単体テスト・Attribution 偽装遮断テスト
