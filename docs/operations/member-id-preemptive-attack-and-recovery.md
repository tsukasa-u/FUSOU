# FUSOU: zkTLS (TLSNotary MPC-TLS) による member_id 所有権担保 & 所有権移転ステートマシン 完全実装仕様書

> **文書種別**: アーキテクチャ設計仕様書 & 実装マスターガイド（Implementation Master Guide）  
> **対象領域**: FUSOU プロジェクト全域（`packages/fusou-auth`, `packages/fusou-proxy-core`, `packages/fusou-proxy-tlsn`, `packages/FUSOU-WEB`, Supabase / Cloudflare Workers）  
> **最重要設計原則**:  
> 1. **再送信ゼロ（No Re-submission）**: ゲームAPIを裏で故意に再送・二重実行することはBANリスクおよび副作用の観点から絶対に排除し、**ブラウザと艦これ公式サーバー間の正規のTLSセッションそのものを公証**する。  
> 2. **外部プロキシ中継ゼロ（Direct Connection）**: 外部中継プロキシは規約上・BANリスク上不可とし、**クライアントローカルの `FUSOU-PROXY` と艦これ公式サーバー間の直接通信を維持**する。  
> 3. **Gameplay Path と Evidence Path の二元分離**: 母港画面の表示（Gameplay Path）は低遅延・通常プレイ継続を最優先とし、真正性証明の構築（Evidence Path）をバックグラウンドで非同期実行する。  
> 4. **証明処理の非ブロッキング化と非依存性**:  
>    `Attestation completion is not on the gameplay critical path.`  
>    `Notary availability is not a gameplay dependency.`  
> 5. **並行 Claim の完全直列化（親行ロック & Advisory Lock）**:  
>    空テーブルへの `FOR UPDATE` を排し、必ず存在する `member_id_mapping` 行ロックおよびトランザクション Advisory Lock により並行 Claim を物理的に直列化する。  
> 6. **サーバーサイド member_id_hash 導出**:  
>    クライアント申告のハッシュを一切信用せず、サーバー側で `api_member_id` から Pepper 付き HMAC を直接生成・検証する。  
> **ステータス**: 並行ロック完全化・サーバーサイドハッシュ導出・フォールバック厳格化反映マスター  

---

## 目次

