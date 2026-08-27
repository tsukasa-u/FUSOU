# FUSOU: Game Account Identity Attestation & Dataset Attribution 仕様書 (v1 Scope)

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-hudsucker`, `packages/fusou-proxy-tlsn`, `packages/fusou-telemetry`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers / Dedicated Verifier Service）  
> **v1 Core Security Goal**:  
> **「ゲームサーバーから暗号学的に検証した `api_member_id` を FUSOU Dataset Identity として確立し、その Dataset への Telemetry 提出を、クライアントが任意の別 member_id・別 Social Account・別 Dataset へ付け替えられないようにする（Dataset Attribution / Provenance 保証）」**  
> 対象 API: **`POST /kcsapi/api_get_member/require_info`**（ログイン時 1 回のみ）  
> 対象データ: **`/api_data/api_basic/api_member_id`**  
> **最重要設計原則**:  
> 1. **Identity Attestation と Telemetry Submission の完全分離**:  
>    - **① Identity Attestation（暗号学的保証）**: ログイン時の `require_info` を TLSNotary で 1 回だけ公証し、Game Account（`member_id`）$\rightarrow$ Dataset（`public_id`）$\rightarrow$ Social User（`web_user_member_map`）$\rightarrow$ Device（`user_devices`）の身元連鎖を確定する。  
>    - **② Telemetry Submission（内容は UNTRUSTED / 所属先 Dataset は TRUSTED）**: 戦闘等のテレメトリデータ自体は暗号公証せず、クライアントはリクエスト内に `member_id` を一切含めない。サーバーが `dataset_token` から所属先 Dataset を一意に決定し、他人の Dataset へのなりすまし・付け替えを物理的に排除する。  
> 2. **再送信ゼロ（No Re-submission）**: ログイン時の `require_info` を裏で二重実行・再送することは絶対に排除し、**実際のユーザーログイン時の 1 回限りの TLS 通信そのものを公証**する。  
> 3. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 4. **Gameplay Path の Proof 完了待ち完全排除**: `require_info` レスポンス平文を受信した時点でブラウザへ即座に中継し、公証タスクはバックグラウンドで非同期実行する。  
> 5. **テレメトリ内容証明（`canonical_event_id` 等）の v1 撤廃**: テレメトリ内容の完全性証明は v1 では行わないため、`canonical_event_id`, `response_hash` 等の複雑なテレメトリ証明体系は全廃し、`dataset_id`, `ingest_item_id`, `submitted_by_device_id` のみの軽量な構造とする。  
> **ステータス**: require_info 採用・Dataset Attribution 特化・テレメトリ証明分離マスター  

---

## 目次

1. [Goal & Concept (Identity Attestation と Dataset Attribution の分離)](#1-goal--concept-identity-attestation-と-dataset-attribution-の分離)
2. [Threat Model & Security Guarantees（脅威モデルと保証境界）](#2-threat-model--security-guarantees脅威モデルと保証境界)
3. [Architecture Overview（身元連鎖とデータフロー）](#3-architecture-overview身元連鎖とデータフロー)
4. [Identity Attestation Protocol (`api_get_member/require_info`)](#4-identity-attestation-protocol-api_get_memberrequire_info)
5. [Device Binding & Social Account Linking](#5-device-binding--social-account-linking)
6. [Telemetry Submission Protocol (No member_id in Payload)](#6-telemetry-submission-protocol-no-member_id-in-payload)
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

したがって、v1 では「戦闘データの中身が本物か」を毎戦闘ごとに重い MPC-TLS で公証する過剰設計を排し、**ログイン時の `require_info` で 1 回だけ強固に Game Account の身元（Identity）を暗号公証し、以降の全テレメトリはその確定された Dataset Identity にサーバー側で自動帰属（Attribution）させる** アーキテクチャを採用します。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ① Identity Attestation (ログイン時 1 回のみ / 暗号学的に保証)                    │
│                                                                                 │
│  Game Server (require_info) ──▶ TLSNotary ──▶ verified member_id = 1234         │
│                                                      │                          │
│                                                      ▼                          │
│                                              Dataset ID = U1                    │
│                                              ├── Social User A (OAuth)          │
│                                              └── Authorized Device A (Ed25519)  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ 発行: Dataset Token (JWT)
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ② Telemetry Submission (常時・軽量 / 内容は UNTRUSTED / 所属先 Dataset は TRUSTED)│
│                                                                                 │
│  Device A ──▶ POST /telemetry/upload (Bearer <dataset-token>) ──▶ FUSOU-WEB     │
│               ※ Payload に member_id は一切含めない                               │
│                                                                                 │
│  FUSOU-WEB が Token から Dataset U1 を確定し、U1 のデータとして DB 保存            │
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
  `dataset_token` は TLSNotary 公証を完了した正規端末（`user_devices`）にのみ発行されるため、公証を経ていない第三者端末からの投稿は拒絶されます。
* **D. 事前登録攻撃（先回り登録）の無力化**:
  被害者がログイン時に `require_info` の TLSNotary 証明を提出することで、攻撃者の未検証端末をアトミックに Revoke し、所有権を正規オーナーへ奪還します。

### 2.2 防げない事項（Non-Guarantees）
* **自端末の資格情報を盗まれた場合のデータ捏造**:
  攻撃者がユーザー PC を完全支配して `Device A` の秘密鍵/トークンを窃取した場合、`Device A`（Dataset U1）として偽の戦闘データを送ることは防げません（TPM 等がない限り不可）。
  **ただしその場合でも、攻撃者がデータを「他人の Dataset（Game Account 5678）」に付け替えることはできません**。

---

## 3. Architecture Overview（身元連鎖とデータフロー）

### 3.1 完全な身元連鎖（Identity Chain）
```
[艦これ公式ゲームサーバー]
         │
         │ (ログイン通信: POST /kcsapi/api_get_member/require_info)
         ▼