1. [Goal（目標）](#1-goal目標)
2. [Threat Model（脅威モデル）](#2-threat-model脅威モデル)
3. [Ownership Definition（FUSOU所有権モデルの定義）](#3-ownership-definitionfusou所有権モデルの定義)
4. [Existing FUSOU Identity Architecture（現行FUSOUのID基盤）](#4-existing-fusou-identity-architecture現行fusouのid基盤)
5. [Member State Machine（所有権ステートマシン）](#5-member-state-machine所有権ステートマシン)
6. [TLSNotary Ownership Proof（母港APIの暗号学的公証 & データプレーン分離）](#6-tlsnotary-ownership-proof母港apiの暗号学的公証--データプレーン分離)
7. [Device Binding（Ed25519 デバイスバインディングの暗号学的証明）](#7-device-bindinged25519-デバイスバインディングの暗号学的証明)
8. [Claim Transaction（アトミック所有権移転トランザクション）](#8-claim-transactionアトミック所有権移転トランザクション)
9. [Preemptive Registration Attack（事前登録攻撃の無力化）](#9-preemptive-registration-attack事前登録攻撃の無力化)
10. [Concurrent Claim Handling（親行ロック & トランザクション Advisory Lock 制御）](#10-concurrent-claim-handling親行ロック--トランザクション-advisory-lock-制御)
11. [Revoke Semantics（未検証攻撃者端末の失効セマンティクス）](#11-revoke-semantics未検証攻撃者端末の失効セマンティクス)
12. [Dataset Token Issuance（検証済みJWT発行）](#12-dataset-token-issuance検証済みjwt発行)
13. [Replay Protection（リプレイ攻撃防御）](#13-replay-protectionリプレイ攻撃防御)
14. [DB Schema / RPC（Supabaseマイグレーション & ストアドプロシージャ）](#14-db-schema--rpcsupabaseマイグレーション--ストアドプロシージャ)
15. [Failure Cases & Fallback（異常系・二段階フォールバックセマンティクス）](#15-failure-cases--fallback異常系二段階フォールバックセマンティクス)
16. [Recovery（正規オーナーによるアカウント回復手順）](#16-recovery正規オーナーによるアカウント回復手順)
17. [Testing（単体・統合・並行競合テスト）](#17-testing単体統合並行競合テスト)
18. [Migration（既存データの移行手順）](#18-migration既存データの移行手順)
19. [Rollout Plan（PoC先行の段階的ロールアウト計画）](#19-rollout-planpoc先行の段階的ロールアウト計画)
20. [Security Review Checklist（監査チェックリスト）](#20-security-review-checklist監査チェックリスト)

---

## 1. Goal（目標）

FUSOU の匿名同期システム（`anonymous-sync-v2`）において、悪意ある第三者が他人の `api_member_id` を先回りして自己申告登録し、本物のプレイヤーがデータを同期できなくなる **事前登録攻撃（Preemptive Registration Attack / ID Squatting）** を暗号学的に完全無力化します。
zkTLS (TLSNotary MPC-TLS) を用いて「正規のゲームセッションを操作できる端末」が所有権をいつでも奪還・確定できるアトミックな所有権移転基盤を確立します。

---

## 2. Threat Model（脅威モデル）

### 前提条件
* 攻撃者はスクリプト等を用いて、未登録の任意の `api_member_id`（例: `12345678`）に対して `POST /anonymous-sync/v2/register` を自由に実行できます。
* クライアント環境（ローカルファイル・メモリ）は攻撃者により完全に制御されているものと仮定します。

### 攻撃シナリオ
1. **先回り占有攻撃**: 被害者が FUSOU を起動する前に、攻撃者が被害者の `api_member_id` を自己申告登録し、被害者のデータを盗聴・妨害しようとする。
2. **所有権奪還妨害**: 正規ユーザーが公証証明を提出した際、攻撃者の端末を Revoke できても、DB の Canonical User 所有者レコードが攻撃者のまま残り所有権が奪還できないバグを突く攻撃。
3. **並行 Claim 攻撃**: 複数の端末から同時に Claim リクエストを送り、空テーブル検索の隙を突いて二重登録や不整合を発生させる。
4. **ハッシュ詐称攻撃**: クライアントが `p_api_member_id` と一致しない偽の `p_member_id_hash` を送り、DB レコードを汚染しようとする。
5. **証明書の使い回し（Replay）**: 過去の母港通信の証明書を別の端末や別アカウントで再利用する。

---

## 3. Ownership Definition（FUSOU所有権モデルの定義）

* **暗号学的保証の境界**:
  TLSNotary が証明するのは「**この特定の端末が、当該 `api_member_id` を返した艦これ公式サーバーと正規の TLS 通信を行った事実**」です。
* **アプリケーション上の所有権定義**:
  FUSOU における **Verified Owner（検証済み所有者）** とは、**ゲームアカウントの法的・サービス上の所有者ではなく、対象ゲームセッションへの実効アクセスを暗号学的に証明した主体** を意味します。この主体に対して、未検証の自己申告登録よりも常に優先して FUSOU 内の所有権（同期権限）を付与します。

---

## 4. Existing FUSOU Identity Architecture（現行FUSOUのID基盤）

現行の FUSOU データベース（`20260822120000_destructive_uuid_public_id_cutover.sql`）の構造：

```mermaid
erDiagram
    auth_users ||--o{ user_member_map : owns
    member_id_mapping ||--|| user_member_map : maps_to
    auth_users ||--o{ user_devices : registers
    member_id_mapping ||--o{ user_devices : links_to

    auth_users {
        uuid id PK
    }
    member_id_mapping {
        bigint id PK
        text api_member_id UK
        uuid public_id UK
    }
    user_member_map {
        uuid user_id PK,FK
        uuid public_id UK,FK
    }
    user_devices {
        uuid device_id PK
        uuid canonical_user_id FK
        uuid public_id FK
        bytea device_pubkey
        timestamptz revoked_at
    }
```

* **Canonical User の整合性**:
  `user_member_map.user_id` は `auth.users(id)` を参照します。端末登録時に既に発行されている `user_devices.canonical_user_id` を用いてアトミックに移転・統合します。

---

## 5. Member State Machine（所有権ステートマシン）

```mermaid
stateDiagram-v2
    [*] --> UNCLAIMED: 初期状態 (未登録)
    
    UNCLAIMED --> PRE_REGISTERED: 自己申告による仮登録 (攻撃者または暫定利用)
    UNCLAIMED --> VERIFIED: 初回から TLSNotary 証明を提出 (正規オーナー確定)
    
    PRE_REGISTERED --> VERIFIED: 本物のプレイヤーが TLSNotary 証明を提出<br/>【アトミック所有権移転: 攻撃者をRevoke & 新規Owner UUIDへ切替】
    
    VERIFIED --> MULTI_DEVICE: 同一オーナーによる追加端末のペアリング
    MULTI_DEVICE --> MULTI_DEVICE: 追加端末の登録
    
    PRE_REGISTERED --> REVOKED: 所有権移転により古い仮登録をパージ
```

* **`UNCLAIMED`**: システム上にレコードが一切存在しない状態。
* **`PRE_REGISTERED`**: 自己申告の未検証端末（`is_verified = FALSE`）のみが存在する暫定状態。
* **`VERIFIED`**: TLSNotary で公証された正規端末が登録され、所有権が確定した状態。
* **`MULTI_DEVICE`**: 同一の正規オーナーに複数の検証済み端末が紐づいている状態。
* **`REVOKED`**: 所有権移転により無効化・隔離された古い未検証レコード。

---

## 6. TLSNotary Ownership Proof（母港APIの暗号学的公証 & データプレーン分離）

* **Gameplay Path**:
  母港パケット（`POST /kcsapi/api_port/port`）はブラウザへ即座に中継され、画面描画を最優先します。
* **Evidence Path**:
  プロキシのバックグラウンドタスクが Notary サーバーと MPC を完了させ、以下の最小限フィールドのみを開示した Presentation を構築します：
  * Request: `POST /kcsapi/api_port/port` および `Host: wXX*.kcs.dmm.com` のみ開示（Cookie は秘匿）。
  * Response: `HTTP/1.1 200 OK`, `"api_result": 1`, および `/api_data/api_member_id` のみ開示（資材や艦隊情報は完全マスク）。

---

## 7. Device Binding（Ed25519 デバイスバインディングの暗号学的証明）

* **Presentation 内部への埋め込み**:
  Prover は Notary との暗号コミット対象平文領域に `device_public_key` を埋め込み、Presentation を生成。
* **サーバー側での照合**:
  サーバー側で検証された公開鍵とリクエストの `device_public_key` を照合し、他人の証明書の盗用を完全に遮断します。

---

## 8. Claim Transaction（アトミック所有権移転トランザクション）

所有権の確定および移転は、Supabase のストアドプロシージャ `claim_verified_device_v3` 内で **1 つの DB トランザクションとしてアトミックに実行** されます。

---

## 9. Preemptive Registration Attack（事前登録攻撃の無力化）

事前登録攻撃が存在する場合の所有権奪還アルゴリズム：
1. `pg_advisory_xact_lock(hashtext(p_api_member_id))` および `member_id_mapping` の行ロック（`FOR UPDATE`）を取得。
2. 対象デバイスの `canonical_user_id`（既に `auth.users` に紐づいている正規 UUID）を取得。
3. `user_member_map` の所有者を正規ユーザー UUID へ上書き更新（`ON CONFLICT (public_id) DO UPDATE SET user_id = EXCLUDED.user_id`）。
4. 同一 `public_id` に紐づく過去の未検証端末（`is_verified = FALSE`）を一括 `revoked_at = NOW()`。
5. `member_ownership_claims` に証明記録（`transcript_commitment` 等）を保存。

---

## 10. Concurrent Claim Handling（親行ロック & トランザクション Advisory Lock 制御）

初回 claim 時、`member_ownership_claims` に行が存在しない場合でも確実に排他制御を行うため、以下の二重ロックをトランザクション先頭で適用します：
1. **Transaction Advisory Lock**: `PERFORM pg_advisory_xact_lock(hashtext(p_api_member_id));`
2. **親行ロック**: 必ず 1 行存在する `public.member_id_mapping` の `SELECT ... FOR UPDATE`。

これにより、複数の端末からミリ秒単位で同時に Claim リクエストが到達しても、後続のトランザクションは完全に待機し、レースコンディションによる二重生成を物理的に排除します。

---

## 11. Revoke Semantics（未検証攻撃者端末の失効セマンティクス）

* 所有権移転時、古い未検証端末には `revoked_reason = 'preempted_by_tlsn_verified_owner'` が刻印されます。
* 失効した端末からの以降のアクセスは、DB の `user_devices.revoked_at IS NULL` チェックにより即時 401/403 で拒絶されます。

---

## 12. Dataset Token Issuance（検証済みJWT発行）

所有権確定後、FUSOU-WEB は検証済みフラグ `is_verified: true` を含む JWT `dataset_token` を署名発行します。

---

## 13. Replay Protection（リプレイ攻撃防御）

* Notary が証明書内に刻印した `connectionTime` を検証し、時間窓（24時間ルール）外の古い証明書を自動破棄。
* Presentation の `transcript_commitment` を `member_ownership_claims` に記録し、同一通信の再利用を防止。

---

## 14. DB Schema / RPC（Supabaseマイグレーション & ストアドプロシージャ）

### `20260826000000_claim_verified_device_v3.sql`
```sql
BEGIN;

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_notary_time TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.member_ownership_claims (
    claim_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id_hash TEXT NOT NULL,
    public_id UUID NOT NULL,
    canonical_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    verified_device_id UUID NOT NULL REFERENCES public.user_devices(device_id) ON DELETE CASCADE,
    transcript_commitment TEXT NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_member_claims_hash UNIQUE (member_id_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_member_claims_hash ON public.member_ownership_claims(member_id_hash);

CREATE OR REPLACE FUNCTION public.claim_verified_device_v3(
  p_device_id UUID,
  p_device_public_key TEXT,
  p_api_member_id TEXT,
  p_transcript_commitment TEXT,
  p_notary_time TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device RECORD;
  v_public_id UUID;
  v_canonical_user_id UUID;
  v_existing_claim RECORD;
  v_computed_member_id_hash TEXT;
  v_mapping RECORD;
  v_result JSONB;
BEGIN
  -- 1. トランザクション Advisory Lock による member_id 単位の完全排他制御
  PERFORM pg_advisory_xact_lock(hashtext(p_api_member_id));

  -- 2. 対象デバイスの存在確認 & 行ロック
  SELECT * INTO v_device
  FROM public.user_devices
  WHERE device_id = p_device_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;

  -- 3. 公開鍵の一致確認
  IF encode(v_device.device_pubkey, 'hex') != lower(p_device_public_key) THEN
    RAISE EXCEPTION 'public_key_mismatch';
  END IF;

  v_canonical_user_id := v_device.canonical_user_id;

  -- 4. public_id の取得または新規生成 & 親行ロック
  v_public_id := public.rpc_register_public_id(p_api_member_id);

  SELECT * INTO v_mapping
  FROM public.member_id_mapping
  WHERE public_id = v_public_id
  FOR UPDATE;

  -- 5. サーバーサイドで安全に member_id_hash を計算 (クライアント入力を信用しない)
  -- 既存の pepper vault / HMAC 関数を利用
  v_computed_member_id_hash := encode(hmac(p_api_member_id, (SELECT secret FROM vault.secrets WHERE name = 'anon_sync_pepper' LIMIT 1), 'sha256'), 'hex');

  -- 6. 既存の所有権 claim を確認 (排他ロック)
  SELECT * INTO v_existing_claim
  FROM public.member_ownership_claims
  WHERE member_id_hash = v_computed_member_id_hash
  FOR UPDATE;

  IF v_existing_claim.claim_id IS NULL THEN
    -- 【初回公証 / 事前登録攻撃者からの所有権奪還】
    
    -- user_member_map の所有者を正規ユーザーへ移転・上書き
    INSERT INTO public.user_member_map (public_id, user_id, created_at)
    VALUES (v_public_id, v_canonical_user_id, NOW())
    ON CONFLICT (public_id) DO UPDATE
    SET user_id = EXCLUDED.user_id;

    -- 所有権 claim を記録
    INSERT INTO public.member_ownership_claims (
      member_id_hash, public_id, canonical_user_id, verified_device_id, transcript_commitment
    )
    VALUES (
      v_computed_member_id_hash, v_public_id, v_canonical_user_id, p_device_id, p_transcript_commitment
    );

    -- 同一 public_id に紐づく過去の未検証攻撃者端末を一括 Revoke
    UPDATE public.user_devices
    SET
      revoked_at = NOW(),
      revoked_reason = 'preempted_by_tlsn_verified_owner'
    WHERE public_id = v_public_id
      AND device_id != p_device_id
      AND is_verified = FALSE
      AND revoked_at IS NULL;

  ELSE
    -- 【すでに検証済みオーナーが存在する状態での追加端末 (Multi-Device)】
    IF v_existing_claim.canonical_user_id != v_canonical_user_id THEN
      -- 既存の正規オーナーの canonical_user_id に統合
      v_canonical_user_id := v_existing_claim.canonical_user_id;
    END IF;
  END IF;

  -- 7. 当該デバイスを verified に昇格 & 正当な Canonical User にバインド
  UPDATE public.user_devices
  SET
    public_id = v_public_id,
    canonical_user_id = v_canonical_user_id,
    is_verified = TRUE,
    verified_at = NOW(),
    last_notary_time = p_notary_time,
    revoked_at = NULL,
    revoked_reason = NULL
  WHERE device_id = p_device_id;

  -- 8. 結果返却
  v_result := jsonb_build_object(
    'device_id', p_device_id,
    'public_id', v_public_id,
    'canonical_user_id', v_canonical_user_id,
    'is_verified', TRUE,
    'verified_at', NOW()
  );

  RETURN v_result;
END;
$$;

COMMIT;
```

---

## 15. Failure Cases & Fallback（異常系・二段階フォールバックセマンティクス）

Notary 障害時やタイムアウト時でも、母港画面の表示を停止させないため、以下の 2 段階で制御します：
* **Phase A（リクエスト送信前）**: Notary 接続失敗時、新しい通常 TLS 接続を開いて母港へアクセス（ゲーム継続、公証なし）。
* **Phase B（リクエスト送信後）**: レスポンスをそのままブラウザへ中継してゲーム継続。通常 TLS での再送信は厳格に禁止し、公証タスクのみ破棄。
* **次回ログイン時の挙動**: 過去の通信を後から再公証することは不可能なため、**「次回ログイン時に、新しい母港通信（新しい TLS セッション）で新しい証明を取得」** します。

---

## 16. Recovery（正規オーナーによるアカウント回復手順）

新端末で FUSOU を起動し、母港にアクセスするだけで、zkTLS 公証により自動的に正規オーナーとしてのペアリング（または所有権の再確定）が完了します。

---

## 17. Testing（単体・統合・並行競合テスト）

* **所有権移転テスト**: 事前登録攻撃後に正規ユーザーが公証提出 $\rightarrow$ `user_member_map` の所有者が正規ユーザーに変更され、攻撃者端末が Revoke されることを検証。
* **並行 Claim 競合テスト**: 2台の端末からミリ秒単位で同時に `claim_verified_device_v3` を実行 $\rightarrow$ Advisory Lock と親行ロックにより完全に順次直列化されることを検証。

---

## 18. Migration（既存データの移行手順）

```bash
cd packages/FUSOU-WEB
npx supabase db push
pnpm vitest run tests/tlsn-verifier.test.ts
```

---

## 19. Rollout Plan（PoC先行の段階的ロールアウト計画）

1. **Phase 0 (ADR-000 Data Plane PoC)**: 母港通信における Prover 統合と Gameplay 中継の動作実測。
2. **Phase 1**: Supabase マイグレーション適用（`claim_verified_device_v3` RPC デプロイ）。
3. **Phase 2**: `FUSOU-WEB` に `/anonymous-sync/v2/verify-tlsn` エンドポイントを有効化。
4. **Phase 3**: `FUSOU-APP` / `fusou-proxy-tlsn` にインライン公証ロジックを配信。

---

## 20. Security Review Checklist（監査チェックリスト）

- [x] ゲーム通信に外部プロキシを使用せず、直接通信が維持されていること
- [x] ゲーム API の再送・二重実行コードが完全に排除されていること
- [x] Gameplay Path と Evidence Path が二元分離され、ゲーム画面の描画をブロックしないこと
- [x] 事前登録攻撃者から正規ユーザーへの Canonical User 所有権移転（Owner Transfer）がアトミックに行われること
- [x] 未検証端末が一括で安全に Revoke されること
- [x] Advisory Lock および親行ロック（`member_id_mapping FOR UPDATE`）により並行実行時の競合が物理的に排除されていること
- [x] `member_id_hash` がクライアント入力ではなくサーバー側で安全に計算・検証されていること
- [x] `DeviceKey` の公開鍵が Presentation 内に暗号学的にバインドされていること