[TLSNotary MPC-TLS Prover]
         │
         │ verified api_member_id = 1234
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
                                      │ Telemetry 送信 (Authorization: Bearer <token>)
                                      ▼
                      [FUSOU-WEB Telemetry Ingest]
                         所属先: Dataset U1 (確定)
```

---

## 4. Identity Attestation Protocol (`api_get_member/require_info`)

### 4.1 なぜ `require_info` なのか？
FUSOU の現行実装において、`POST /kcsapi/api_get_member/require_info` はログイン直後に必ず 1 回実行され、以下のレスポンス構造を持ちます：
```json
{
  "api_result": 1,
  "api_data": {
    "api_basic": {
      "api_member_id": 12345678,
      "api_nickname": "提督名",
      ...
    }
  }
}
```
* 母港 API（`port`）のように出撃ごとに何度も呼ばれず、**ログイン時 1 回のみ** です。
* ペイロードサイズが小さく、Selective Disclosure による抽出が極めて高速・確定的です。

### 4.2 Selective Disclosure & サーバーサイドパース
開示バイト範囲（Byte Range）：
* **Request**: `POST /kcsapi/api_get_member/require_info HTTP/1.1`, `Host: wXX.kcs.dmm.com`
* **Response**: `HTTP/1.1 200 OK`, `svdata={"api_result":1,"api_data":{"api_basic":{"api_member_id":<REVEALED>}}}`

```typescript
// packages/FUSOU-WEB/src/server/utils/require_info_parser.ts

import { z } from 'zod';

const CanonicalRequireInfoSchema = z.object({
  api_path: z.literal('/kcsapi/api_get_member/require_info'),
  api_member_id: z.string().regex(/^[0-9]+$/),
});

export type CanonicalRequireInfoResult = z.infer<typeof CanonicalRequireInfoSchema>;

export function parseCanonicalRequireInfo(
  revealedReq: Uint8Array,
  revealedRecv: Uint8Array
): CanonicalRequireInfoResult {
  // 1. Request 平文から api_path を直接検証
  const reqStr = new TextDecoder().decode(revealedReq);
  const matchReq = reqStr.match(/^POST\s+(\/kcsapi\/api_[a-z0-9_]+(?:\/[a-z0-9_]+)?)\s+HTTP\/1\.[01]/m);
  if (!matchReq || matchReq[1] !== '/kcsapi/api_get_member/require_info') {
    throw new Error('invalid_or_unauthorized_request_path');
  }

  // 2. Response 平文から svdata を厳格検証し、api_member_id を抽出
  const recvStr = new TextDecoder().decode(revealedRecv);
  const headerEnd = recvStr.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('http_headers_malformed');

  const bodyStr = recvStr.slice(headerEnd + 4).trim();
  if (!bodyStr.startsWith('svdata=')) {
    throw new Error('svdata_prefix_missing_at_body_start');
  }

  const rawJson = JSON.parse(bodyStr.slice(7).trim());
  if (rawJson.api_result !== 1) throw new Error('api_result_not_ok');

  const rawMemberId = rawJson.api_data?.api_basic?.api_member_id;
  if (!rawMemberId) throw new Error('api_member_id_missing');

  return CanonicalRequireInfoSchema.parse({
    api_path: matchReq[1],
    api_member_id: String(rawMemberId),
  });
}
```

---

## 5. Device Binding & Social Account Linking

1. **Explicit Device Binding**:
   - クライアントは `require_info` の TLSNotary Presentation とともに、自身の `device_id` および `device_public_key` による署名を提出。
   - FUSOU-WEB はこれらをアトミックに照合し、ストアドプロシージャ `claim_verified_device_v3` を実行。
2. **Social Account Linking (`web_user_member_map`)**:
   - 認証済み Web ユーザー（OAuth）が存在する場合、`web_user_member_map` に `public_id` と `user_id` のマッピングを確立。
3. **Dataset Token の発行**:
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

## 6. Telemetry Submission Protocol (No member_id in Payload)

### 6.1 リクエスト仕様
テレメトリ送信時、クライアントは **`member_id` をペイロードに一切含めません**。

```http
POST /api/v1/telemetry/ingest HTTP/1.1
Host: api.fusou.dev
Authorization: Bearer <dataset-token>
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

### 6.2 サーバー側処理パイプライン
1. `Authorization` ヘッダーから `dataset_token` を検証。
2. トークン内の `public_id`（Dataset ID）および `sub`（`device_id`）を取得。
3. DB 上で `user_devices` が `is_verified = TRUE AND revoked_at IS NULL` であることを確認。
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
7. server name（`wXX*.kcs.dmm.com`）の検証
8. Device binding（Ed25519 署名とのアトミック照合）
9. Presentation generation の正常完了
10. remote verification の動作確認
11. duplicate proof rejection の確認
12. Notary 障害時の通常 TLS 切替とログイン継続
13. Keep-Alive 接続の維持
14. FUSOU-WEB での canonical member_id 抽出成功
15. `dataset_token` 発行と Telemetry 送信における Attribution 一致確認

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
- [D] `require_info` によるログイン時 1 回限りの Identity Attestation 設計
- [D] Telemetry ペイロードからの `member_id` 排除 & Dataset Attribution 設計
- [D] Trust Boundary Diagram および Security Authority（Verified Opening Bytes）の定義
- [D] `public_id`（UUIDv4）と `member_id_hash`（Pepper HMAC）の二重識別子モデル
- [D] 64-bit Advisory Lock & 親行ロック契約による並行実行競合排除設計
- [D] `member_ownership`（現在状態）と `member_ownership_claims`（監査履歴）の分離
- [D] 排他ロック取得後の Proof Consumption Policy（重複消費排除）設計
- [P] Phase 0 PoC（`require_info` 特化実測検証 15 項目）
- [P] Verifier 実行環境ベンチマーク（Workers vs Dedicated Rust Verifier）
- [I] 実装および DB マイグレーション適用
- [T] 単体テスト・Attribution 偽装遮断テスト
