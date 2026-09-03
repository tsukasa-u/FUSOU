# FUSOU TLSNotary Game Identity Attestation v1 最終実装仕様書

> **規範性**: 本書だけを TLSNotary Game Identity Attestation v1 の実装判断に使用する。`trusted-battle-and-telemetry-ingestion.md` と `pepper-to-uuid-mapping-migration-security-plan-2026-08-20.md` は履歴資料であり、本書と競合する記述は無効である。
>
> **対象リポジトリ**: `FUSOU`
>
> **基準 branch / Reference Baseline**: `security-attestation-design` / `0d2a85a8c474271ecf6bf7e2cf062365a9608e83`
>
> **Specification Revision**: `7f847bb2285e95d9b8c310d9527b0fdce5d38622`
>
> **Revision note**: Reference Baseline は本仕様書が対象とする repository baseline であり、Specification Revision `7f847bb2285e95d9b8c310d9527b0fdce5d38622` は本仕様書の現在の設計変更を含む確定 commit である。runtime implementationは別途未作成であり、commit済み仕様と実装済み機能を同一視しない。今回のcross-specification auditはこの Specification Revision と Reference Baseline の差分を基準に行う。
>
> **再構築日**: 2026-09-01
>
> **実装状態**: `DESIGN ONLY`。現行 runtime は TLSNotary を実装していない。Phase 0 GO Gate を全件通過するまで `implemented`、`verified`、`tested`、`implementation ready` と扱わない。

本書の `MUST`、`MUST NOT`、`ONLY` は実装・migration・test の受入条件である。説明文、サンプル、旧文書、既存コードが本書と競合した場合は本書を正とする。ただし Phase 0 の実測結果が本書の固定条件を満たさない場合は実装を開始せず、本書の revision を上げて再監査する。

---

## 0. Repository Baseline と再構築結果

### 0.1 現行実装の事実

2026-08-31 時点の repository では次が成立する。

1. `packages/FUSOU-PROXY/proxy-https` は `hudsucker` による通常の HTTPS MITM proxy である。TLSNotary、MPC-TLS、Dedicated Verifier は存在しない。
2. `require_info` の DTO は `api_member_id: i64` であるが、APP の Identity は後続 `api_port/port` の `Set::Basic` を使用する。`require_info` 由来の Security Authority path は存在しない。
3. `packages/FUSOU-WEB/src/server/routes/anonymous-sync-v2.ts` は client 提出の `api_member_id` を `rpc_register_public_id` へ渡し、anonymous user と device を作成して Dataset Token を即時発行する。
4. 現行 `user_devices` に `device_status` はなく、`revoked_at IS NULL` だけで active を表す。
5. `member_ownership`、`member_identity_claims`、`claim_challenges`、`claim_verified_device_v1` は実 migration に存在しない。
6. 現行 `member_id_mapping.api_member_id` は `TEXT`、`user_devices.device_pubkey` は `BYTEA` である。
7. 現行 Dataset JWT は `sub = canonical_user_id`、別 claim `device_id`、HS256、7日 TTL である。本書の v1 credential と互換ではない。
8. TLSNotary revision、`Attestation.header().id` の canonical bytes と長さ、authenticated `notary_time`、Verifier Result serializer は repository 上で未実証である。

したがって、本書は現行実装の説明ではなく、現行実装を置換する target specification である。

### 0.2 再構築時に検出した issue

| Severity | 件数 | 主な内容 |
| --- | ---: | --- |
| P0 | 17 | 複数 master document、自己申告 path の未反映、未実証値を「実証済み」と記載、State Machine と DB の不一致、cross-user takeover の曖昧性、Claim idempotency 不足、RPC authority input 過多、lock order 逆転、Verifier binary 未定義、`notary_time` 欠落、Fresh DB 不成立、projection authority 化、JWT 不一致、No Re-submission 未実証、legacy route 稼働中 |
| P1 | 10 | Device transition constraint 不足、append-only DDL 不足、current schema の列名不一致、Composite FK query 未試験、legacy purge 順序不良、Social Binding 重複定義、range semantics 不足、partial transcript と strict parser の両立未定義、migration rollback 不足、mock-only test |
| P2 | 4 | 重複 paragraph、壊れた heading 番号、存在しない crate 名の既成事実化、設計項目を完了扱いする checklist |

初回再構築後のadversarial auditで追加のP0 6件、P1 18件、P2 1件を検出した。重複計上を避けたledgerは次である。

```text
Initial P0 I01..I17: normative-source, runtime-gap, client-authority,
state-schema, owner-conflict, claim-idempotency, RPC-authority, lock-order,
verifier-binary, authenticated-time, fresh-DB, projection-authority, JWT,
no-resubmission, legacy-route, atomic-migration, unsupported-fact claims

Follow-up P0 F01..F06: full-request binding, body-size algebra,
Result delivery, legacy-data epoch, existing-object owner/ACL, telemetry envelope

Initial P1 I01..I10: device transitions, append-only DDL, baseline column names,
composite-FK execution, purge order, Social Binding duplication, range semantics,
partial-transcript/parser mismatch, rollback, mock-only tests

Follow-up P1 F01..F18: key lifecycle, Challenge terminal semantics,
API precedence, replay response values, cookie ambiguity, Content-Length grammar,
UInt64 signature, cleanup RPC names, JWT registry, JWT rotation, pending revoke,
device reuse before quota, typed outcomes, replay corruption checks, legacy RLS,
SECURITY DEFINER path, reproducible evidence, Gate/deployment sequencing

Initial/follow-up P2 I01..I04/F01: duplicate prose, heading numbering, nonexistent package claim,
premature completion checklist, stale section reference

Extended P0 E01..E04: provider-realistic R2/binding identity,
accepted-Claim key-revocation propagation, omitted Turso epoch,
post-COMMIT unusable-schema rollback

Extended P1 E01..E11: registry serialization, raw Content-Length OWS,
Revoke lock order, revoke terminal reason, PENDING/Challenge expiry bound,
JWT pre-activation, normalized credential-header grammar, error precedence tests,
Verifier identity negatives, root-authority tests, telemetry route tests

Extended P2 E01..E02: stale storage Gate reference,
PostgreSQL primitive-evidence overclaim

Reaudit P0 R01..R09: Claim registry-status path, cross-device PENDING sweep,
mixed-registry compromise gate, direct-R2 envelope, manifest transitions/consumers,
fresh-resource manifest reuse, impossible exact Queue drain, Turso group credential,
generated SESSION omission

Reaudit P1 R01..R09: key tombstone contradiction, raw-header observability,
duplicate Host, Challenge outcome matrix, upload ledger/CAS, Queue redelivery dedupe,
Queue locator type, random R2 generation, P0-11 timing

Reaudit P2 R01..R04: stale already-claimed term, executor name,
pre-COMMIT wording, rollback heading

Final P1 C01..C10: JWT RETIRED lifecycle, CAS-derived received-at,
storage fingerprint algorithms, closed manifest inventory, Queue pause/consumer order,
database writer barrier, exact purge predicate, pre-COMMIT resource reuse boundary,
security/concurrency/recovery acceptance coverage, target Turso bootstrap source

Final P2 C01..C04: raw nonce decoding, stored Range cardinality,
bytewise registry ordering, measurable Gate terminology
```

TotalはP0 36件、P1 58件、P2 15件である。本書ではそれらの設計上の矛盾を解消した。現行runtimeとDBの実装gapはPhase 0/implementation taskとして残る。Phase 0でしか確定できない値は「決定待ち」ではなく、判定方法・成果物・失敗時動作を固定したGO Gateとした。

---

## 1. Goal、Guarantee、Non-Goal

### 1.1 Primary Security Goal

Game Server が返した次の response だけを Game Identity evidence とする。

```text
POST /kcsapi/api_get_member/require_info
response.api_data.api_basic.api_member_id
```

TLSNotary で Game Server provenance を検証し、Server-side で次を一つの検証可能な binding chain として確立する。

```text
verified api_member_id
  -> TLSNotary transcript
  -> server-issued Attestation Session
  -> authenticated non-anonymous canonical user
  -> authenticated device
  -> Identity Claim
  -> member_id_mapping
  -> public_id
  -> explicit social binding
  -> Dataset Token
  -> server-derived telemetry attribution
```

client が自己申告した偽の `api_member_id`、任意の `public_id`、任意の owner だけを根拠に Dataset を先取りする経路は 0 本でなければならない。初回 owner は、同じ Attestation Session に server-side で固定された authenticated non-anonymous Supabase user/device である。Verifier Result、Session、Challenge、Device、Claim のいずれかの binding が一致しない場合は受理してはならない。

### 1.2 v1 が保証すること

1. Accepted Identity Claim の `api_member_id` は、許可した Game Server の `require_info` response から得た値である。
2. TLS transcript は、server-issued Attestation Session の exact binding header を authenticated bytes として含む。
3. Attestation Session は、server-side で authenticated non-anonymous user、authenticated device、device public key、binding nonce、lifetime に固定される。
4. Verifier Result は Attestation Session ID、binding nonce、binding value、Game Server provenance、`require_info` evidence を同じ署名対象で証明する。
5. Claim は Session、Challenge、authenticated user/device、Verifier Result、device signature の全 authority 値を server-side に再構成して一致確認する。
6. `public_id` は Server-side の唯一の mapping function が割り当て、client は選択できない。
7. 同一 Attestation Session/Attestation は 1 件の accepted Identity Claim にしか使用できない。
8. 既存 verified owner と異なる user への自動 takeover は発生しない。
9. Dataset Token から `public_id` と `device_id` を決定し、Telemetry payload の identity field を認可に使用しない。

### 1.3 Scope 外

次は v1 で保証せず、新しい機構を追加しない。

1. Telemetry JSON、battle data、fleet data の内容が Game Server 由来であること。
2. Session binding を破らずに成立する Proof Copy Attack は v1 の保証対象外ではない。User A の Proof を User B の Session、Challenge、Device、Claim と組み合わせる試行は、Proof Copy Attack として必ず reject する。
3. TPM、Secure Enclave、kernel attestation。
4. anonymous account、pre-registration、client-authoritative ownership。
5. `member_id_hash`、Pepper、HMAC identity、旧 token upgrade。
6. Game client 自身が後刻生成する別の logical request、Proxy process crash 後に Game client が生成する別 request の重複判定。1 logical request に対する FUSOU-generated retry/replay の禁止は v1 scope 内である。
7. Cross-user transfer、manual recovery、Social unbind、盗難 device key/bearer credential の無効化以外の補償。
8. Game Account の法的・恒久的所有権。TLSNotary が証明するのは response provenance である。

Proof Copy Attack の拒否は v1 の MUST であり、Phase 0 の実験結果を待って scope 外へ戻してはならない。Device signature 単体が Proof Copy を防ぐのではなく、`Verifier Result <-> Attestation Session <-> authenticated user/device` の一致が防止の根拠である。

### 1.4 Proof Copy security requirement

次の組合せはすべて reject する。

```text
Proof(A) + User B
Proof(A) + Device B
Proof(A) + Challenge B
Proof(A, Session A) rewritten as Session B
```

`Verifier Result.attestation_session_id`、`Verifier Result.binding_nonce`、authenticated user/device、Challenge row、`user_devices` row、ClaimBindingBytes の各値は、同じ server-issued Session を指さなければならない。最初に Claim した actor を owner とする first-claim-wins semantics でこの検査を省略してはならない。

---

## 2. Authority と Identity Authorization Roots

### 2.1 Trust Boundary

```text
UNTRUSTED
  Browser / FUSOU-APP / local proxy process / local storage
       |
       | TLSNotary Presentation, Verifier Result, device signature
       v
TRUSTED CRYPTOGRAPHIC AUTHORITY
  Dedicated Verifier
  - TLSNotary proof verification
  - Web PKI and server identity verification
  - transcript authentication
  - signed Verifier Result generation
       |
       v
TRUSTED APPLICATION AUTHORITY
  FUSOU-WEB
  - Verifier Result signature verification
  - strict require_info parsing
  - non-anonymous Supabase Bearer verification
  - server-side Attestation Session issuance and binding validation
  - device signature verification
       |
       v
TRUSTED IDENTITY STORAGE
  PostgreSQL SECURITY DEFINER RPC
  - Session/Challenge binding, locking, state transition, owner conflict, replay prevention
```

Dedicated Verifier、FUSOU-WEB、PostgreSQL のいずれかの privileged runtime が侵害された場合、その authority が担当する保証は失われる。Client compromise と bearer token theft は防止しない。

### 2.2 唯一の Identity Authorization Roots

v1 で `Security Root` と呼ぶ場合の正規の意味は、Identity Authorization Roots の次の4 tableだけである。Attestation Session と Challenge は identity owner を決める root ではなく、accepted Claim の proof provenance と one-time protocol state を server-authoritatively 拘束する retained Protocol Coordination Records である。同じ `Security Root` という語を、この4 tableとSession/Challengeの両方の意味で使用してはならない。

1. `member_id_mapping`: verified `api_member_id` と immutable `public_id` の 1:1 mapping。
2. `member_identity_claims`: accepted Attestation と Claim の append-only audit。
3. `member_ownership`: historical owner、historical `primary_device_id`、Social Binding。
4. `user_devices`: current device state。

`user_member_map` と `web_user_member_map` は projection である。Security decision、owner conflict、token validation を projection から逆算してはならない。Upload ledger も Identity Authorization Root ではなく、single-use delivery の coordination record である。

Projection の更新方向は次だけである。

```text
member_ownership -> user_member_map -> web_user_member_map
```

### 2.3 Canonical Definitions

この表が v1 の唯一の用語定義である。後続章で現れる同名の値は、ここで定義した同じ値を参照する。`verified_member_id`は独立した第二のIDではなく、認証済み`require_info` responseからstrict parserが出力した`api_member_id`の処理段階名である。Raw wire token、canonical value、DB/API encodingを混同してはならない。

| Concept | Canonical definition | Type | Authority | Mutable / lifetime | DB representation | API representation |
| --- | --- | --- | --- | --- | --- | --- |
| `api_member_id` | `require_info` responseの`/api_data/api_basic/api_member_id`から得たcanonical member identifier | ASCII decimal string matching `[1-9][0-9]{0,15}` | Dedicated Verifier-authenticated response + FUSOU-WEB strict parser | Immutable after acceptance; retained with mapping/claim history | `member_id_mapping.api_member_id TEXT` | Never accepted from client; internal `TEXT` RPC value |
| `verified_member_id` | `api_member_id`と同一の値を、Verifier Result検証後からmapping投入まで呼ぶ処理上のalias | Same canonical ASCII decimal string; source wire form is a JSON Number token | FUSOU-WEB parser output, never client input | Immutable for the evidence lifetime | No separate column; copied to `api_member_id` | Challenge response field used for signing; never client-supplied authority |
| `public_id` | One server-generated stable identifier for one canonical member mapping | UUIDv4 | `member_id_mapping` and `get_or_create_public_id()` | Immutable; mapping lifetime | `member_id_mapping.public_id UUID` plus root FKs | Server response/token/envelope field; client may not choose it |
| `canonical_user_id` | Non-anonymous Supabase user that owns an accepted claim | UUID referencing `auth.users(id)` with `is_anonymous = false` | Authenticated Bearer plus ownership/claim roots | Immutable per ownership/claim row | UUID FKs in `member_ownership`, `user_devices`, `member_identity_claims` | Server-derived actor value; never accepted in client body |
| `device_id` | Server-created identifier for one registered device key | UUIDv4 | `user_devices` row and Challenge linkage | Immutable; row lifetime | `user_devices.device_id UUID PRIMARY KEY` | Returned only in server responses or supplied to actor-owned APIs after registration |
| `device_public_key` | Raw Ed25519 public key bound to `device_id` | Exactly 32 raw bytes | Device registration and `user_devices` root | Immutable; row lifetime | `user_devices.device_public_key BYTEA` with global UNIQUE | Strict unpadded base64url of 32 bytes where an API returns/accepts a registration key |
| `primary_device_id` | Historical pointer to the last accepted primary device for an ownership row | UUID FK to the same owner/public device | `member_ownership` history only | Mutable only on accepted same-owner Additional Device Claim; not authorization | `member_ownership.primary_device_id UUID` | May be returned as historical data; never a token/state authorization input |
| `tlsn_attestation_id` | Canonical bytes of `Attestation.header().id` from the pinned TLSNotary revision | Raw bytes of pending Phase 0 length `N` | TLSNotary Attestation and Verifier Result | Immutable; Challenge/Claim retention lifetime | `BYTEA` with `octet_length = N`, UNIQUE on Challenge/Claim | Strict unpadded base64url of exactly `N` bytes inside Verifier Result |
| `notary_time` | Notary-authenticated POSIX UTC whole seconds signed in the Attestation | UInt64 | Notary signature over the authenticated Attestation | Immutable evidence field | `public.fusou_uint64` | UInt64Decimal String in Verifier Result; never Game event time |
| `result_time` | POSIX UTC whole seconds read once by the Verifier after proof validation completes | UInt64 | Dedicated Verifier trusted clock | Immutable per Verifier Result | `public.fusou_uint64` | UInt64Decimal String in Verifier Result; distinct from `notary_time` |
| `Verifier Result` | Canonical JSON object carrying authenticated full transcripts/ranges, identity profile, Attestation Session binding fields, key IDs, times, attestation ID, and Verifier Ed25519 signature | UTF-8 canonical JSON bytes plus 64-byte Ed25519 signature | Dedicated Verifier after TLSNotary verification; user/device are derived from the Session, never client supplied | Immutable signed artifact; raw bytes are request-lifetime only | Raw JSON is not stored; Challenge/Claim authority subset, full SHA-256 digests, and Range metadata are copied | One exact `application/json` artifact; the same bytes may be retried to the Web API on network/5xx failure |
| `Attestation Session` | One server-issued proof-acquisition binding fixed before the TLSNotary request to one authenticated non-anonymous user and one authenticated device key | `session_id`, `canonical_user_id`, `device_id`, `device_public_key`, `binding_nonce`, `issued_at`, `expires_at`, and closed lifecycle status | FUSOU-WEB authenticated-device context plus PostgreSQL Session row; no client locator is authoritative | Immutable authority fields; `ACTIVE -> CONSUMED/EXPIRED/REVOKED` terminal lifecycle. A terminal Session is never reused; a new Session may reuse the same non-REVOKED device key under the retry rules in Section 7.1.1 | `attestation_sessions` row with unique `session_id`/`binding_nonce`, at most one ACTIVE row per device key, and terminal reason; retained terminal rows may share a device key/device ID | Client receives only an opaque server-generated binding value and expiry for transport relay; `session_id`, nonce, user, device, and key are not client authority inputs |
| `ClaimBindingBytes` | Canonical binary message reconstructed by FUSOU-WEB from Challenge authority fields and signed by the device key | Deterministic byte string defined in Section 7.3 | FUSOU-WEB serialization rules plus Challenge row; device signs but does not define fields | Immutable per Challenge; not persisted as raw bytes | No raw column; Challenge authority fields and accepted Claim fields are the source | Never client-supplied; device receives/derives the exact bytes for Ed25519 signing |
| `Challenge` | One server-issued, device-bound coordination record authorizing one Claim attempt | PostgreSQL row with `ACTIVE`, `CONSUMED`, or `EXPIRED` lifecycle | FUSOU-WEB verifier + PostgreSQL Challenge root for lifecycle | Authority columns immutable; lifecycle terminal; transient coordination with retained replay evidence | `claim_challenges` row, terminal reason/lifecycle checks, one UNIQUE `tlsn_attestation_id` | Server response exposes only defined authority/result fields; client submits only challenge ID and signature to Claim |
| `Claim` | Accepted binding of one Attestation, member mapping, canonical user, and verified device | PostgreSQL append-only identity fact | `member_identity_claims` root after atomic Claim RPC | Immutable; retained audit history | `member_identity_claims` append-only row | Server result only; client cannot submit authority columns |
| `Identity State` | Derived state of one `public_id`: `UNCLAIMED` if current VERIFIED devices = 0; `GAME_IDENTITY_VERIFIED` if an accepted Claim and Ownership exist, at least one current VERIFIED device belongs to that owner, and every current VERIFIED device belongs to that owner; `SOCIAL_ACCOUNT_BOUND` if the GAME condition plus matching Social Binding holds | Closed text set of three values; any other root combination is invariant corruption, not a fourth state | Root tables and live derived query, never projection/`primary_device_id` | Derived per read; no independent mutable state | No authoritative state column; RPC/API computes it | Exact closed text value in identity responses/token results |
| `Device State` | Lifecycle status of a registered device key | Closed text set `PENDING`, `VERIFIED`, `REVOKED` | `user_devices` plus transition trigger/RPC | `PENDING -> VERIFIED/REVOKED`, `VERIFIED -> REVOKED`; `REVOKED` terminal | `user_devices.device_status TEXT` with row-shape checks | Exact status in claim/revoke responses |
| `Ownership` | Historical canonical-user binding for one `public_id`, including optional Social Binding and historical primary pointer | One root row per `public_id` | `member_ownership` and authenticated actor checks | Canonical owner immutable; social is `NULL -> same owner`; history retained | `member_ownership` row | Server-derived response field; no client registration form |
| `Dataset Token` | Ed25519 compact JWS authorizing a live verified device/public dataset pair for upload | Exact v1 header/payload from Section 11.2; 3 segments | FUSOU-WEB issuer plus live roots and current Notary/Verifier registries | Signed for 86400 seconds; no refresh/upgrade; validation performs live lookup | No per-token authority row; key registry and roots are consulted each request | Response `dataset_token`; request credential only in `X-Dataset-Token` |
| `Upload Token` | Ed25519 compact JWS coordinating one single-use upload ledger row; never a Dataset credential | Exact v1 header/payload from Section 11.2; 3 segments | FUSOU-WEB issuer plus `dataset_upload_ledger_v1` CAS | Issued for one hour; consumed at most once; replay is rejected | Ledger row keyed by `ingest_id` with nonce/immutable fields and `consumed_at` | Response upload token; Stage 2 credential only in `X-Upload-Token` |
| `Telemetry Identity Envelope` | Server-derived attribution tuple `public_id`, `submitted_by_device_id`, `received_at` | Exact object with those three fields | Dataset JWT/live roots plus committed ledger `consumed_at` | Immutable per accepted ingest record; payload cannot alter it | Explicit columns in each target record/object wrapper; no client metadata merge | Internal Queue/storage envelope only; not accepted from request payload |
| `ingest_id` | Server-generated identifier for one Stage 1 upload ledger record and its downstream delivery | UUIDv4 | `dataset_upload_ledger_v1` | Immutable for the upload; retained through sink retries | `dataset_upload_ledger_v1.ingest_id UUID PRIMARY KEY` and sink unique keys | Returned by Stage 1; Stage 2 derives it from the validated Upload Token, not body |
| `consumed_at` | Actual successful Upload Token CAS consumption instant; millisecond precision is intentional so `received_at` records the committed consumption event while credential NumericDate fields remain whole seconds | `TIMESTAMPTZ`, persisted at millisecond precision with zero microsecond remainder | `consume_dataset_upload_v1` using transaction-wide `v_db_now` | Immutable after `NULL -> non-NULL`; retained with the ledger row lifetime | `dataset_upload_ledger_v1.consumed_at TIMESTAMPTZ NULL` with millisecond invariant CHECK | Internal consume result and source of `Telemetry Identity Envelope.received_at`; never client-supplied |
| `Route ID` | Closed server-selected identity for one dataset-bearing ingest endpoint | Exact text set `FLEET_SNAPSHOT`, `BATTLE_DATA_UPLOAD`, `QUEST_TREE_INGEST`, `REMODEL_DATA_INGEST`, `SHIP_GROWTH_INGEST`, `SOKU_SPEED_OBSERVED_INGEST` | Endpoint path, not client body | Immutable per ingest | `route_id TEXT` with explicit CHECK/unique sink key | Internal ledger/Queue/storage field; never a free-form client authority |

The canonical definition table intentionally distinguishes **identity authority** from **transport encoding**. A base64url field, JSON field, DB column, projection row, or client locator does not become authoritative merely because it carries the same bytes. Later sections may specify validation details, but may not redefine these concepts, types, owners, lifetimes, or representations.

Verifier Resultのraw canonical JSON bytesはChallenge/Claimのいずれにも保存しない。ChallengeはSection 9.6のimmutable authority fields、nonce、full transcript digests、Range metadataを保存し、ClaimはSection 9.5に列挙したaccepted identity-evidence subsetとfull digest/Range metadataをChallengeからcopyする。Challenge-onlyのnonce、lifecycle、expiry、device-public-key digestはClaim列ではなくlinked Challengeから復元する。

### 2.4 Protocol Consistency Matrix

各行の値はSection 2.3のcanonical definitionへの参照であり、別の型やauthorityを導入しない。`—`はそのwire formatに値を持たないことを意味する。Test列はtarget implementationで必須のfixture/test nameである。

| Concept | Canonical definition | JSON | Binary | DB | API | Test |
| --- | --- | --- | --- | --- | --- | --- |
| `api_member_id` | Section 2.3のcanonical member value | Authenticated responseのNumber token | ClaimBindingBytesのdecimal ASCII value | `TEXT` in mapping/claim roots | Internal `TEXT`; never client input | `require_info_number_token` |
| `Attestation Session` | Section 2.3のserver-issued user/device proof binding | Session is not client-authored JSON authority; binding is authenticated in request transcript and Result | Binding bytes include session ID and nonce as defined in Section 5.3 | `attestation_sessions` with immutable user/device/key fields | Session creation response exposes opaque binding only; Claim derives Session from Challenge | `attestation_session_binding_exact` |
| `verified_member_id` | `api_member_id`の処理段階alias | Not a second field; extracted from response | Same bytes as `api_member_id` | No separate column | Challenge response signing field; never client input | `verified_member_id_alias_identity` |
| `public_id` | Server-generated mapping UUID | UUID String where returned | ClaimBindingBytes RFC 4122 UUID bytes | `UUID` mapping/root FK | Server response/token/envelope | `mapping_returns_stable_public_id` |
| `canonical_user_id` | Non-anonymous authenticated owner | UUID String only in server result fields that specify it | Not a ClaimBindingBytes field; bound by Challenge actor | UUID auth FKs | Session-derived server value | `client_user_id_has_no_authority` |
| `device_id` | Server-created device UUID | Lowercase UUID String | `u16_be(16)` + network-order UUID bytes | `UUID` primary/FK | Challenge/claim/revoke result or actor-owned input | `device_id_binding_exact` |
| `device_public_key` | Raw 32-byte Ed25519 key | Strict unpadded base64url String | Not included in ClaimBindingBytes; loaded from DB for verification | `BYTEA` length 32, global UNIQUE | Registration input uses base64url; internal `get_claim_challenge_v1` may return DB `BYTEA` to FUSOU-WEB only | `device_key_encoding_exact` |
| `primary_device_id` | Historical ownership pointer | UUID String only when explicitly returned | — | Ownership UUID FK | Historical output only | `primary_device_not_authority` |
| `tlsn_attestation_id` | Pinned TLSNotary `Attestation.header().id` bytes | Strict unpadded base64url of `N` bytes | `u16_be(N)` + raw bytes | `BYTEA` length `N`, UNIQUE | Verifier Result/Challenge response encoding | `attestation_id_bytes_round_trip` |
| `notary_time` | Notary-authenticated POSIX UTC seconds | UInt64Decimal String | `u64_be` | `public.fusou_uint64` | Verifier Result field | `notary_time_authenticated_not_result_time` |
| `result_time` | Verifier trusted post-validation POSIX UTC seconds | UInt64Decimal String | `u64_be` | `public.fusou_uint64` | Verifier Result field | `result_time_is_verifier_clock` |
| `Verifier Result` | Signed canonical full-transcript result | Exact canonical JSON, signature included | Signature input excludes signature and follows Section 5.3 | Challenge/Claim authority subset, full SHA-256 digests, and Range metadata; raw JSON absent | `verifier_result_b64` in Challenge request | `verifier_result_golden_bytes` |
| `ClaimBindingBytes` | Server-defined device-signature preimage | Never accepted as JSON authority | Exact Section 7.3 byte sequence | Raw bytes absent; source fields copied | Client derives locally from Challenge response | `claim_binding_bytes_golden_hex` |
| `Challenge` | One device-bound Claim coordination row | Exact Challenge response fields | Its fields feed ClaimBindingBytes | `claim_challenges`, lifecycle, `terminal_reason` = `NULL`, `CLAIM_ACCEPTED`, `INVALID_SIGNATURE`, `DEVICE_REVOKED`, or `TTL_EXPIRED`, and unique constraints | Challenge API response; Claim request carries only ID/signature | `challenge_lifecycle_and_attestation_unique` |
| `Claim` | Accepted immutable identity fact | Claim API response only | Device signature authenticates binding | Append-only `member_identity_claims` | Server result; no authority fields in request | `claim_replay_full_authority_match` |
| `Identity State` | Root-derived three-value state | Exact closed String | — | Derived query; no state authority column | Identity/claim/revoke result | `identity_state_root_derivation` |
| `Device State` | Three-value device lifecycle | Exact closed String | — | `device_status TEXT` plus row checks | Claim/revoke result | `device_transition_matrix` |
| `Ownership` | Historical owner/social binding row | Server-derived response fields only | — | `member_ownership` root | Social binding result; never client registration authority | `ownership_conflict_and_social_binding` |
| `Dataset Token` | Ed25519 v1 compact JWS credential | Canonical JWS header/payload | JWS signing input is ASCII segment bytes | Registry + live roots; no token authority row | `dataset_token` / `X-Dataset-Token` | `dataset_token_live_revocation` |
| `Upload Token` | Ed25519 v1 single-use ledger credential | Canonical JWS header/payload | JWS signing input is ASCII segment bytes | Ledger keyed by `ingest_id` and CAS `consumed_at` | `upload_token` / `X-Upload-Token` | `upload_token_cas_replay` |
| `Telemetry Identity Envelope` | Server-derived `public_id`, device, committed time tuple | Exact Queue/R2 envelope object | — | Explicit sink columns/wrapper fields | Internal sink message only | `telemetry_envelope_cannot_be_spoofed` |
| `ingest_id` | Server-generated one-upload UUID | UUID String in Upload Token/Stage 1 result | — | Ledger PK and sink idempotency key | Returned Stage 1; Stage 2 derives from token | `ingest_id_server_generated` |
| `Route ID` | Six-value endpoint-derived closed ID | Not accepted from client payload | — | Explicit route CHECK | Internal ledger/Queue field | `cross_route_token_rejected` |

### 2.5 State ↔ DB Matrix

Identity State、Device State、Challenge Stateは別domainであり、同じ文字列を共有しない。各stateは次のDB条件とAPI意味に一対一で対応する。

| State | DB condition | API-visible meaning | Allowed transition | Enforcement / test |
| --- | --- | --- | --- | --- |
| `UNCLAIMED` | Target `public_id` has zero current `user_devices` rows with `device_status = 'VERIFIED'` | Identity has no currently verified device; history may remain | `GAME_IDENTITY_VERIFIED` when a Claim verifies a device | Root-derived query; `identity_state_unclaimed_after_revoke` |
| `GAME_IDENTITY_VERIFIED` | Accepted Claim and ownership exist, at least one current VERIFIED device belongs to that owner, and every current VERIFIED device belongs to that owner | Game identity is verified but Social Binding is absent | `UNCLAIMED` after last VERIFIED revoke; `SOCIAL_ACCOUNT_BOUND` after same-owner binding | Claim/revoke RPC and state query; `identity_state_verified_owner` |
| `SOCIAL_ACCOUNT_BOUND` | GAME condition plus `member_ownership.social_user_id = canonical_user_id` | Game identity and exact Google Social Binding are present | `UNCLAIMED` after all VERIFIED devices revoke; no unbind transition in v1 | Social binding RPC and state query; `social_state_requires_verified_device` |
| `PENDING` | `user_devices.device_status = 'PENDING'`, non-NULL future `pending_expires_at`, no verification/revoke fields | Device key is registered for one Claim attempt, not authorization | `VERIFIED` by accepted Claim; `REVOKED` by revoke or expiry | Device row CHECK/RPC; `pending_expiry_race` |
| `VERIFIED` | `device_status = 'VERIFIED'`, non-NULL `verified_at`, no revoke fields | Device can authorize live Dataset Token checks if all roots/key registries pass | `REVOKED` only | Transition trigger/Claim/Revoke; `verified_device_owner_invariant` |
| `REVOKED` | `device_status = 'REVOKED'`, non-NULL `revoked_at` and reason | Device can never authorize; historical rows remain | No automatic transition | Terminal trigger and live lookup; `revoked_device_rejected` |
| `ACTIVE Challenge` | `challenge_status = 'ACTIVE'`, all terminal timestamps/reason NULL, expiry future at use, linked Session is ACTIVE and unexpired, and linked device is PENDING and unexpired | One usable unconsumed device-bound Claim attempt | `CONSUMED` or `EXPIRED` | Attestation/device/Session row locks and lifecycle trigger; `active_challenge_unique` |
| `CONSUMED Challenge` | `challenge_status = 'CONSUMED'`, terminal reason is Claim accepted, invalid signature, or device revoke, `consumed_at` non-NULL | Attempt is permanently spent; accepted Claim replay may read it | No transition | Append-only authority + lifecycle trigger; `challenge_replay_rejected` |
| `EXPIRED Challenge` | `challenge_status = 'EXPIRED'`, reason `TTL_EXPIRED`, `expired_at` non-NULL | Attempt expired without Claim; it cannot be reused | No transition | Single DB timestamp and cleanup RPC; `expired_challenge_rejected` |
| `ACTIVE Attestation Session` | `session_status = 'ACTIVE'`, terminal timestamps/reason NULL, `expires_at > v_db_now` at use | Proof acquisition is bound to one authenticated user/device and may produce one Challenge | `CONSUMED`, `EXPIRED`, or `REVOKED` | Session issue/Claim/expiry/revoke RPC; `attestation_session_lifecycle` |
| `CONSUMED Attestation Session` | `session_status = 'CONSUMED'`, terminal reason `CLAIM_ACCEPTED` or `INVALID_SIGNATURE`, `consumed_at` non-NULL | Session has been used by one terminal Challenge/Claim path and cannot issue another Challenge | No transition | Session/Challenge atomic lifecycle update; `attestation_session_replay_rejected` |
| `EXPIRED Attestation Session` | `session_status = 'EXPIRED'`, reason `TTL_EXPIRED`, `expired_at` non-NULL | Binding is no longer valid; a new authenticated Session is required | No transition | Session expiry RPC; `expired_attestation_session_rejected` |
| `REVOKED Attestation Session` | `session_status = 'REVOKED'`, reason `DEVICE_REVOKED`, `revoked_at` non-NULL | Binding is invalid because its authenticated device was revoked | No transition | Revoke/session lock path; `revoked_attestation_session_rejected` |

`UNCLAIMED` is therefore not equivalent to “no history,” and `CONSUMED` is not equivalent to “accepted Claim”: the terminal reason and linked Claim decide the latter distinction.

### 2.6 Security Invariant Matrix

この表は各security invariantを一つのenforcement pathへ対応付ける。`Code`はtarget implementation surface、`DB`はdatabase enforcement、caller列は権限境界を示す。

| Invariant | Enforcement point | Code | DB | Allowed caller | Forbidden caller | Test |
| --- | --- | --- | --- | --- | --- | --- |
| Fake member ID has no authority | Strict authenticated response parser | `require_info` Number token parser; no client member argument | Mapping is written only by identity function | FUSOU-WEB service path with verified Result | Browser, APP, proxy, payload | `client_member_id_has_no_authority` |
| Proof is bound to authenticated submitter | Session issuance, transcript binding, and Claim revalidation | Session is created from authenticated user/device context; Result carries signed Session fields | Immutable Session fields and Challenge composite binding | Authenticated Session/Claim handler | Client-supplied session/user/device/member fields | `proof_copy_attack_rejected` |
| Session binding cannot be substituted | Verifier request-range validation and Result signature | Exact binding header must be authenticated in the same transcript | Session ID/nonce/value are immutable and cross-checked | Dedicated Verifier plus FUSOU-WEB | Modified Result, copied binding, alternate Challenge | `binding_substitution_rejected` |
| Fake public ID has no authority | Mapping creation | `get_or_create_public_id()` | Mapping parent UNIQUE/immutable trigger | Identity SECURITY DEFINER owner path | Client and direct application DML | `forged_public_id_rejected` |
| Cross-user takeover is rejected | Claim owner conflict | `claim_verified_device_v1()` | Immutable `member_ownership.canonical_user_id` + Identity lock | Same historical owner reclaim | Different authenticated user | `revoked_owner_cross_user_rejected` |
| Attestation replay is rejected | Challenge issuance and Claim | Attestation lookup before new Challenge | UNIQUE `tlsn_attestation_id` on Challenge/Claim | First valid lifecycle owner | Any second Challenge/Claim | `attestation_claim_race_one_winner` |
| Challenge replay is rejected | Claim/invalid-signature CAS | Lifecycle outcome mapping | Terminal Challenge trigger and row lock | Actor owning the active Challenge | Reuse after terminal state | `challenge_replay_rejected` |
| Claim race has one winner | Atomic Claim RPC | Ordered advisory/row locks | Unique Claim/Challenge FKs and append-only Claim | One valid actor/Challenge transaction | Concurrent duplicate mutation | `claim_race_one_winner` |
| Revoke race cannot resurrect a device | Revoke and Claim serialization | Identity lock plus transition check | Terminal device CHECK/trigger | Owning actor for that device | Stale actor or direct DML | `claim_revoke_race` |
| Projection tampering is non-authoritative | Every authorization lookup | Root-only repository query | Projection direct DML revoked; rebuild from ownership | Identity RPC owner projection writer | Client/application direct projection writer | `projection_not_authority` |
| Fallback cannot create identity | Pre-send fallback result handling | Send-state latch and fallback result mapper | No mapping/claim/token DML on fallback | Proxy transport fallback before send | Any fallback response parser or client | `fallback_identity_contamination` |
| No re-submission occurs | Upstream transport | One logical-request send latch; hidden retry disabled | No identity DB retry path | Proxy one write attempt, or one pre-send fallback attempt | Post-send fallback/retry/redirect | `post_send_failure_write_attempt_at_most_one` |
| Telemetry identity cannot be spoofed | Ingest validation and sink serialization | Reserved-field rejection + server envelope builder | Explicit identity columns, no payload merge | FUSOU-WEB/Queue sink writer | Client payload/metadata and direct DML | `telemetry_envelope_cannot_be_spoofed` |

---

## 3. Threat Model と Enforcement Matrix

| Threat | v1 判定 | Enforcement | 必須 test |
| --- | --- | --- | --- |
| client が偽 `api_member_id` を登録 | 防止 | client input を mapping RPC へ渡さない。signed Verifier Result の response bytes だけを parse | `client_member_id_has_no_authority` |
| client が任意 `public_id` を選択 | 防止 | `get_or_create_public_id()` only | `forged_public_id_rejected` |
| client が owner/device owner を選択 | 防止 | Supabase Bearer と Challenge row から復元 | `forged_owner_rejected` |
| 同一 Attestation の複数 Claim | 防止 | `UNIQUE(tlsn_attestation_id)` | `attestation_claim_race_one_winner` |
| Challenge replay | 防止 | ACTIVE の atomic consume | `challenge_replay_rejected` |
| invalid signature retry | 防止 | actor-bound `consume_invalid_challenge` | `invalid_signature_consumes_once` |
| User B が verified owner A を takeover | 防止 | `member_ownership.canonical_user_id` conflict | `cross_user_takeover_rejected` |
| 同一 user の追加 device | 許可 | same owner + new PENDING device | `same_user_additional_device_allowed` |
| 全 device revoked 後の別 user Claim | 防止 | historical ownership を保持し conflict | `revoked_owner_cross_user_rejected` |
| 全 device revoked 後の同一 user Claim | 許可 | same historical owner | `revoked_owner_same_user_reclaim_allowed` |
| `primary_device_id` が REVOKED | 認可しない | current `user_devices` を live lookup | `historical_primary_not_authority` |
| Projection 改ざん | 認可へ影響なし | roots only lookup | `projection_not_authority` |
| old Dataset Token replay | 防止 | exact v1 claims、new `kid`、`credential_version=1` | `legacy_token_rejected` |
| revoked device token | 防止 | request ごとに live DB state を確認 | `revoked_device_token_rejected` |
| payload の dataset substitution | 防止 | token/device roots から attribution | `payload_identity_fields_rejected` |
| post-send Notary/Verifier/DB failure | upstream replay なし | send-state latch | `post_send_failure_write_attempt_at_most_one` |
| copied genuine Verifier Result の先行使用 | 防止 | server-issued Attestation Session の user/device/key binding と transcript binding の再検証 | `proof_copy_attack_rejected` |
| Telemetry 内容改ざん | v1 非保証 | payload を UNTRUSTED として保存 | `telemetry_content_not_attested` |

---

## 4. Gameplay Path と No Re-submission

### 4.1 対象通信

Identity Attestation の対象は次だけである。

```text
Method: POST
Path: /kcsapi/api_get_member/require_info
Protocol: HTTP/1.1
Required injected header: X-FUSOU-Attestation-Binding
Redirect: forbidden
```

`api_port/port` その他の API を Identity Authority に使用してはならない。Proxy は Game client が自然に送信した `require_info` に server-issued binding header を一度だけ付加して処理し、Identity 用 request を新規生成してはならない。Binding がない request は通常 gameplay として扱い、Identity proof の入力にしてはならない。

過去の非決定的notebook観測では`api_start2/getData -> require_info -> api_port/port`の順とJSON Number tokenが見られたが、これはevidenceでもproduction invariantでもない。P0-04はsorted input manifest、各capture SHA-256、collector version、deterministic script、machine-readable reportを`docs/security/evidence/require-info-corpus-v1/`へcheck-inし、実Game clientで再実行して初めてPASSとする。Repository外path、未sort directory traversal、手集計件数をPASS根拠にしない。

### 4.2 Critical Path

```text
T-1 authenticated APP obtains one server-issued Attestation Session
T0 Proxy receives logical require_info request and one-shot binding value
T1 MPC-TLS session is ready
T2 exactly one upstream application request with the exact binding header is sent
T3 response plaintext is available and Browser response is sent
T4 TLSNotary finalization / Presentation generation
T5 Dedicated Verifier and FUSOU-WEB verification
T6 Challenge / Claim / Social Binding / Token issuance
```

Browser critical path に存在するのは T1-T3 の **MPC-TLS response acquisition** だけである。Session issuance はproof取得前の authenticated control operationであり、Presentation generation、Verifier post-processing、DB Claim、audit persistence、Social Binding、Dataset Token issuance は T3 後に実行する。

「証明処理による遅延ゼロ」と記載してはならない。MPC-TLS の追加遅延を Phase 0 で計測する。

### 4.3 Upstream Send State

1 logical request ごとに state を1つ持つ。

`SEND_COMMITTED` は Game Server 向け TLS stream への最初の write call を呼ぶ直前に不可逆に設定する。State 名と遷移は次に固定する。

```text
BEFORE_APPLICATION_SEND
  -> SEND_COMMITTED
  -> RESPONSE_AVAILABLE
  -> COMPLETE
```

1. `BEFORE_APPLICATION_SEND` で MPC setup が失敗した場合だけ通常 TLS へ切り替え、同じ logical request を1回送信する。
2. `SEND_COMMITTED` 以降は write call が0 byte、partial bytes、full bytesのいずれを送ったか判定できない場合を含め、retry、fallback send、redirect follow、connection replay を禁止する。
3. T2 後に response plaintext が得られた場合は元 response を Browser へ返し、Identity を `UNVERIFIED` とする。
4. T2 後に response plaintext が得られない場合は Browser へ transport error を返す。2回目を送ってはならない。
5. Verifier、FUSOU-WEB、DB の失敗は upstream request を発生させない。
6. HTTP client library の hidden retry を無効にする。無効化できない library は Identity transport に使用しない。

1 logical request に対する upstream write attempt は最大1回である。正常系と pre-send fallback 成功系では origin が完全な request を厳密に1回観測しなければならない。`SEND_COMMITTED` 後の process/connection failure では origin が観測する完全な request は0または1であり、0は availability failure として記録する。2以上は常に protocol violation である。

### 4.4 Fallback 結果

送信前 fallback の state と結果を次に固定する。

```text
PRE_SEND_MPC_FAILURE
  -> FALLBACK_ATTEMPTED
     -> GAMEPLAY_OK / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED
     -> TRANSPORT_ERROR / IDENTITY_UNVERIFIED / DATASET_TOKEN_NOT_ISSUED

MPC_RESPONSE_AVAILABLE
  -> ATTESTATION_PENDING
  -> no Result/Claim -> IDENTITY_UNVERIFIED (Identity State remains root-derived)
  -> Claim accepted -> computed GAME_IDENTITY_VERIFIED or SOCIAL_ACCOUNT_BOUND
```

Fallback は MPC session setup failure、Notary接続 failure、profile negotiation failure のうち `BEFORE_APPLICATION_SEND` で検出したものだけを対象とする。Redirect は follow せず Browser へ元 response を返し、Identity を拒否する。Fallback response から抽出した `api_member_id` を mapping、Claim、owner、token に使用してはならない。

ここでの`IDENTITY_UNVERIFIED`はtransport/processing resultであり、Section 2.3のIdentity Stateではない。Fallback、Result drop、Verifier failureのいずれでも、root-derived Identity Stateを`IDENTITY_UNVERIFIED`という別stateへ遷移させない。

### 4.5 Verifier Result delivery

Result deliveryは次の一本道に固定する。

```text
FUSOU-APP -> FUSOU-WEB Attestation Session API -> one-shot binding value -> Proxy
proxy-https -> Dedicated Verifier -> proxy-https -> in-process mpsc -> FUSOU-APP
FUSOU-APP -> FUSOU-WEB Challenge/Claim APIs
```

1. T3後、ProxyはTLSNotary Presentationを`POST /v1/verify/require-info`へ`Content-Type: application/octet-stream`、exact `Content-Length`、redirect/retry disabledで1回送る。Build-time embedded `packages/FUSOU-APP/src-tauri/security/tlsn-v1.json`はexact `{"profile_sha256":"<base64url-32>","verifier_origin":"https://<host>","version":1}`であり、path/query/fragment、wildcard host、non-443 portを許可しない。Production APP code signatureの対象とし、user configで上書きできない。Presentationのfull request revealはDedicated Verifierだけが受け取り、FUSOU-WEBへ転送しない。
2. Dedicated VerifierはSection 5.5を完了した場合だけ`200 application/json`でexact canonical signed Verifier Result bytesを返す。Failure bodyはopaque codeだけでtranscriptをechoしない。Proxyはresponse bodyを`MAX_VERIFIER_RESULT_JSON_BYTES`で打ち切る。
3. ProxyはResultをparse・再serializeせず、`packages/FUSOU-PROXY/proxy-https/src/channel_types.rs`の新variant `StatusInfo::IDENTITY_ATTESTATION { verifier_result: Vec<u8> }`として既存Proxy-log in-process mpscへ1回送る。Debug/Display/logにbytesを出さないcustom implementationを使う。
4. FUSOU-APPのsingle consumerはraw bytesのSHA-256でprocess-local deduplicationし、device Ed25519 keypairをOS credential storageから取得する。Result、member ID、Challenge nonce、device private keyをlog、event payload、WebView、filesystemへ出さない。
5. APPはproof acquisition前に`AuthManager::get_access_token()`相当で得たnon-anonymous Supabase Bearerとdevice public keyを使い、Section 7.1.1でAttestation Sessionを発行する。返されたopaque binding valueをProxyへone-shotで渡し、その後raw Resultをstrict unpadded base64urlへ一度だけencodeしてSection 7.2へ送る。Challenge responseを受けたらClaimBindingBytesを署名してSection 7.4へ送る。
6. FUSOU-WEB submissionのnetwork/5xxだけは同じouter request bytesで最大3回retryできる。Challenge/Claimのidempotency contractが収束を保証する。401/4xxはretryしない。RetryはGame originへのrequestを一切発生させない。
7. Queue full、APP未認証、Verifier failure、APP終了、retry exhaustionはResultをdropして`IDENTITY_UNVERIFIED`とする。次の自然な`require_info`だけが新しい試行機会であり、旧Game requestを生成・再送しない。

Dedicated Verifier responseは署名によりend-to-end認証されるため、Proxy/APPはcryptographic authorityではない。APPがChallenge APIへ送るexact bytesはVerifierが署名したcanonical Result bytesであり、中間層がJSON fieldを追加・削除・並替えしてはならない。

---

## 5. TLSNotary Profile と Verifier Result

### 5.1 Phase 0 で固定する profile

Phase 0は次のpublic canonical JSON artifactsとgolden fixturesを出力する。

```text
docs/security/tlsn-profile-v1.json
docs/security/tlsn-notary-keys-v1.json
docs/security/tlsn-verifier-keys-v1.json
docs/security/tlsn-game-servers-v1.json
packages/FUSOU-APP/src-tauri/security/tlsn-v1.json
```

1. TLSNotary repository URL と exact git commit。
2. Prover、Notary、Verifier crate version と feature set。
3. `Attestation.header().id` の canonical byte extraction API。
4. `tlsn_attestation_id` の固定 byte length `N`。
5. `notary_time` の authenticated source と seconds-since-Unix-epoch semantics。
6. Request/response transcript offset の基準。
7. One-request-per-MPC-session と T3 後 finalization の実証 fixture。
8. Notary trust anchors、Web PKI root snapshot、certificate revocation policy。

Profile IDはexact ASCII `fusou-require-info-v1`。Profile document自身は`profile_sha256` fieldを持たない。`profile_sha256`はprofile documentをRFC 8785 JSON Canonicalization Schemeで直列化したUTF-8 bytesのSHA-256 raw 32 bytesである。Notary/Verifier registryはRFC 8785 canonical JSONであり、exact schemaとproperty orderは次である。

```json
{"keys":[{"not_after":"1788307500","not_before":"1788134400","notary_key_id":"notary-2026-09","status":"ACTIVE","stop_signing_at":"1788220800","x":"<strict-unpadded-base64url-32-bytes>"}],"version":1}
```

```json
{"keys":[{"not_after":"1788307500","not_before":"1788134400","profile_sha256":"<strict-unpadded-base64url-32-bytes>","status":"ACTIVE","stop_signing_at":"1788220800","verifier_key_id":"verifier-2026-09","x":"<strict-unpadded-base64url-32-bytes>"}],"version":1}
```

Top-levelとentryのunknown/duplicate fieldを拒否する。`version`はJSON Number `1`、各時刻はUInt64Decimal String、`x`と`profile_sha256`はstrict unpadded base64url decoded 32 bytes、IDは`^[A-Za-z0-9._-]{1,64}$`である。Keysは対応IDのASCII bytewise lexicographic昇順、IDと`x`は各registry内でuniqueである。Statusは`ACTIVE | VERIFY_ONLY | RETIRED | REVOKED`、`not_before < stop_signing_at`、`stop_signing_at + 86700 <= not_after`である。Game Server registryはRFC 8785 canonical JSONのexact `{"servers":[...],"version":1}`、entryはexact lowercase `hostname`とinteger `port=443`だけ、hostnameのASCII bytewise lexicographic昇順、duplicate/wildcard/IP literalなしとする。全registry parserは再serialize bytes一致、golden bytes、unknown/duplicate/unsorted/noncanonical negative fixturesを共有する。

`REVOKED`はkey compromise用の不可逆・遡及失効であり、同じIDを再登録しない。FUSOU-WEBはChallenge issuanceとClaim署名検証前にChallengeのVerifier/Notary key ID、profile hash、result/notary timeをcurrent registriesへ照合する。どちらかがmissing/REVOKEDならClaimを`409 CHALLENGE_NOT_ACTIVE`として拒否する。新規ClaimはACTIVE/VERIFY_ONLYかつoriginal signing window内だけ受理し、accepted Claimのexact replayはRETIREDも受理する。

Normal rotationはnew key先行配布、signer切替、old VERIFY_ONLY、`stop_signing_at + 86700`以後かつACTIVE/unclaimed Challengeが0件でold RETIREDとする。Registryはappend-onlyであり、RETIRED/REVOKEDを含む全entryとpublic keyを永久tombstoneとして保持する。ID/`x`の削除・再利用を禁止する。

Accepted Claimのdevice認可はSection 11.2に従いcurrent registryで両key IDがmissing/REVOKEDでないことを毎回確認する。Compromise時はissuance/ingestを即時fail closedにし、registryをREVOKEDへ更新して全validatorへ配布する。これにより既発行Dataset Tokenも拒否する。Affected deviceの明示的revokeは監査・UI整合用に別途実行するが、完了をcredential拒否の前提にしてはならない。

Notary、Verifier、Dataset JWT registryのcanonical bytes SHA-256を`security_registry_set_sha256`としてimmutable release manifestへ記録する。各issuer/validator/Queue consumerは起動時に個別digestとset digestを照合し、不一致ならreadyにならない。Authenticated operator health inventoryはsecret/key bytesを返さず、deployment version IDと3 registry digestsだけを返す。

いずれかのkey compromiseでは次の順序をMUSTとする。

1. Application codeとは独立したedge maintenance ruleで全Identity、Dataset Token、6 ingest routesを503 blockし、全Queue producer/consumerとscheduled writerをpauseする。Old applicationがkill switchを認識することに依存してはならない。
2. Edge request count、Queue delivery count、全target store write countが0である観測windowを作る。
3. Compromised entryをREVOKEDにしたappend-only registriesをdeployし、active deployment/consumer inventoryの全instanceが同じrelease versionと`security_registry_set_sha256`を報告するまでblockを維持する。
4. Old deploymentへのtraffic/deliveryが0であることとrevoked-key negative fixtureをproduction canaryで確認する。Affected deviceの明示的revokeを開始する。
5. Consumers、ingest、token issuance、Identityの順に再開する。Inventoryを完全列挙できない、digestが混在する、または独立edge blockを実証できない場合はP0-16 FAILのまま再開しない。

`notary_time` は Notary が Attestation signature の対象に含める POSIX UTC whole seconds である。Leap second は POSIX time と同じく表現しない。Profile は signed field の exact API/path と extraction fixture を固定する。採用 revision が Notary-authenticated time を提供しない場合は P0-03 FAIL とする。`result_time` は Verifier が proof validation 完了後に trusted UTC clock から1回取得する POSIX UTC whole secondsであり、Game Server event timeではない。

Profile limits は次に固定する。

```text
MAX_VERIFIER_RESULT_JSON_BYTES = 25165824
MAX_REQUEST_TRANSCRIPT_BYTES = 512000
MAX_RESPONSE_TRANSCRIPT_BYTES = 16777216
MAX_HTTP_HEADER_BYTES = 65536
MAX_HTTP_HEADER_COUNT = 128
MAX_DECOMPRESSED_BODY_BYTES = 16777216
MAX_JSON_DEPTH = 64
MAX_GAME_JSON_STRING_BYTES = 1048576
MAX_VERIFIER_JSON_STRING_BYTES = 33554432
MAX_CHALLENGE_BODY_BYTES = 33558528
REQUEST_RANGE_COUNT = 3
RESPONSE_RANGE_COUNT = 1
```

`N` は Phase 0 実測値だけから決定する。たとえば実測値が32なら、protocol constant、DB `CHECK (octet_length(...) = 32)`、Rust type、TypeScript validator、fixture を同一 commit で32へ固定する。`N`、`TBD`、可変長 check を committed implementation に残してはならない。

### 5.2 Verifier Result Transport Representation

Content-Type は `application/json`、encoding は UTF-8、top-level field order は次に固定する。

```text
version
profile_id
profile_sha256
issuer
proof_purpose
attestation_session_id
binding_nonce
binding_value
verifier_key_id
notary_key_id
tlsn_attestation_id
server_identity
notary_time
result_time
request_transcript_size
request_transcript_sha256
response_transcript_size
response_transcript_sha256
revealed_request_ranges
revealed_response_ranges
signature
```

Transport type は次に固定する。

| Field | JSON representation |
| --- | --- |
| `version` | JSON Number `1` |
| `profile_id` | exact ASCII String `fusou-require-info-v1` |
| `profile_sha256` | strict unpadded base64url、decoded length = 32 |
| `issuer` | exact ASCII String `fusou-tlsn-verifier` |
| `proof_purpose` | exact ASCII String `GAME_ACCOUNT_IDENTITY_V1` |
| `attestation_session_id` | lowercase canonical UUIDv4 String; server-issued Session identifier extracted from the authenticated binding header |
| `binding_nonce` | strict unpadded base64url, decoded length = 32; exact nonce extracted from the authenticated binding header |
| `binding_value` | strict unpadded base64url of the canonical binding bytes; exact ASCII value of the authenticated `X-FUSOU-Attestation-Binding` header |
| `verifier_key_id` | ASCII String `^[A-Za-z0-9._-]{1,64}$` |
| `notary_key_id` | ASCII String `^[A-Za-z0-9._-]{1,64}$` |
| `tlsn_attestation_id` | strict unpadded base64url、decoded length = `N` |
| `server_identity` | lowercase ASCII DNS hostname。total 1..253 bytes、label 1..63 bytes、label は `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`、末尾 dot なし |
| `notary_time` | UInt64Decimal String |
| `result_time` | UInt64Decimal String |
| transcript sizes | UInt64Decimal String |
| transcript digests | strict unpadded base64url、decoded length = 32 |
| revealed ranges | Range array |
| `signature` | strict unpadded base64url、decoded length = 64 |

`UInt64Decimal` は `0|[1-9][0-9]{0,19}` とし、parse 後の値が `0..=18446744073709551615` に収まらなければ拒否する。

Range object の field order と type は次である。

```json
{"start":"0","length":"42","bytes":"<strict-base64url>"}
```

Canonical JSON は UTF-8、BOMなし、whitespaceなし、上記 field order、object field order固定、String内の非ASCII禁止、escape禁止である。Unknown field、duplicate key、padding付きbase64url、noncanonical decimal、Unicode escapeを拒否する。`Content-Type` は parameterなしの exact `application/json`。受信 bytes を strict parser で parseしてcanonical serializerで再生成し、元 bytes と byte-for-byte 一致しなければ拒否する。

### 5.3 VerifierResultSignBytes

Verifier Result の Ed25519 signature は JSON bytes ではなく、次の canonical binary に対して計算する。`signature` 自身は含めない。

```text
fixed ASCII bytes "FUSOU-VERIFIER-RESULT-V1\0"
u16_be(version)
u16_be(profile_id_byte_length) || profile_id ASCII bytes
u16_be(32) || profile_sha256 raw bytes
u16_be(issuer_byte_length) || issuer UTF-8 bytes
u16_be(proof_purpose_byte_length) || proof_purpose ASCII bytes
u16_be(16) || attestation_session_id RFC 4122 network-order UUID bytes
u16_be(32) || binding_nonce raw bytes
u16_be(binding_value_byte_length) || binding_value ASCII bytes
u16_be(verifier_key_id_byte_length) || verifier_key_id ASCII bytes
u16_be(notary_key_id_byte_length) || notary_key_id ASCII bytes
u16_be(N) || tlsn_attestation_id raw bytes
u16_be(server_identity_byte_length) || server_identity ASCII bytes
u64_be(notary_time)
u64_be(result_time)
u64_be(request_transcript_size)
u16_be(32) || request_transcript_sha256 raw bytes
u32_be(request_range_count)
  repeated in array order:
    u64_be(start) || u64_be(length) || u64_be(decoded_bytes_length) || raw bytes
u64_be(response_transcript_size)
u16_be(32) || response_transcript_sha256 raw bytes
u32_be(response_range_count)
  repeated in array order:
    u64_be(start) || u64_be(length) || u64_be(decoded_bytes_length) || raw bytes
```

Integer は unsigned big-endian fixed width である。String length は bytes 数であり character 数ではない。`u16_be(length)`へ入る全length（Attestation IDの`N`を含む）は65535以下でなければならず、overflowは拒否する。Array order は `start` 昇順である。第三者実装は同一 semantic value から同一 bytes を生成しなければならない。

`signature` は strict RFC 8032 pure Ed25519 で VerifierResultSignBytes を署名する。Verifier/Device 共通で canonical point encoding、`S < L`、identity point、small-order point、torsion component rejectionを必須とし、ZIP-215 permissive acceptanceを禁止する。

### 5.4 Range Validation

Request array と Response array は別 field であり、Range object に `direction` を追加してはならない。各 array に対して次を順番に検証する。

1. `start` と `length` を UInt64 として parse する。
2. `length > 0`。
3. `end = checked_add(start, length)`。overflow は拒否する。
4. `end <= corresponding transcript size`。
5. strict base64url decode 後の byte length が `length` と一致する。
6. `start` が strictly ascending。
7. 前 Range の `end <= next.start`。overlap は拒否する。

v1 `require_info` profile はさらに次を要求する。

1. TLSNotary Presentationはauthenticated sent transcript全体をDedicated Verifierだけへ開示する。Verifierは`MAX_REQUEST_TRANSCRIPT_BYTES`以下のbytesをsingle HTTP/1.1 requestとしてstrict parseし、request後のtrailing byteを拒否する。Request lineはexact `POST /kcsapi/api_get_member/require_info HTTP/1.1\r\n`、直後のfirst headerはexact `Host: <server_identity>\r\n`でport suffixを許可しない。Host fieldは全header中exactly 1件であり、異なるcaseを含む後続Hostを拒否する。Host lineの直後のsecond headerはexact `X-FUSOU-Attestation-Binding: <binding_value>\r\n`であり、header nameのcase variation、duplicate、OWS variation、別位置のbinding headerを拒否する。Header/body framingはSection 6.2と同じ規則を使い、responseと異なりbody length 0を要求する。
2. Verifier ResultのRequest range count = 3。Range 0は`start = 0`のexact request line、Range 1は`start = Range0.end`のexact Host line、Range 2は`start = Range1.end`のexact `X-FUSOU-Attestation-Binding: <binding_value>\r\n` lineである。Cookie、token、残りのrequest bytesはResultへ含めない。
3. Response range count = 1、`start = 0`、`length = response_transcript_size`。すなわちresponse HTTP/1.1 transcript全体をResultへ含める。
4. `request_transcript_sha256`と`response_transcript_sha256`はauthenticated full transcript raw bytesのSHA-256である。FUSOU-WEBはresponse digestをRange bytesから再計算し一致を要求する。
5. Dedicated VerifierとFUSOU-WEBはtranscript bytesをlog・DB・object storageへ保存しない。DBにはfull digestとRangeのstart、length、SHA-256 digestだけを保存する。
6. Request/response transcript size、range count、decoded bytes totalはProfile limits以下である。
7. ProxyはMPC-TLS sessionごとにapplication requestを1件だけ送信する。Dedicated Verifierはauthenticated sent transcriptのstrict parseによりrequest 1件、exact target、Host、binding header 1件、binding valueのcanonical encoding、trailing bytes不在を検証する。TLS server identityがSecurity Authorityであり、非開示header/body値はIdentity Authorityに使用しない。

Response 全体開示は partial transcript 上で JSON path と duplicate key absence を推測しないための v1 correctness rule である。Privacy review がこれを拒否する場合、Phase 0 は NO-GO とし、redaction-aware authenticated parser を protocol v2 として別設計する。

### 5.5 Verifier Validation Order

Dedicated Verifier は次を順番に実行する。

1. Profile ID、profile hash、protocol version、`proof_purpose`を照合。
2. TLSNotary Attestation、Notary signature、transcript commitment を検証。
3. Web PKI chain、SNI、certificate hostname、`server_identity` allowlist を検証。
4. Full request transcriptをstrict parseし、request target/Host/exact binding header/body/trailing-byte ruleとrequest digestを検証する。Binding headerからSession ID、binding nonce、binding valueを抽出する。
5. Resultへ出すRequest rangesをfull requestから切り出し、Range validationを実行する。
6. Response transcriptが単一HTTP/1.1 200 responseであること、response digest、Range validationを検証する。
7. authenticated `notary_time` を抽出し、`result_time` を1回取得する。`notary_time <= result_time` を要求する。
8. Notary key validityを`notary_time`で評価する。Notary keyはACTIVEかつ`not_before <= notary_time < stop_signing_at < not_after`、Verifier signing keyはACTIVEかつ`not_before <= result_time < stop_signing_at < not_after`でなければならない。これはproof signing時点のkey windowであり、後続のChallenge/replayのcurrent-registry判定とは別である。
9. Verifier Result を canonical serialize し、Verifier signing key で署名。

FUSOU-WEBはVerifier key registryから`verifier_key_id`を解決し、signature、profile hash、issuer、purpose、version、server allowlistを検証する。新規ChallengeではREVOKED/RETIRED keyを拒否し、ACTIVE/VERIFY_ONLY keyについて`not_before <= result_time < stop_signing_at`かつ`result_time < not_after`を要求する。Historical entryのretirementと永久tombstone保持はSection 5.1に従う。HTTPS transportだけでResultを受理してはならない。Verifier private keyとFUSOU-WEB secretを共有してはならない。

---

## 6. `require_info` Strict Lossless Parser

### 6.1 Input と output

Input は signature 検証済み Verifier Result の full response transcript bytes だけである。処理順は `HTTP framing -> dechunk -> decompress -> svdata prefix -> JSON tokenize`。Output は次である。

```text
verified_member_id: canonical decimal ASCII string
```

`JSON.parse()`、floating-point Number、Regex/substring による member ID 抽出を禁止する。

### 6.2 HTTP decoding

1. Transcript は `MAX_RESPONSE_TRANSCRIPT_BYTES` 以下で、exact `HTTP/1.1 200 OK\r\n` から始まる。1xx、複数response、HTTP/1.0/2、close-delimited body、response後のtrailing bytesを拒否する。
2. Header sectionは`MAX_HTTP_HEADER_BYTES`、`MAX_HTTP_HEADER_COUNT`以下。Header nameはRFC 9110 `token`、name比較はASCII case-insensitive。Line endingはCRLFだけ。obs-fold、NUL、control character、field-name前後のwhitespaceを拒否する。通常field valueは両端のSP/HTABだけをtrimし、内部control characterを拒否する。Framing fieldは次項に従ってraw field valueをtrim前に検査する。
3. Body framingは次の2つだけ。単一`Content-Length` raw field valueはSP/HTABを含まないexact ASCII `0|[1-9][0-9]{0,19}`、UInt64範囲内でbody byte数とexact一致する。`+`、leading zero、comma list、outer OWSを拒否する。単一`Transfer-Encoding` raw field valueはASCII case-insensitive exact `chunked`でContent-Length不在、chunk-sizeは1..16 ASCII hex digits、extension/trailer禁止、終端はexact `0\r\n\r\n`。両方不在・両方存在・duplicate framing field・他のtransfer codingを拒否する。
4. `Content-Encoding`は0または1 fieldで、trim後ASCII case-insensitive `identity`または`gzip`。gzipはsingle member、CRC/ISIZE valid、trailing bytesなし。decompressed bodyは`MAX_DECOMPRESSED_BODY_BYTES`以下。
5. Decoded Body は byte 0 から exact ASCII `svdata=` で始まる。prefix前後のwhitespaceを許可しない。
6. `svdata=` 後は UTF-8 JSON object 1個だけとし、BOM、末尾whitespace、末尾byteを許可しない。JSON depth/string sizeはProfile limits以下。

Phase 0 capture がこの framing set 外なら GO を出さず、本節を revision する。

### 6.3 JSON token rules

Streaming tokenizer はJSON escapeをdecodeしたUnicode scalar sequenceでkeyを比較し、すべての object でduplicate keyを拒否する。Unpaired surrogateとnon-shortest UTF-8を拒否する。Target pathのkeyにescapeを許可しない。次の path を構造的に辿る。

```text
/api_result
/api_data/api_basic/api_member_id
```

1. `/api_result` は JSON Number token `1`。
2. `/api_member_id` は quoted String ではなく JSON Number token。
3. token grammar は `[1-9][0-9]{0,15}`。leading zero、sign、decimal point、exponent、whitespace inside token を拒否する。
4. token bytes をそのまま `verified_member_id` とし、JavaScript Number を経由しない。
5. 各path segmentはexactly one object memberとして存在し、object以外のintermediate value、missing target、second occurrenceを拒否する。Target外のwell-formed JSON memberは無視する。

Wire type が live Phase 0 response で JSON Number でなければ GO は失敗する。String と Number の両対応実装を作ってはならない。

---

## 7. Identity API と Device Claim Protocol

### 7.1 Authentication 共通条件

全Identity APIはCloudflare Workers Fetch APIが公開する正規化後の`request.headers.get("Authorization")`だけを認証に使用する。Observable value grammarはcase-sensitive `Bearer`、exact SP 1 byte、non-empty Supabase compact access tokenであり、HTAB、comma、追加whitespace、schemeのcase variationを拒否する。Platformが公開前に除去するouter OWSや同値header foldingをApplicationが再判定できるとは仮定しない。複数fieldがcomma結合されればgrammar不一致として拒否する。この正規化契約は実Workerへraw HTTPを送るintegration fixtureで固定する。Cookie、query、bodyのcredentialを受け付けず、任意Cookieが同時に存在しても認証判断に使用しない。FUSOU-WEBと各mutation RPCの両方で`auth.users.is_anonymous = false`を確認する。Google identityはSection 11.1のexplicit Social Bindingでだけ要求し、Game Identity Claim自体はnon-anonymous Supabase userに結び付ける。Bearer APIにはcookie authorityがないためCSRF tokenを使用しない。

Client が送る locator は authority ではない。Server は Identity Authorization Root row と authenticated user を毎回照合する。

Identity APIのrequest `Content-Type`はparameterなしのexact `application/json`、`Content-Encoding`は不在でなければならない。Challenge body上限は`MAX_CHALLENGE_BODY_BYTES`、その他は4096 bytes。`MAX_CHALLENGE_BODY_BYTES = 4 * (MAX_VERIFIER_RESULT_JSON_BYTES / 3) + 4096 = 33558528`であり、24 MiBのdecoded Resultが3の倍数であることを利用する。`Content-Length`の有無にかかわらずstream読取り中に上限を強制し、超過は`413 REQUEST_TOO_LARGE`。UUID Stringはlowercase canonical hyphenated UUIDv4、base64urlはRFC 4648 unpadded canonical form、`expires_at`は`YYYY-MM-DDTHH:MM:SS.sssZ`に固定する。Unknown/duplicate JSON fieldを拒否する。

共通error評価順は`size 413 -> media/framing/outer JSON 400 -> authentication 401 -> resource ownership/not-found 404 -> expired 410 -> state/conflict 409 -> quota 429`。Challenge内のVerifier Result検証はauthentication後に行う。Web-side codeは`INVALID_REQUEST` 400、`INVALID_VERIFIER_RESULT` 400、`AUTHENTICATION_REQUIRED` 401、`INVALID_DEVICE_SIGNATURE` 401、`INVALID_DATASET_TOKEN` 401、`RESOURCE_NOT_FOUND` 404、`CHALLENGE_EXPIRED` 410、`IDENTITY_TRUST_REVOKED` 409、`REQUEST_TOO_LARGE` 413、`INTERNAL_ERROR` 500のclosed setである。DB outcome由来のHTTP codeはSection 10.5のclosed tableだけを使用し、HTTP error codeの全体集合はこのWeb-side setとDB outcome mappingのunionである。ほかのcodeを返してはならない。Error bodyは`{"error":{"code":"<UPPER_SNAKE_CASE>","request_id":"<uuidv4>"}}`の2 fieldsだけ、成功/errorとも`Cache-Control: no-store`と`X-Content-Type-Options: nosniff`を返す。内部DB error/detail、member ID、owner存在有無をerror textへ含めない。

#### 7.1.1 Pre-proof Attestation Session issuance

Proof acquisitionの前に、authenticated non-anonymous userが`POST /api/identity/v1/attestation-sessions`を1回呼ぶ。Request bodyは次の1 fieldだけである。

```json
{
  "device_public_key": "<strict-unpadded-base64url-32-bytes>"
}
```

このkeyはSessionに固定するdevice-key registration inputであり、member identity、`public_id`、Game Server responseのauthorityではない。FUSOU-WEBはBearerから`canonical_user_id`を得て、keyをstrict RFC 8032 profileでdecode/validateした後、service-only `issue_attestation_session_v1(authenticated_user_id, device_public_key)`を呼ぶ。Clientは`session_id`、`canonical_user_id`、`device_id`、`binding_nonce`をrequest authorityとして送らない。

Functionは次の値をserver-sideで生成する。

```text
session_id       = extensions.gen_random_uuid()
device_id        = extensions.gen_random_uuid()
binding_nonce    = CSPRNG 32 bytes
issued_at        = v_db_now
expires_at       = v_db_now + interval '5 minutes'
```

`binding_value`はDB columnではなく、次のcanonical bytesをstrict unpadded base64url encodeした派生値である。

```text
ASCII "FUSOU-ATTESTATION-BINDING-V1\0"
|| u16_be(16) || session_id RFC 4122 network-order bytes
|| u16_be(32) || binding_nonce raw bytes
```

Functionは`auth.users.is_anonymous = false`、public keyのstrict profile、UUIDv4、nonce uniqueness、`expires_at > issued_at`を検証する。既存の同じ key に ACTIVE Session があれば`DEVICE_KEY_ALREADY_REGISTERED`を返す。既存の `user_devices` row がある場合は、authenticated user と同じ owner の非REVOKED device に限り、その server-owned `device_id` を新しい Session に再利用する。別 user の device、REVOKED device、または不整合な key は`DEVICE_KEY_ALREADY_REGISTERED`を返す。`user_devices` row がない場合だけ新しい `device_id` を生成する。terminal Session row が存在しても、上記条件を満たす新しい Session の発行を妨げない。

同じ device key の再利用と同じ Session の再利用は別である。terminal Session は同じ `session_id`、nonce、binding を再利用できないが、同じ authenticated user に属する同じ non-REVOKED device key で新しい `session_id`、nonce、binding を発行できる。旧Sessionと新Sessionはともに保持し、新Sessionの `device_id` は既存deviceから復元する。REVOKED key、別userのkey、ACTIVE Sessionを持つkeyは再利用できない。新Sessionで同じdeviceに新しいChallengeを作れるのは、既存Challengeの lifecycle と device状態が Section 7.2 の条件を満たす場合だけであり、既存VERIFIED deviceを新しいClaimへ戻すことはない。

Session rowはproofの前にcommitされ、client responseは次の2 fieldsだけである。

Function内部の順序は、auth userの再検証、raw device keyによるDevice-key advisory lock、`v_db_now := pg_catalog.transaction_timestamp()`の取得、ACTIVE Session uniquenessとDevice key lifecycleの再検証、Session INSERT、canonical binding valueの導出、typed resultの返却とcommitである。auth userが存在しない、またはanonymousの場合は`RESOURCE_NOT_FOUND`を返し、non-OK resultではSessionを作成しない。Session INSERTとbinding value導出を同一transactionで完了してからHTTP responseへ進む。

```json
{
  "binding_value": "<strict-unpadded-base64url-canonical-binding-bytes>",
  "expires_at": "<RFC3339 UTC>"
}
```

APPはこのopaque binding valueをone-shot control messageとしてProxyへ渡す。Proxyは次の自然な`require_info` requestにだけ、exact ASCII header `X-FUSOU-Attestation-Binding: <binding_value>\r\n`を付加する。Binding value、Session ID、nonce、device keyをlog、Game request body、client event payloadへ出さない。Session issuance失敗、expiry、binding injection failureは通常gameplayを継続できるが、binding headerのないtranscriptをIdentity proofとして送ってはならない。

Session issuanceのsuccessは`201 OK_NEW`である。Sessionは一度だけproof acquisitionに使用され、同一Session/nonce/bindingの再発行、別user/deviceへの移し替え、別Challengeへの再利用を許可しない。Session terminal transitionはClaim accepted、invalid signature、Challenge/device revoke、またはTTL expiryと同一transactionで記録する。Session expiryまたはterminal state後の通常の再試行は、同じ authenticated user と同じ non-REVOKED device key に対する新しい Session issuance としてだけ許可し、旧Sessionを復活・更新してはならない。

`issue_attestation_session_v1`のtyped resultは次である。

```text
outcome, session_id UUID, device_id UUID, binding_nonce BYTEA,
binding_value TEXT, expires_at TIMESTAMPTZ
```

`OK_NEW`だけがSession fieldsを返し、`DEVICE_KEY_ALREADY_REGISTERED`とその他のnon-OK outcomeでは全result fieldsをNULLにする。FUSOU-WEBはこのinternal resultから`binding_value`と`expires_at`だけをHTTP responseへ出し、Session ID、device ID、nonceはclientへ返さない。

### 7.2 `POST /api/identity/v1/challenges`

Request body は次だけである。

```json
{
  "verifier_result_b64": "<base64url(exact canonical Verifier Result JSON bytes)>"
}
```

処理順序を固定する。

1. Outer body size、media type、strict JSON shapeを検証する。
2. Supabase Bearerを検証し、non-anonymous userを取得する。
3. `verifier_result_b64`をdecodeし、decoded length上限、canonical JSON、Verifier signature、profile、server identity、Attestation Session fields、transcript digests/ranges、`require_info` parserを検証する。Resultの`attestation_session_id`、`binding_nonce`、`binding_value`はrequest transcriptのauthenticated binding headerからVerifierが抽出した同じ値でなければならない。
4. `server_now_epoch`を1回取得する。`notary_time <= result_time <= server_now_epoch + 300`、`notary_time >= server_now_epoch - 86400`をBigIntで検証する。これはDB mutationを伴わない早期reject用のtransport preflightであり、`result_time`を`notary_time`の代用にしない。Acceptanceのauthoritative clockはRPC内で必要なlock取得後に再取得する`v_db_now`である。
5. ResultのSession ID、binding nonce、binding valueをstrict canonical formでdecode/validateする。Clientからdevice public keyやcanonical user/deviceを受け付けず、keyはSession rowから復元する。
6. `verifier_result_sha256 = SHA-256(decoded canonical JSON bytes including signature)`と各revealed Range digestを計算する。Full response digestはfull response Rangeから再計算する。Full requestはWebへ開示されないが、Resultのsafe binding rangeと署名済み`binding_value`のformatを検証する。
7. service-only `issue_identity_challenge_v1(...)` を1回呼ぶ。HTTP handlerからIdentity tableへ個別DMLを発行せず、Session/user/device authorityをResultやbodyから個別に保存しない。

`issue_identity_challenge_v1` の入力はFUSOU-WEBが検証・正規化した次の値である。

```text
p_authenticated_user_id UUID
p_attestation_session_id UUID
p_binding_nonce BYTEA
p_binding_value TEXT
p_api_member_id TEXT
p_tlsn_attestation_id BYTEA
p_notary_time public.fusou_uint64
p_result_time public.fusou_uint64
p_profile_sha256 BYTEA
p_server_identity TEXT
p_verifier_key_id TEXT
p_notary_key_id TEXT
p_verifier_result_sha256 BYTEA
p_request_transcript_sha256 BYTEA
p_response_transcript_sha256 BYTEA
p_request_ranges JSONB
p_response_ranges JSONB
```

Functionは`auth.users`の該当rowが存在し`is_anonymous = false`であることを再検証する。入力metadataはclient inputではなくtrusted FUSOU-WEB resultであり、functionは`service_role`だけが実行できる。`service_role` grant自体はNotary/Verifier registryを検証しないため、supported callerはregistry照合を完了したFUSOU-WEB server-side handlerだけとする。Client、PostgRESTの公開経路、任意の直接SQL caller、registry照合を経ない`service_role` direct RPC invocationはこのcontract外であり、production caller inventoryとcode reviewで拒否する。

Function内部の順序は次である。

1. Input shape、literal Attestation length `N`、frozen profile hash/server allowlist、digest length、Range metadata shapeを検証する。Expiryの比較とlifecycle timestampの生成はlock取得後に行う。
2. Attestation advisory lockを取得。
3. Identity advisory lockを取得。
4. User quota advisory lockを取得。
5. Device-key advisory lockを取得し、必要なlockをすべて取得した後ここで`v_db_now := pg_catalog.transaction_timestamp()`を一度だけ取得する。`notary_time <= result_time <= v_db_now + 300`、`notary_time >= v_db_now - 86400`を再確認する。HTTP handlerの`server_now_epoch`はこの判定を代用しない。
6. Session rowを`FOR UPDATE`し、`session_id`、`canonical_user_id`、`device_id`、`device_public_key`、`binding_nonce`、`issued_at`、`expires_at`、`session_status`を再構成する。Authenticated user、ResultのSession fields、canonical binding bytesがすべて一致し、ACTIVEかつ`expires_at > v_db_now`でなければ、`SESSION_NOT_ACTIVE`を返す。ACTIVE Sessionの expiry が過ぎている場合は、同Sessionに紐づくACTIVE Challengeがあればそれも`EXPIRED/TTL_EXPIRED`へ遷移してから返す。
7. `get_or_create_public_id(p_api_member_id)`を呼び、mapping parent rowを`FOR UPDATE`。Device-key lock取得後のnon-locking lookupで、Sessionのdevice ID/keyに対応するcandidate `device_id`があれば取得する。
8. 同AttestationのChallenge、同SessionのChallenge、candidate deviceの全ACTIVE Challengeのunionを`challenge_id`昇順で`FOR UPDATE`する。Lock後に全集合を再queryし、未lock rowがあればinvariant errorとしてabortする。
9. 同Attestationの期限切れACTIVE、または linked Session/device pending expiry により使用不能になったACTIVE Challengeを`EXPIRED/TTL_EXPIRED`へ遷移し、対応Sessionも`EXPIRED/TTL_EXPIRED`へ遷移する。このexpiry normalization後にACTIVE Challengeをlookupする。SessionがREVOKEDの場合はChallengeをusableなACTIVEのまま残さず、revoke pathの`DEVICE_REVOKED` terminal reasonを要求する。
10. ACTIVE rowがあり、Session、user、device key digest、Verifier Result digest、binding nonce/valueが一致し、deviceが同じuser/publicの未期限PENDINGなら同じChallengeを返す。不一致なら`ATTESTATION_IN_USE`。
11. ACTIVE rowがない場合だけ、同Attestationのaccepted Claim、CONSUMED row、EXPIRED rowを順に確認する。accepted Claimは`ATTESTATION_ALREADY_CLAIMED`、CONSUMED rowは`ATTESTATION_ALREADY_USED`、EXPIRED rowは`CHALLENGE_EXPIRED`、terminal/expired/revoked Sessionは`SESSION_NOT_ACTIVE`とし、いずれも新Challengeを作らない。
12. Ownership rowを`FOR UPDATE`し、different userなら`EXISTING_VERIFIED_OWNER_CONFLICT`。
13. Sessionのdevice ID/keyに対応するcandidate deviceだけを`FOR UPDATE`する。期限切れPENDINGなら`REVOKED/expired_pending`へ、そのlock済みACTIVE ChallengeとSessionを`EXPIRED/TTL_EXPIRED`へ遷移する。その後はexisting REVOKED keyとして`DEVICE_KEY_ALREADY_REGISTERED`を返す。
14. Candidateが同じuser/publicの未期限PENDINGなら再利用し、それ以外のexisting keyは`DEVICE_KEY_ALREADY_REGISTERED`。Candidateに別のACTIVE Challengeがあれば`DEVICE_CHALLENGE_IN_USE`。新規device rowを作る場合はSessionの`device_id`と`device_public_key`をそのまま使用し、client keyを再入力しない。
15. Deviceが新規の場合だけ、同じUser-quota/Identity advisory lockを保持したまま`v_db_now`を使用し、`device_status='PENDING' AND pending_expires_at > v_db_now`のrowをactor user全体とpublic ID全体でcountする。count、limit判定、PENDING row INSERTは同一transaction/lock区間で完了し、別pathがこのlock protocol外でPENDINGを作成・遷移してはならない。count対象rowを個別にlockする必要はない。いずれかが5以上なら`PENDING_DEVICE_LIMIT`、未満ならSessionのdevice ID/keyと`v_db_now + interval '24 hours'`でPENDING rowを作る。
16. 同Attestationのrowが存在しない場合だけ、Server-generated UUIDv4、32-byte nonce、`expires_at = LEAST(v_db_now + interval '5 minutes', attestation_session.expires_at, device.pending_expires_at)`でChallengeを作る。ChallengeのSession ID、nonce、binding valueはSessionからcopyする。Sessionがexpiry済み、REVOKED、または同じtransaction内でexpiry normalizationされた場合はChallengeを作らず`SESSION_NOT_ACTIVE`を返す。
17. Session、Challenge、device、Result authorityのcross-table equalityをassertし、Typed resultを返してcommitする。

Challenge issuanceは無関係なPENDING deviceをsweep/lock/updateしない。Expiry mutationはsupplied keyのcandidate device、Claim対象device、またはSection 10.5のsingle-Challenge cleanupだけに限定し、各pathが対応User-quota/Device-key lockを取得する。

Response body は次である。

```json
{
  "attestation_session_id": "<uuidv4>",
  "binding_nonce": "<strict-base64url-32-bytes>",
  "binding_value": "<strict-base64url-canonical-binding-bytes>",
  "challenge_id": "<uuidv4>",
  "challenge_nonce": "<strict-base64url-32-bytes>",
  "expires_at": "<RFC3339 UTC>",
  "device_id": "<uuidv4>",
  "tlsn_attestation_id": "<strict-base64url-N-bytes>",
  "verified_member_id": "<canonical decimal string>",
  "public_id": "<uuidv4>",
  "challenge_replayed": "<boolean>"
}
```

新規作成は`201`かつ`challenge_replayed=false`、同一ACTIVE Challengeの再取得は`200`かつ`challenge_replayed=true`である。Replayは同じSession ID、binding nonce/value、challenge ID、nonce、expiry、device/public/member/Attestation IDsを返す。Response fieldは上記11個だけであり、canonical user IDとdevice public keyは返さない。

同一Attestationと同一Attestation Sessionはlifecycle全体でChallengeを最大1件とする。SessionとAttestationのどちらかが異なるResultの結合は許可しない。

```sql
CREATE UNIQUE INDEX uq_claim_challenges_attestation
ON public.claim_challenges (tlsn_attestation_id);

CREATE UNIQUE INDEX uq_claim_challenges_session
ON public.claim_challenges (attestation_session_id);

CREATE UNIQUE INDEX uq_claim_challenges_active_device
ON public.claim_challenges (device_id)
WHERE challenge_status = 'ACTIVE';
```

Index predicate に `now()` を使用してはならない。

Attestationの一回性と`UNIQUE(tlsn_attestation_id)`をlifecycle全体で成立させるため、すべてのChallenge rowを保持する。Accepted Claimが参照するrowだけでなく、unclaimed CONSUMED/EXPIRED rowも削除しない。Section 10.5のcleanup RPCは期限切れACTIVE/PENDINGの遷移だけを行い、Challenge rowを削除してはならない。

### 7.3 ClaimBindingBytes

Client は Challenge response を次の順序で binary serialize し、device Ed25519 private key で署名する。

| Order | Field | Encoding |
| ---: | --- | --- |
| 1 | domain | `u16_be(23)` + ASCII `FUSOU-IDENTITY-CLAIM-V1` |
| 2 | purpose | `u16_be(24)` + ASCII `GAME_ACCOUNT_IDENTITY_V1` |
| 3 | Attestation Session ID | `u16_be(16)` + RFC 4122 network-order UUID bytes |
| 4 | binding nonce | `u16_be(32)` + raw 32 bytes |
| 5 | binding value | `u16_be(length)` + exact ASCII binding value bytes |
| 6 | Attestation ID | `u16_be(N)` + raw `N` bytes |
| 7 | verified member ID | `u16_be(length)` + decimal ASCII bytes |
| 8 | device ID | `u16_be(16)` + RFC 4122 network-order UUID bytes |
| 9 | public ID | `u16_be(16)` + RFC 4122 network-order UUID bytes |
| 10 | challenge ID | `u16_be(16)` + RFC 4122 network-order UUID bytes |
| 11 | challenge nonce | `u16_be(32)` + raw 32 bytes |

`ClaimSignature = Ed25519.Sign(device_private_key, ClaimBindingBytes)`。

ClientはresponseのSession ID、`binding_nonce`、`binding_value`、`tlsn_attestation_id`、`challenge_nonce`をstrict canonical formでdecodeし、Session ID/challenge IDはUUID raw bytes、nonce/Attestation IDはraw bytes、binding valueはexact ASCII bytesとして上表へ入れる。JSON StringのASCII bytesまたは再encodeしたbase64url bytesを署名入力にしてはならない。ServerはChallenge responseの値をauthorityとせず、同じSession rowとChallenge rowから再構築した bytes を検証する。

### 7.4 `POST /api/identity/v1/claims`

HTTP Request body は次だけである。

```json
{
  "challenge_id": "<uuidv4>",
  "signature": "<strict-unpadded-base64url-64-bytes>"
}
```

Claim受理には次の12 preconditionsをすべて満たす必要がある。1つでも不一致ならownership/device transition前にrejectする。

1. Bearer actorが存在し、`auth.users.is_anonymous = false`である。
2. Challengeがactor-ownedであり、missing/different ownerを同じ404へ写像する。
3. Challengeの`attestation_session_id`がretained Session rowを一意に参照する。
4. Sessionの`canonical_user_id`、Challengeの`canonical_user_id`、Bearer actorが一致する。
5. Sessionの`device_id`、Challengeの`device_id`、Sessionの`device_public_key`、Challengeの`device_public_key_sha256`が一致する。
6. Sessionの`binding_nonce`、Challengeの`binding_nonce`、Verifier Resultの`binding_nonce`がbyte-for-byte一致する。
7. Sessionから再計算した`binding_value`がChallenge/Verifier Resultの`binding_value`と一致し、同じ value がauthenticated request transcriptのexact binding headerに現れる。
8. Session、Challenge、Verifier ResultのAttestation ID、member ID、profile/server/key IDs、times、full transcript digests、Range metadata、purposeがimmutable authorityとして一致する。
9. ChallengeとSessionがACTIVEかつ、同じ `v_db_now` に対してそれぞれのexpiryが未来である。
10. `user_devices` rowがSessionのkey/user/public IDに対応するPENDING deviceであり、device statusがREVOKED/VERIFIEDへ先行遷移していない。
11. Signatureが、serverがSession/Challenge authorityから再構成した11-field ClaimBindingBytesに対するstrict pure Ed25519 signatureである。
12. 同Attestation、同Session、同Challengeにaccepted Claimがなく、ownership conflict、device/quota limit、unique constraint violationがない。

FUSOU-WEB は Challenge row から `device_id`、nonce、`public_id`、`api_member_id`、Attestation ID、`notary_time`、key IDs、range metadata を復元する。Client から同名 metadata を受け付けない。

1. `get_claim_challenge_v1(authenticated_user_id, challenge_id)`を呼ぶ。`RESOURCE_NOT_FOUND`は404、`CHALLENGE_EXPIRED`は`expire_identity_artifact_v1(challenge_id)`を同requestで完了して410、`SESSION_NOT_ACTIVE`はlinked Session/Challengeをusableな状態にせず409、`CHALLENGE_NOT_ACTIVE`は409とし、authority fieldsを処理しない。`OK`または`OK_REPLAY`だけ次へ進む。Read resultからSession/Challenge/Result authorityの全12 preconditionsを再確認し、値をclient inputとして扱わない。
2. Current Notary/Verifier registriesを、device signature検証、`consume_invalid_challenge`、Claim RPCのいずれよりも先に照合する。`OK`は両keyがACTIVE/VERIFY_ONLYかつNotaryは`notary_time`、Verifierは`result_time`がoriginal signing window内、profile hash一致を要求する。`OK_REPLAY`はRETIREDも許可するが、両caseともmissing/REVOKEDは`409 CHALLENGE_NOT_ACTIVE`とし、registry failureではChallengeをconsume/expireせずDB mutationを行わない。
3. Session row、Device row、Challenge rowのauthority valuesからClaimBindingBytesを再構築し、Session ID、binding nonce、binding valueを含める。
4. Strict RFC 8032 pure Ed25519 signatureをraw bytesに対して検証。
5. invalidの場合は`consume_invalid_challenge(authenticated_user_id, challenge_id)`を呼ぶ。Outcomeが`SESSION_NOT_ACTIVE`なら`409 SESSION_NOT_ACTIVE`、`CHALLENGE_EXPIRED`なら`410 CHALLENGE_EXPIRED`、`INVALID_SIGNATURE_CONSUMED`なら`401 INVALID_DEVICE_SIGNATURE`、`CHALLENGE_NOT_ACTIVE`なら`409 CHALLENGE_NOT_ACTIVE`を返す。
6. validの場合はDB RPC `claim_verified_device_v1(authenticated_user_id, challenge_id)`を呼ぶ。

RPCへ渡す`authenticated_user_id`はFUSOU-WEBが検証済みsessionから得た値であり、client JSONには存在しない。Claim RPCはclient metadata、signature、public ID、member IDを引数に取ってはならない。

新規Claimは`201`、idempotent replayは`200`であり、response bodyは次の7 fieldsだけである。

```json
{
  "claim_id": "<uuidv4>",
  "device_id": "<uuidv4>",
  "public_id": "<uuidv4>",
  "identity_state": "<UNCLAIMED|GAME_IDENTITY_VERIFIED|SOCIAL_ACCOUNT_BOUND>",
  "claim_type": "<INITIAL_VERIFIED|ADDITIONAL_DEVICE>",
  "claim_replayed": "<boolean>",
  "currently_authorized": "<boolean>"
}
```

新規Claimは`claim_replayed=false`、exact replayは`true`で同じ`claim_id`、`device_id`、`public_id`、stored `claim_type`を返す。`identity_state`はresponse transaction内のwrite後にSection 8.1から再計算する。`currently_authorized`は当該deviceが現在VERIFIED、not revoked、かつcurrent ownershipとuser/publicが一致する場合だけtrueであり、Social Bindingの有無を含めない。

### 7.5 Invalid Signature Consumption

`consume_invalid_challenge(UUID, UUID)`はservice-only SECURITY DEFINER functionとする。第1引数はauthenticated user、第2引数はChallenge IDであり、non-anonymous userを再検証する。Challengeをnon-locking pre-readした後、Lock orderに従いlinked Session row、Challenge rowを`FOR UPDATE`し、次の順序でtyped outcomeを返す。

1. Missing/different ownerは`RESOURCE_NOT_FOUND`。
2. Session rowをChallenge rowの前に`FOR UPDATE`し、ChallengeのSession ID、actor、device ID、binding nonceとSession authorityの一致を検証する。Sessionが見つからない、またはcross-table mismatchならinvariant errorとしてabortする。
3. `v_db_now := pg_catalog.transaction_timestamp()`をSession/Challenge row lock後に一度だけ取得する。SessionがREVOKED、またはSessionがexpiry済みなら、ACTIVE Challengeを`EXPIRED/TTL_EXPIRED`へ正規化し`SESSION_NOT_ACTIVE`を返す。SessionがACTIVEでもChallengeの`expires_at <= v_db_now`なら、両rowを`EXPIRED/TTL_EXPIRED`へ遷移し`CHALLENGE_EXPIRED`を返す。Device pending expiryが先に成立した場合はDeviceを`REVOKED/expired_pending`、Challenge/Sessionを`EXPIRED/TTL_EXPIRED`へ遷移し`SESSION_NOT_ACTIVE`を返す。
4. ChallengeとSessionがともにACTIVEなら、Challengeを`CONSUMED/INVALID_SIGNATURE`、Sessionを`CONSUMED/INVALID_SIGNATURE`へ同一transactionで遷移し`INVALID_SIGNATURE_CONSUMED`を返す。
5. Terminal rowは`CHALLENGE_NOT_ACTIVE`。SessionとChallengeのterminal state/reasonが一致しない場合はcorruptionとしてabortする。

Valid Claimと競合した場合はfirst row-lock winnerが消費する。FunctionはChallenge row lock取得後にほかのadvisory/row lockを取得しない。

### 7.6 Claim Idempotency

同一 Attestation の既存 Claim が次の4値すべてで一致する場合だけ idempotent success とする。

```text
tlsn_attestation_id
verified_device_id
public_id
canonical_user_id
```

1値でも異なれば `409 ATTESTATION_ALREADY_CLAIMED`。Idempotent response は `claim_replayed=true` と current device state を返す。Device が既に REVOKED なら Claim 自体は idempotent success だが `currently_authorized=false` とし、Token を発行しない。Existing accepted Claimをcurrent authorizationと解釈してはならない。

`member_identity_claims.challenge_id`はClaimに使用したChallengeを一意に参照し、`ON DELETE RESTRICT`とする。Accepted Claim replayは同じ`challenge_id`から上記4値を復元できる。4値が一致しても`challenge_id`、member/public/user/device IDs、Attestation ID、notary/result times、profile hash、server identity、両key IDs、Verifier Result/full transcript digests、両Range metadata、proof purposeの全immutable authority列がChallengeとbyte/value-for-byte/value一致しない場合はDB corruptionとしてtransactionをabortし、idempotent successを返さない。

---

## 8. State Machine と Ownership Rule

### 8.1 Identity State

Persistent Identity State は次の3つだけである。

```text
UNCLAIMED
GAME_IDENTITY_VERIFIED
SOCIAL_ACCOUNT_BOUND
```

`TLSN_PROOF_VERIFIED` は request-local context、`DATASET_TOKEN_ISSUED` は credential event であり state に追加しない。`DEVICE_BOUND` を追加しない。

stateを返す前に、root-derived invariant を次のように検証する。`member_ownership` が存在する場合は同じ`public_id`/`canonical_user_id`の accepted Claim が少なくとも1件存在する。accepted Claim が存在する場合は対応する ownership と、Claimの`verified_device_id`に一致する user_devices row が存在し、`public_id`/`canonical_user_id`/device authority が一致する。current VERIFIED device が1件以上ある場合は ownership、accepted Claim、同じ owner の current VERIFIED device がすべて存在し、異なる owner の current VERIFIED device が存在しない。PENDING deviceにaccepted Claimがあってはならない。`social_user_id`が非NULLの場合は ownership の canonical user と一致し、canonical userのsupported Google identityも存在しなければならない。これらを満たさない組合せは state として補正せず invariant corruption を raise する。

Invariant 検証後の単一state評価順は次である。

```text
1. current VERIFIED device が0件 -> UNCLAIMED
2. current VERIFIED device があり Social Binding 成立 -> SOCIAL_ACCOUNT_BOUND
3. current VERIFIED device があり Social Binding 不成立 -> GAME_IDENTITY_VERIFIED
```

#### UNCLAIMED

対象 `public_id` に current VERIFIED device が0件の状態。

次が存在しても UNCLAIMED である。

- historical `member_identity_claims`
- REVOKED devices
- historical `member_ownership`
- REVOKED `primary_device_id`
- historical Social Binding

Historical ownership が存在する UNCLAIMED Dataset は同じ `canonical_user_id` だけが再 Claim できる。別 user は自動 takeover できない。

#### GAME_IDENTITY_VERIFIED

次をすべて満たす状態。

1. `member_identity_claims` に accepted Claim がある。
2. `member_ownership` がある。
3. 同じ `public_id` と owner の `user_devices.device_status = 'VERIFIED'` が1件以上ある。
4. 当該 `public_id` の全 VERIFIED device の `canonical_user_id` が owner と一致する。

#### SOCIAL_ACCOUNT_BOUND

GAME_IDENTITY_VERIFIED に加え、`member_ownership.social_user_id = member_ownership.canonical_user_id` が成立した状態。

### 8.2 Device State

Device state は次だけである。

```text
PENDING
VERIFIED
REVOKED
```

State change は次だけを許可する。

```text
PENDING -> VERIFIED
PENDING -> REVOKED
VERIFIED -> REVOKED
REVOKED -> no state transition
```

同一 state の metadata update は許可する。`device_id`、`canonical_user_id`、`public_id`、`device_public_key` は immutable である。PENDING expiry は `PENDING -> REVOKED` とし、`expired_pending` を `revoked_reason` に記録する。

### 8.3 Owner Conflict と Claim Type

1. `member_ownership` がない初回 Claim は許可する。
2. ownership があり same `canonical_user_id` なら Additional Device を許可する。
3. ownership があり different `canonical_user_id` なら、current VERIFIED device の有無に関係なく拒否する。
4. 異なる user への移転は v1 Claim RPC に実装しない。

Canonical `claim_type` は次だけである。

```text
INITIAL_VERIFIED
ADDITIONAL_DEVICE
```

Ownership rootがないClaimはlegacy/PENDING/REVOKED device historyの有無にかかわらず`INITIAL_VERIFIED`、same historical ownerへの追加/reclaimは`ADDITIONAL_DEVICE`である。Untrusted legacy historyをclaim typeのauthorityに使用しない。

### 8.4 Multiple VERIFIED Devices

同じ `public_id` に複数 VERIFIED device を許可する。全 VERIFIED device は `member_ownership.canonical_user_id` と一致しなければならない。上限は16台とし、Identity lock 下で count して race を防ぐ。

PENDING TTLは作成時から24時間、Challenge TTLは作成時から最大5分かつ対応PENDING expiryを越えない。未期限PENDING上限はactor user全体で5件、public ID全体で5件。VERIFIED上限はpublic IDごとに16件であり、Claim RPCがPENDING -> VERIFIED直前にIdentity lock下で再確認する。期限切れPENDINGはChallenge発行/Claim時のlazy sweepと1時間ごとのcleanup RPCでREVOKEDへ遷移し、そのACTIVE Challengeは`EXPIRED/TTL_EXPIRED`へ同じtransactionで遷移する。

### 8.5 `primary_device_id`

`member_ownership.primary_device_id` は最後に accepted Claim を完了した device への historical pointer である。Device revoke 時に変更・NULL化しない。`primary_device_id` だけで authorization、Identity State、Token validity を決定してはならない。

---

## 9. PostgreSQL Target Schema

### 9.1 Canonical scalar types

| Concept | PostgreSQL type | Constraint |
| --- | --- | --- |
| `api_member_id` | `TEXT` | `^[1-9][0-9]{0,15}$` |
| `public_id`, device/challenge/claim IDs | `UUID` | Server-generated UUIDv4 |
| device public key | `BYTEA` | `octet_length = 32`, global `UNIQUE` |
| Attestation ID | `BYTEA` | `octet_length = <PHASE-0-LITERAL-N>` |
| nonce | `BYTEA` | `octet_length = 32` |
| signature | API only | decoded 64 bytes |
| `notary_time` | `NUMERIC(20,0)` | UInt64 range、same semantics as protocol |
| DB lifecycle time | `TIMESTAMPTZ` | entry functionが一度取得する`v_db_now`によるDB event time。`notary_time`の代用禁止 |

Schema中の`<Phase-0 literal N>`は設計時のsymbolic placeholderであり、実装値ではない。P0-02が固定したAttestation IDのnumeric byte lengthで仕様書中の全placeholderを置換し、置換結果をmigration/constraint testで検証するまで、target migrationをcommitまたはapplyしてはならない。Nを推測した値やfixtureだけで代用してはならない。

`notary_time`の実型は次のdomainである。

```sql
CREATE DOMAIN public.fusou_uint64 AS NUMERIC
CHECK (
  VALUE = pg_catalog.trunc(VALUE)
  AND VALUE BETWEEN 0 AND 18446744073709551615
);
```

すべてのServer-generated UUIDにはversion nibble `4`、variant nibble `[89ab]`のCHECKを付ける。`TIMESTAMPTZ` lifecycle columnsはentry functionが一度取得する`v_db_now`を使い、client timestampを受け取らない。

### 9.2 `member_id_mapping`

Target columns は現行 `id`、`api_member_id`、`public_id`、timestamps を保持する。次を追加・強制する。

```sql
UNIQUE (api_member_id)
UNIQUE (public_id)
UNIQUE (api_member_id, public_id)
CHECK (api_member_id ~ '^[1-9][0-9]{0,15}$')
```

`api_member_id` と `public_id` は trigger で immutable にする。Client role と service role の direct INSERT/UPDATE/DELETE/TRUNCATE を revoke する。

### 9.3a `attestation_sessions`

Session row はproof取得より前に作成し、terminal rowも削除せず保持する。`binding_value`は保存せず、`session_id`と`binding_nonce`からSection 7.1.1のcanonical bytesを再計算する。terminal rowを再利用せず、同じ非REVOKED device keyに対する新規Sessionだけを許可する。

```text
session_id UUID PRIMARY KEY
canonical_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
device_id UUID NOT NULL
device_public_key BYTEA NOT NULL CHECK (octet_length(device_public_key) = 32)
binding_nonce BYTEA NOT NULL UNIQUE CHECK (octet_length(binding_nonce) = 32)
issued_at TIMESTAMPTZ NOT NULL
expires_at TIMESTAMPTZ NOT NULL
session_status TEXT NOT NULL CHECK (session_status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED'))
terminal_reason TEXT NULL CHECK (terminal_reason IN ('CLAIM_ACCEPTED', 'INVALID_SIGNATURE', 'DEVICE_REVOKED', 'TTL_EXPIRED'))
consumed_at TIMESTAMPTZ NULL
expired_at TIMESTAMPTZ NULL
revoked_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL
UNIQUE (session_id, canonical_user_id, device_id, binding_nonce)
```

Session row-shape CHECKは次である。

```text
ACTIVE   => terminal_reason NULL, consumed_at NULL, expired_at NULL, revoked_at NULL
CONSUMED => terminal_reason IN (CLAIM_ACCEPTED, INVALID_SIGNATURE), consumed_at NOT NULL,
            expired_at NULL, revoked_at NULL
EXPIRED  => terminal_reason = TTL_EXPIRED, consumed_at NULL, expired_at NOT NULL,
            revoked_at NULL
REVOKED  => terminal_reason = DEVICE_REVOKED, consumed_at NULL, expired_at NULL,
            revoked_at NOT NULL
```

`session_id`、`canonical_user_id`、`device_id`、`device_public_key`、`binding_nonce`、`issued_at`、`expires_at`はimmutableである。Lifecycleは`ACTIVE -> CONSUMED/EXPIRED/REVOKED`だけを許可する。`session_id`/nonceは全lifecycleで一意だが、同じ非REVOKED device keyはterminal Sessionを保持したまま新しいSessionで再利用できる。`device_public_key`ごとのACTIVE Sessionはpartial UNIQUE indexで1件に制限する。Sessionは`user_devices`のpublic/member rowをまだ持たない場合があり、Challenge issuanceだけがSessionのdevice ID/keyをtarget `public_id`へ一度結び付ける。以後のClaim/Revoke/cleanupはSessionとChallengeを同じlock protocol・transactionで更新する。

```sql
CREATE UNIQUE INDEX uq_attestation_sessions_active_key
ON public.attestation_sessions (device_public_key)
WHERE session_status = 'ACTIVE';
```

### 9.3 `user_devices`

Target columns は次である。

```text
device_id UUID PRIMARY KEY
canonical_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
public_id UUID NOT NULL REFERENCES member_id_mapping(public_id) ON DELETE RESTRICT
device_public_key BYTEA NOT NULL UNIQUE CHECK (octet_length(device_public_key) = 32)
device_status TEXT NOT NULL CHECK (device_status IN ('PENDING', 'VERIFIED', 'REVOKED'))
pending_expires_at TIMESTAMPTZ NULL
verified_at TIMESTAMPTZ NULL
revoked_at TIMESTAMPTZ NULL
revoked_reason TEXT NULL
created_at TIMESTAMPTZ NOT NULL
last_seen_at TIMESTAMPTZ NULL
UNIQUE (device_id, public_id, canonical_user_id)
```

Row-shape CHECK は次である。

```text
PENDING  => pending_expires_at NOT NULL, verified_at NULL,
            revoked_at NULL, revoked_reason NULL
VERIFIED => verified_at NOT NULL, revoked_at NULL, revoked_reason NULL
REVOKED  => revoked_at NOT NULL, revoked_reason NOT NULL
```

`canonical_user_id`のFKは`ON DELETE RESTRICT`。現行`pubkey_algo`は全rowがexact `ed25519`であることをpreflight後にdropする。旧`UNIQUE(public_id, device_pubkey)`はdropし、global `UNIQUE(device_public_key)`へ置換する。

`pending_expires_at > now()` は volatile time condition なので CHECK に入れず RPC で評価する。Transition trigger は Section 8.2 以外の status change と identity/key columns の変更を拒否する。同一stateのUPDATEで変更できるのは`last_seen_at`だけである。Direct table mutation は service role を含め revoke し、Security Definer RPC だけを write path とする。

### 9.4 `member_ownership`

```text
public_id UUID PRIMARY KEY REFERENCES member_id_mapping(public_id) ON DELETE RESTRICT
canonical_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
primary_device_id UUID NOT NULL
social_user_id UUID NULL REFERENCES auth.users(id) ON DELETE RESTRICT
established_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
FOREIGN KEY (primary_device_id, public_id, canonical_user_id)
  REFERENCES user_devices(device_id, public_id, canonical_user_id) ON DELETE RESTRICT
CHECK (social_user_id IS NULL OR social_user_id = canonical_user_id)
```

`public_id` と `canonical_user_id` は immutable。`primary_device_id` は same owner/public の accepted Additional Device Claim でだけ更新する。`social_user_id` は explicit Social Binding で `NULL -> canonical_user_id`、または同値 idempotent update だけを許可する。

### 9.5 `member_identity_claims`

```text
claim_id UUID PRIMARY KEY
challenge_id UUID NOT NULL UNIQUE REFERENCES claim_challenges(challenge_id) ON DELETE RESTRICT
attestation_session_id UUID NOT NULL
binding_nonce BYTEA NOT NULL CHECK (octet_length(binding_nonce) = 32)
binding_value TEXT NOT NULL
api_member_id TEXT NOT NULL
public_id UUID NOT NULL
canonical_user_id UUID NOT NULL
verified_device_id UUID NOT NULL UNIQUE
tlsn_attestation_id BYTEA NOT NULL UNIQUE CHECK (octet_length(tlsn_attestation_id) = <PHASE-0-LITERAL-N>)
notary_time public.fusou_uint64 NOT NULL
result_time public.fusou_uint64 NOT NULL
profile_sha256 BYTEA NOT NULL CHECK (octet_length(profile_sha256) = 32)
server_identity TEXT NOT NULL
verifier_key_id TEXT NOT NULL
notary_key_id TEXT NOT NULL
verifier_result_sha256 BYTEA NOT NULL CHECK (octet_length(verifier_result_sha256) = 32)
request_transcript_sha256 BYTEA NOT NULL CHECK (octet_length(request_transcript_sha256) = 32)
response_transcript_sha256 BYTEA NOT NULL CHECK (octet_length(response_transcript_sha256) = 32)
request_ranges JSONB NOT NULL CHECK (jsonb_typeof(request_ranges) = 'array')
response_ranges JSONB NOT NULL CHECK (jsonb_typeof(response_ranges) = 'array')
proof_purpose TEXT NOT NULL CHECK (proof_purpose = 'GAME_ACCOUNT_IDENTITY_V1')
claim_type TEXT NOT NULL CHECK (claim_type IN ('INITIAL_VERIFIED', 'ADDITIONAL_DEVICE'))
claimed_at TIMESTAMPTZ NOT NULL
FOREIGN KEY (api_member_id, public_id)
  REFERENCES member_id_mapping(api_member_id, public_id) ON DELETE RESTRICT
FOREIGN KEY (verified_device_id, public_id, canonical_user_id)
  REFERENCES user_devices(device_id, public_id, canonical_user_id) ON DELETE RESTRICT
FOREIGN KEY (attestation_session_id, canonical_user_id, verified_device_id, binding_nonce)
  REFERENCES attestation_sessions(session_id, canonical_user_id, device_id, binding_nonce) ON DELETE RESTRICT
```

`profile_sha256`、`server_identity`、key IDs、Range metadataはChallengeからbyte-for-byte copyし、Claim API inputから受け取らない。Key IDsは`^[A-Za-z0-9._-]{1,64}$`、`server_identity`はSection 5.2のhostname grammarをCHECKする。`request_ranges`と`response_ranges`は`validate_range_metadata_v1()`もCHECKし、両tableで`jsonb_array_length(request_ranges) = 3`と`jsonb_array_length(response_ranges) = 1`を別CHECKとして持つ。

Stored Range metadata object は `start`、`length`、`sha256` のexact 3 keysだけを持つ。`start`と`length`はUInt64Decimal String、`sha256`はraw revealed bytesのSHA-256 lowercase 64-hex Stringである。Arrayはstart昇順でoverlapなし。`validate_range_metadata_v1(JSONB)` immutable functionでこのshapeを検証する。Raw revealed bytesは保存しない。

Append-only DDL order は次に固定する。

```text
CREATE TABLE
-> REVOKE INSERT, UPDATE, DELETE, TRUNCATE from PUBLIC/anon/authenticated/service_role
-> GRANT SELECT only to required audit role
-> CREATE reject-update-delete trigger function
-> CREATE BEFORE UPDATE OR DELETE trigger
-> CREATE claim SECURITY DEFINER function
```

Table owner/superuser compromise は DB trust boundary 外である。通常 Application role は Claim function 経由以外で INSERT できない。

### 9.6 `claim_challenges`

```text
challenge_id UUID PRIMARY KEY
attestation_session_id UUID NOT NULL
binding_nonce BYTEA NOT NULL CHECK (octet_length(binding_nonce) = 32)
binding_value TEXT NOT NULL
api_member_id TEXT NOT NULL
public_id UUID NOT NULL
canonical_user_id UUID NOT NULL
device_id UUID NOT NULL
device_public_key_sha256 BYTEA NOT NULL CHECK (octet_length(device_public_key_sha256) = 32)
tlsn_attestation_id BYTEA NOT NULL CHECK (octet_length(tlsn_attestation_id) = <PHASE-0-LITERAL-N>)
challenge_nonce BYTEA NOT NULL CHECK (octet_length(challenge_nonce) = 32)
notary_time public.fusou_uint64 NOT NULL
result_time public.fusou_uint64 NOT NULL
profile_sha256 BYTEA NOT NULL CHECK (octet_length(profile_sha256) = 32)
server_identity TEXT NOT NULL
verifier_key_id TEXT NOT NULL
notary_key_id TEXT NOT NULL
verifier_result_sha256 BYTEA NOT NULL CHECK (octet_length(verifier_result_sha256) = 32)
request_transcript_sha256 BYTEA NOT NULL CHECK (octet_length(request_transcript_sha256) = 32)
response_transcript_sha256 BYTEA NOT NULL CHECK (octet_length(response_transcript_sha256) = 32)
request_ranges JSONB NOT NULL CHECK (jsonb_typeof(request_ranges) = 'array')
response_ranges JSONB NOT NULL CHECK (jsonb_typeof(response_ranges) = 'array')
proof_purpose TEXT NOT NULL CHECK (proof_purpose = 'GAME_ACCOUNT_IDENTITY_V1')
challenge_status TEXT NOT NULL CHECK (challenge_status IN ('ACTIVE', 'CONSUMED', 'EXPIRED'))
terminal_reason TEXT NULL CHECK (terminal_reason IN ('CLAIM_ACCEPTED', 'INVALID_SIGNATURE', 'DEVICE_REVOKED', 'TTL_EXPIRED'))
expires_at TIMESTAMPTZ NOT NULL
consumed_at TIMESTAMPTZ NULL
expired_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL
FOREIGN KEY (api_member_id, public_id)
  REFERENCES member_id_mapping(api_member_id, public_id) ON DELETE RESTRICT
FOREIGN KEY (device_id, public_id, canonical_user_id)
  REFERENCES user_devices(device_id, public_id, canonical_user_id) ON DELETE RESTRICT
FOREIGN KEY (attestation_session_id, canonical_user_id, device_id, binding_nonce)
  REFERENCES attestation_sessions(session_id, canonical_user_id, device_id, binding_nonce) ON DELETE RESTRICT
```

Lifecycle CHECK は次である。

```text
ACTIVE   => terminal_reason NULL, consumed_at NULL, expired_at NULL
CONSUMED => terminal_reason IN (CLAIM_ACCEPTED, INVALID_SIGNATURE, DEVICE_REVOKED), consumed_at NOT NULL, expired_at NULL
EXPIRED  => terminal_reason = TTL_EXPIRED, consumed_at NULL, expired_at NOT NULL
```

Challenge は transient coordination state であり Identity Authorization Root ではない。ACTIVE Challenge は linked Session がACTIVEかつ未期限、deviceがPENDINGかつ未期限の場合だけusableである。Session expiry、Device pending expiry、またはDevice revokeを検出した全supported pathは、linked ACTIVE Challengeを同じtransactionでterminal化するか、少なくともusableでないことを返し、`Session = EXPIRED` と `Challenge = ACTIVE and usable` の組合せを許可してはならない。

Challenge authority columnsはimmutable。Lifecycle triggerは`ACTIVE -> CONSUMED`または`ACTIVE -> EXPIRED`だけを許可し、terminal stateからの遷移を拒否する。`verifier_key_id`と`notary_key_id`は`^[A-Za-z0-9._-]{1,64}$`。Digest columnsはそれぞれ次へ固定する。

```text
device_public_key_sha256 = SHA-256(raw 32-byte device public key)
verifier_result_sha256 = SHA-256(exact canonical Verifier Result JSON bytes including signature)
request_transcript_sha256 = SHA-256(authenticated full request transcript bytes)
response_transcript_sha256 = SHA-256(authenticated full response transcript bytes)
Range sha256 = SHA-256(raw decoded Range bytes)
```

`UNIQUE(tlsn_attestation_id)`とSection 7.2のpartial ACTIVE device indexを作成する。Expired/consumed Attestationから新Challengeを作らない。`CONSUMED/CLAIM_ACCEPTED` Challengeはaccepted Claim replayのauthority recordとしてretention期限なく保持する。

Challenge row は retention enforcement のため delete 不可である。Migration は `reject_claim_challenge_delete_v1()` (`RETURNS trigger`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`) を作成し、function body は常に `RAISE EXCEPTION 'CHALLENGE_DELETE_FORBIDDEN';` の後に到達不能な `RETURN OLD` を置く。`trg_claim_challenges_reject_delete_v1` を `claim_challenges` の `BEFORE DELETE FOR EACH ROW` trigger として付ける。この trigger は常に `CHALLENGE_DELETE_FORBIDDEN` を raise する。`PUBLIC`、`anon`、`authenticated`、`service_role`から table の `DELETE`/`TRUNCATE` を revoke し、cleanup RPCを含む全supported pathはlifecycle UPDATEだけを行う。superuser/table ownerによる直接削除はDB trust boundary外であり、preflight/postflightでtrigger、owner、ACLを検査する。

`claim_challenges`は`member_identity_claims`より先にCREATEし、mapping composite UNIQUEとdevice composite UNIQUEを両tableのFKより先に追加する。Section 9.5/9.6の記載順はDDL作成順を表さない。

### 9.7 Projection schema

`user_member_map` と `web_user_member_map` は `(user_id, public_id)` primary key と `UNIQUE(public_id)` を持つ。Projection write は Identity RPC owner だけに許可する。Application role と service role の direct INSERT/UPDATE/DELETE/TRUNCATE を revoke する。

### 9.8 Dataset upload replay ledger

`dataset_upload_ledger_v1`はIdentity Authorization Rootではなく、二段階uploadのsingle-use coordination tableである。

```text
ingest_id UUID PRIMARY KEY
device_id UUID NOT NULL REFERENCES user_devices(device_id) ON DELETE RESTRICT
public_id UUID NOT NULL REFERENCES member_id_mapping(public_id) ON DELETE RESTRICT
route_id TEXT NOT NULL CHECK (route_id IN ('FLEET_SNAPSHOT', 'BATTLE_DATA_UPLOAD', 'QUEST_TREE_INGEST', 'REMODEL_DATA_INGEST', 'SHIP_GROWTH_INGEST', 'SOKU_SPEED_OBSERVED_INGEST'))
content_sha256 BYTEA NOT NULL CHECK (octet_length(content_sha256) = 32)
content_size BIGINT NOT NULL CHECK (content_size >= 0)
nonce BYTEA NOT NULL UNIQUE CHECK (octet_length(nonce) = 32)
expires_at TIMESTAMPTZ NOT NULL
consumed_at TIMESTAMPTZ NULL CHECK (consumed_at IS NULL OR date_trunc('milliseconds', consumed_at) = consumed_at)
created_at TIMESTAMPTZ NOT NULL
```

Server-generated `ingest_id`はUUIDv4 PRIMARY KEY、nonceはCSPRNG 32 bytes、`created_at=date_trunc('second', v_db_now)`、`expires_at=created_at + interval '1 hour'`である。`created_at`と`expires_at`はCanonical Definitionに従う。Triggerは全authority columnsをimmutableにし、`consumed_at`の`NULL -> non-NULL`という一方向遷移だけを許可する。時刻を読むのはtriggerではなく`consume_dataset_upload_v1`であり、Canonical Definitionに従う`v_consumed_at = date_trunc('milliseconds', v_db_now)`を一度だけ計算してCAS UPDATEへ渡す。Consumedまたはexpired rowは7日保持後にservice-only cleanupで削除する。Table/sequenceへのdirect DML/TRUNCATEを全application roleからrevokeし、Section 10.5のentry functionsだけをwrite pathとする。

### 9.9 Roles と privileges

Migration operatorは次のNOLOGIN rolesを作る。

```text
fusou_identity_owner NOLOGIN
fusou_identity_auditor NOLOGIN
```

`member_id_mapping`、`member_identity_claims`、`member_ownership`、`user_devices`の4 Identity Authorization Root tables、`attestation_sessions`、`claim_challenges`、upload replay ledger、関連sequence、trigger/helper/entry functionsのownerは`fusou_identity_owner`。全table/sequence/functionについて`PUBLIC`、`anon`、`authenticated`、`service_role`から`ALL`をrevokeする。`fusou_identity_auditor`には`member_identity_claims`の`SELECT`だけをgrantする。`fusou_identity_owner`には`auth` schema USAGEと`auth.users(id, is_anonymous)`、`auth.identities(user_id, provider)`のSELECTだけをgrantする。

`service_role`にEXECUTEをgrantするentry functionsは次だけである。

```text
issue_attestation_session_v1
issue_identity_challenge_v1
get_claim_challenge_v1
consume_invalid_challenge
claim_verified_device_v1
revoke_identity_device_v1
bind_social_identity_v1
get_dataset_token_subject_v1
validate_dataset_credential_state_v1
issue_dataset_upload_v1
consume_dataset_upload_v1
list_expired_identity_artifact_ids_v1
expire_identity_artifact_v1
list_expired_attestation_session_ids_v1
expire_attestation_session_v1
```

`lock_attestation_v1`、`lock_identity_v1`、`lock_user_quota_v1`、`lock_device_key_v1`、`get_or_create_public_id`、validator/trigger functionsは`fusou_identity_owner`だけが実行できる。すべてのSECURITY DEFINER functionは`SET search_path = public, extensions, pg_temp`を持ち、body内のrelation/functionをschema-qualifiedする。Function作成直後、次のfunctionを作る前にowner/revoke/grantを適用する。

`service_role`のentry EXECUTE grantはFUSOU-WEBのserver-only handlerが既存のDB entry contractを呼ぶためだけに使用する。Grantされたfunctionを直接呼べる技術的権限と、registry gateを省略してよい認可を混同してはならない。Notary/Verifier registryまたはDataset JWT registryに依存する各entry RPCは、FUSOU-WEBが同一request内でcurrent registryを照合してから呼び、client、PostgRESTの公開経路、registry照合を経ない任意の`service_role` direct RPCをsupported callerとしない。Production caller inventoryはこのserver-only handler以外の実行主体を拒否する。

Preflight/postflightは`PUBLIC`、`anon`、`authenticated`、`service_role`に`public`/`extensions` schemaの`CREATE` privilegeがないことをassertする。Built-inは`pg_catalog.transaction_timestamp()`等、extension functionは`extensions.gen_random_uuid()`等として全てschema-qualifiedする。

最終ACL matrixは次である。`fusou_identity_owner`の`ALL`はowned identity objectsに限り、NOLOGINである。全roleについてmigration完了後の`public`/`extensions` schema `CREATE`は`NO`とし、migration operatorだけがobject作成中に使用する。`PUBLIC`はPostgreSQLの擬似roleとして明示する。

| Principal | Identity tables/sequences | Entry EXECUTE | Internal/helper EXECUTE | `public`/`extensions` CREATE | `auth` schema/data |
| --- | --- | --- | --- | --- | --- |
| `PUBLIC` | none | none | none | NO | none |
| `anon` | none | none | none | NO | none |
| `authenticated` | none | none | none | NO | none |
| `service_role` | none | entry functions only | none | NO | none |
| `fusou_identity_owner` | ALL on owned objects | owner-only | owner-only | NO after migration | `USAGE` + `SELECT` on `auth.users(id,is_anonymous)` and `auth.identities(user_id,provider)` |
| `fusou_identity_auditor` | `SELECT` on `member_identity_claims` only | none | none | NO | none |

---

## 10. Security Functions、Locks、Atomic Claim

Entry functionは`READ COMMITTED` transactionだけを受け付け、開始時に`current_setting('transaction_isolation') = 'read committed'`を確認する。Expected business outcomeは例外にせず、固定`outcome` enumとnullable result columnsを持つtyped table resultとして返す。これにより`ACTIVE -> EXPIRED`などのlifecycle更新をcommitできる。Shape/invariant corruption、unexpected SQL errorだけをraiseし、HTTPではdetailを漏らさない`500 INTERNAL_ERROR`へ変換する。

### 10.1 Lock domains と total order

Advisory lockは`pg_advisory_xact_lock(integer, integer)`の2-key formだけを使用する。第1 keyをdomain ID、第2 keyを`hashtext` resultとし、domain間のkey spaceを分離する。

```sql
CREATE OR REPLACE FUNCTION public.lock_identity_v1(p_api_member_id TEXT)
RETURNS VOID
LANGUAGE sql
VOLATILE STRICT PARALLEL UNSAFE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(
    1179997002,
    pg_catalog.hashtext(p_api_member_id)
  );
$$;
```

残るinternal helpersも同じshapeとし、domain IDを次に固定する。

```text
lock_attestation_v1(BYTEA): 1179997001, hashtext(encode(value, 'hex'))
lock_identity_v1(TEXT):     1179997002, hashtext(value)
lock_user_quota_v1(UUID):   1179997003, hashtext(value::text)
lock_device_key_v1(BYTEA):  1179997004, hashtext(encode(value, 'hex'))
```

異なるdomainは第1 keyが異なるため衝突しない。同一domainのhash collisionは余分なserializationだけを生み、row constraintsがcorrectnessを保証する。Lock keyは永続化せず、PostgreSQL major versionをまたぐ安定性に依存しない。

複数 lock/row を取る処理の total order は次である。

```text
1. Attestation advisory lock
2. Identity advisory lock
3. User-quota advisory lock
4. Device-key advisory lock
5. attestation_sessions row FOR UPDATE
6. member_id_mapping parent row FOR UPDATE
7. claim_challenges rows FOR UPDATE, challenge_id ascending
8. member_ownership row FOR UPDATE
9. user_devices rows FOR UPDATE, device_id ascending
10. projection rows
11. dataset_upload_ledger_v1 row FOR UPDATE
```

Operationが触れないlock domainは飛ばしてよいが、後順位を保持したまま前順位を新たに取得してはならない。Challenge issuance、Claim、Challenge cleanupはAttestationから開始する。Revoke、Social Binding、Token subject lookup、upload ledger mutationはIdentityから開始する。PENDING/VERIFIED数を変える処理はUser-quota lockを取得し、device rowを作成・遷移する処理はDevice-key lockを取得する。Pre-readはimmutable locatorを得るためだけに許可し、lock後に全authority valueを再検証する。

Expiryを判定またはlifecycle timestampを作成する各entry functionは、必要なlockを取得した後に`v_db_now := pg_catalog.transaction_timestamp()`を一度だけ取得する。同一transaction内のexpiry比較と期限遷移、および各timestampのCanonical Definitionに定める精度でのDB event timestamp生成にはこの値を再利用し、別のclock readやstatementごとの時刻を使わない。

### 10.2 `get_or_create_public_id()`

唯一の member ID -> public ID function は次の contract を持つ。

```sql
CREATE OR REPLACE FUNCTION public.get_or_create_public_id(p_api_member_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_public_id UUID;
BEGIN
  IF p_api_member_id !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'INVALID_VERIFIED_MEMBER_ID';
  END IF;

  PERFORM public.lock_identity_v1(p_api_member_id);

  INSERT INTO public.member_id_mapping (api_member_id, public_id)
  VALUES (p_api_member_id, extensions.gen_random_uuid())
  ON CONFLICT (api_member_id) DO NOTHING;

  SELECT public_id INTO STRICT v_public_id
  FROM public.member_id_mapping
  WHERE api_member_id = p_api_member_id
  FOR UPDATE;

  RETURN v_public_id;
END;
$$;
```

Function は transaction-scoped であり、same member ID に same immutable public ID を返す。`PUBLIC`、`anon`、`authenticated`、`service_role` から direct execute を revoke する。Challenge SECURITY DEFINER function owner だけが内部呼出しする。Challenge、Claim、Social、Token code に同じ mapping logic を複製してはならない。Invalid member IDはbusiness outcomeではなくtrusted caller contract違反なのでraiseする。

### 10.3 `claim_verified_device_v1(authenticated_user_id, challenge_id)`

Claim の security-sensitive linearization point は、Challenge consumption、Session transition、Device transition、accepted Claim INSERT、Ownership mutation、および projection updateを含む単一 transaction の authoritative commit である。commit 前の検査や一部の row updateは成功 Claim ではなく、commit failure時には全てrollbackされる。commit後に初めてClaimはacceptedとなり、同時実行の勝者はこのcommitを完了した transaction、敗者はlock後に観測したterminal stateまたは完全一致のidempotent replay resultに従う。

単一 transaction 内の順序を固定する。

1. Challengeをnon-locking readしAttestation、Session ID、member ID、user、device ID、device key digestを得る。存在しなければreject。Session rowは次のlock後に再取得する。
2. Attestation、Identity、User-quota、Device-key advisory lockを順に取得。
3. 対象Sessionと、同じdevice key/device IDにlinkedする全Session rowを`session_id`昇順で`FOR UPDATE`し、Sessionのcanonical user/device/key/nonce/lifecycleを再検証する。lock後に全linked Session/Challenge集合を再queryし、未lockのrowがあれば同じ順序でlockしてからmappingへ進む。対象Sessionの`attestation_session_id`、`binding_nonce`、`binding_value`はChallengeと一致し、ACTIVEでなければならない。
4. Mapping parent rowを`FOR UPDATE`し、Challengeの`(api_member_id, public_id)`と一致確認。
5. Challenge rowを`FOR UPDATE`し、pre-read値とactor userを再検証する。Claim insert用の全authority列はこのlock済みrowとSession rowから再構築し、pre-read値またはclient値を直接使用してはならない。
6. ownership row、対象device、同public IDのVERIFIED devicesをorderに従ってlockする。対象deviceの全ACTIVE Session/Challengeは、上記のSession lock後に再queryした集合と一致しなければならず、後順位で新たなSession rowを取得してはならない。
7. 同Attestation/Sessionのexisting Claimをlookup。actorを含む4値exact matchはidempotent result、mismatchはreject。
8. `v_db_now := pg_catalog.transaction_timestamp()`をこのtransactionで一度だけ取得する。新規ClaimではChallengeとSessionがACTIVEかつそれぞれの`expires_at > v_db_now`であることを確認。SessionがREVOKEDまたは期限切れなら、linked ACTIVE Challengeを`EXPIRED/TTL_EXPIRED`へ正規化して`SESSION_NOT_ACTIVE`でrejectする。SessionがACTIVEでもChallengeの期限切れ、またはDevice pending expiryが先に成立した場合は、Challenge/Session/Deviceを同じtransactionでterminal化し、前者は`CHALLENGE_EXPIRED`、後者は`SESSION_NOT_ACTIVE`でrejectする。
9. DeviceがPENDING、`pending_expires_at > v_db_now`、Challenge/Sessionとuser/public/key/nonce/binding digestが一致することを確認する。以後のChallenge/Session/Device expiry比較とlifecycle timestampにはこの同じ`v_db_now`だけを使い、別のclock readを行わない。
10. Ownership ruleを評価。different historical ownerはcurrent device数に関係なくreject。
11. 同public IDのVERIFIED deviceが別userに属する場合はinvariant violationとしてtransactionをabort。VERIFIED数が16以上なら`VERIFIED_DEVICE_LIMIT`。
12. `UPDATE ... SET challenge_status='CONSUMED', terminal_reason='CLAIM_ACCEPTED', consumed_at=v_db_now WHERE challenge_status='ACTIVE' AND expires_at > v_db_now`を実行し、affected row = 1を要求する。Sessionも同じtransactionで`CONSUMED/CLAIM_ACCEPTED`へ遷移する。
13. DeviceをPENDING -> VERIFIEDにし`verified_at`を設定。
14. ownershipがなければINSERT、same ownerならhistorical `primary_device_id`をnew deviceへ更新。
15. Claim typeをSection 8.3から決定し、Session ID、binding nonce/valueを含む`member_identity_claims`へINSERT。
16. `user_member_map`をownershipからupsert。Social Bindingがある場合だけ`web_user_member_map`をupsert。
17. current state、claim ID、`claim_replayed=false`を返してcommit。

Unique constraint failure を normal control flow の代用にせず、同じ error code へ正規化する。

### 10.4 Revoke

`POST /api/identity/v1/devices/revoke`はbody `{ "device_id": "<uuidv4>" }`だけを受ける。ServerはBearer userを別途取得し、`revoke_identity_device_v1(authenticated_user_id, device_id)`を呼ぶ。Functionはdevice row、linked Sessions、ACTIVE Challengesをnon-locking pre-readした後、Identity、User-quota、Device-keyの順にlockする。次にlinked Session rowsを`session_id`昇順で全て`FOR UPDATE`、mapping、Challenge rowsを`challenge_id`昇順、ownership、deviceの順にlockして全locator/authority値を再検証する。Lock後に対象deviceの全ACTIVE Challengeとlinked Sessionを再queryし、pre-readにないrowがあれば同じorderでlockする。必要なlockを取得した後、`v_db_now := pg_catalog.transaction_timestamp()`を一度だけ取得し、expiry比較とlifecycle timestampに再利用する。Attestation advisory lockは後順位取得になるためRevokeでは取得しない。

1. Deviceの`canonical_user_id`がactorと一致しなければreject。VERIFIED deviceではさらにactorが`member_ownership.canonical_user_id`と一致することを要求する。PENDING deviceはownership未作成でもactor自身がrevokeできる。
2. PENDING -> REVOKED、VERIFIED -> REVOKEDを許可する。紐づくACTIVE ChallengeとSessionは、対応するexpiryが`<= v_db_now`ならそれぞれ`EXPIRED/TTL_EXPIRED`へ、それ以外ならChallengeを`CONSUMED/DEVICE_REVOKED`、Sessionを`REVOKED/DEVICE_REVOKED`へ遷移して再利用を止める。期限切れPENDINGは同じ`v_db_now`で`REVOKED/expired_pending`へ遷移し、device revoke自体は継続する。
3. REVOKED の再 revoke は同じ result を返す idempotent success。
4. `primary_device_id`、ownership、Claims、Social Binding を削除・変更しない。
5. last VERIFIED device の revoke 後、computed Identity State は UNCLAIMED。

成功は新規revoke/idempotent replayとも`200`で、bodyは`device_id`、`public_id`、`device_status = REVOKED`、`revoke_replayed`、`identity_state`の5 fieldsだけである。Missingまたはdifferent ownerは同じ`404 RESOURCE_NOT_FOUND`。

Claim x Revoke は同じ Identity lock で直列化する。Claim が先なら Revoke は VERIFIED -> REVOKED、Revoke が先なら Claim は PENDING condition で reject する。

### 10.5 RPC signatures と outcome mapping

Externally executable function signatureは次に固定する。UUID actorはFUSOU-WEBがsessionから注入し、client bodyから受け取らない。

```text
issue_attestation_session_v1(UUID, BYTEA)
issue_identity_challenge_v1(UUID, UUID, BYTEA, TEXT, TEXT, BYTEA, public.fusou_uint64,
  public.fusou_uint64, BYTEA, TEXT, TEXT, TEXT, BYTEA, BYTEA, BYTEA,
  JSONB, JSONB)
get_claim_challenge_v1(UUID, UUID)
consume_invalid_challenge(UUID, UUID)
claim_verified_device_v1(UUID, UUID)
revoke_identity_device_v1(UUID, UUID)
bind_social_identity_v1(UUID, UUID)
get_dataset_token_subject_v1(UUID, UUID)
validate_dataset_credential_state_v1(UUID, UUID)
issue_dataset_upload_v1(UUID, UUID, TEXT, BYTEA, BIGINT)
consume_dataset_upload_v1(UUID, UUID, UUID, TEXT, BYTEA, BIGINT, BYTEA)
list_expired_identity_artifact_ids_v1(INTEGER)
expire_identity_artifact_v1(UUID)
list_expired_attestation_session_ids_v1(INTEGER)
expire_attestation_session_v1(UUID)
```

`issue_attestation_session_v1`の2 argumentsはSection 7.1.1の記載順、`issue_identity_challenge_v1`の17 argumentsはSection 7.2の記載順である。Cleanup functionsはSession単独のexpiryを処理するために分離し、全functionはnamed argumentsで呼び、PostgREST schema cacheにexact signature以外がないことをpostflightで確認する。

上記のexternally executable function listはclosed setであり、`get_or_create_public_id(TEXT)`はその一覧に含めない。これは`fusou_identity_owner`だけが実行できるinternal helperで、PostgREST RPC、HTTP endpoint、`service_role`の直接EXECUTEとして公開してはならず、既存のSECURITY DEFINER entry functionからschema-qualifiedに呼び出す。

Business outcomeは次のclosed setである。

```text
OK
OK_NEW
OK_REPLAY
INVALID_SIGNATURE_CONSUMED
UPLOAD_TOKEN_NOT_ACTIVE
UPLOAD_TOKEN_REPLAY
RESOURCE_NOT_FOUND
ATTESTATION_IN_USE
ATTESTATION_ALREADY_USED
ATTESTATION_ALREADY_CLAIMED
DEVICE_CHALLENGE_IN_USE
DEVICE_KEY_ALREADY_REGISTERED
PENDING_DEVICE_LIMIT
VERIFIED_DEVICE_LIMIT
EXISTING_VERIFIED_OWNER_CONFLICT
CHALLENGE_EXPIRED
CHALLENGE_NOT_ACTIVE
SESSION_NOT_ACTIVE
DEVICE_NOT_PENDING
SOCIAL_IDENTITY_REQUIRED
SOCIAL_BINDING_REQUIRED
```

Migrationは上記literalを記載順で持つ`public.identity_outcome_v1` enumを作成する。`OK_NEW`はHTTP 201、`OK`/`OK_REPLAY`は200、`INVALID_SIGNATURE_CONSUMED`は`401 INVALID_DEVICE_SIGNATURE`、`RESOURCE_NOT_FOUND`は404、`CHALLENGE_EXPIRED`は410、`PENDING_DEVICE_LIMIT`/`VERIFIED_DEVICE_LIMIT`は429、`UPLOAD_TOKEN_NOT_ACTIVE`/`UPLOAD_TOKEN_REPLAY`と残るbusiness outcomeは409へ写像する。Web-side auth/signature/parser errorsはSection 7.1のcodeを使う。DB constraint violation、unexpected row count、authority column mismatchはraiseし、FUSOU-WEBはdetailなしの500へ写像する。

DB outcomeからHTTPへの写像は次のclosed tableを使用し、functionごとの別解釈を許可しない。Success bodyは各operationのexact field contract、error bodyはSection 7.1の共通error contractを使用する。

| DB outcome | HTTP status | HTTP body/code |
| --- | ---: | --- |
| `OK_NEW` | 201 | operation-specific success body |
| `OK` | 200 | operation-specific success body |
| `OK_REPLAY` | 200 | operation-specific replay success body |
| `INVALID_SIGNATURE_CONSUMED` | 401 | `INVALID_DEVICE_SIGNATURE` |
| `UPLOAD_TOKEN_NOT_ACTIVE` | 409 | `UPLOAD_TOKEN_NOT_ACTIVE` |
| `UPLOAD_TOKEN_REPLAY` | 409 | `UPLOAD_TOKEN_REPLAY` |
| `RESOURCE_NOT_FOUND` | 404 | `RESOURCE_NOT_FOUND` |
| `ATTESTATION_IN_USE` | 409 | `ATTESTATION_IN_USE` |
| `ATTESTATION_ALREADY_USED` | 409 | `ATTESTATION_ALREADY_USED` |
| `ATTESTATION_ALREADY_CLAIMED` | 409 | `ATTESTATION_ALREADY_CLAIMED` |
| `DEVICE_CHALLENGE_IN_USE` | 409 | `DEVICE_CHALLENGE_IN_USE` |
| `DEVICE_KEY_ALREADY_REGISTERED` | 409 | `DEVICE_KEY_ALREADY_REGISTERED` |
| `PENDING_DEVICE_LIMIT` | 429 | `PENDING_DEVICE_LIMIT` |
| `VERIFIED_DEVICE_LIMIT` | 429 | `VERIFIED_DEVICE_LIMIT` |
| `EXISTING_VERIFIED_OWNER_CONFLICT` | 409 | `EXISTING_VERIFIED_OWNER_CONFLICT` |
| `CHALLENGE_EXPIRED` | 410 | `CHALLENGE_EXPIRED` |
| `CHALLENGE_NOT_ACTIVE` | 409 | `CHALLENGE_NOT_ACTIVE` |
| `DEVICE_NOT_PENDING` | 409 | `DEVICE_NOT_PENDING` |
| `SOCIAL_IDENTITY_REQUIRED` | 409 | `SOCIAL_IDENTITY_REQUIRED` |
| `SOCIAL_BINDING_REQUIRED` | 409 | `SOCIAL_BINDING_REQUIRED` |
| `SESSION_NOT_ACTIVE` | 409 | `SESSION_NOT_ACTIVE` |

`INVALID_SIGNATURE_CONSUMED`だけはWeb-side error code `INVALID_DEVICE_SIGNATURE`へ変換し、それ以外のnon-OK outcomeは同名のUPPER_SNAKE_CASE error codeを使う。`OK`系のsuccess bodyは各APIのexact field contractを使う。DB constraint violation、unexpected row count、authority column mismatchはbusiness outcomeではなくraiseし、FUSOU-WEBはdetailなしの`500 INTERNAL_ERROR`へ写像する。

各entry functionのbusiness outcome許容集合は次で固定する。ここにないshape/authentication failure、invariant corruption、unexpected SQL errorはoutcomeを返さずraiseし、`500 INTERNAL_ERROR`へ写像する。`validate_dataset_credential_state_v1`、`list_expired_identity_artifact_ids_v1`、`list_expired_attestation_session_ids_v1`はそれぞれboolean resultまたは`SETOF UUID`だけを返すため、このenum集合には含めない。

| Entry function | Allowed outcome values |
| --- | --- |
| `issue_attestation_session_v1` | `OK_NEW`, `RESOURCE_NOT_FOUND`, `DEVICE_KEY_ALREADY_REGISTERED` |
| `issue_identity_challenge_v1` | `OK_NEW`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `ATTESTATION_IN_USE`, `ATTESTATION_ALREADY_USED`, `ATTESTATION_ALREADY_CLAIMED`, `CHALLENGE_EXPIRED`, `SESSION_NOT_ACTIVE`, `DEVICE_CHALLENGE_IN_USE`, `DEVICE_KEY_ALREADY_REGISTERED`, `PENDING_DEVICE_LIMIT`, `EXISTING_VERIFIED_OWNER_CONFLICT` |
| `get_claim_challenge_v1` | `OK`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `CHALLENGE_EXPIRED`, `SESSION_NOT_ACTIVE`, `CHALLENGE_NOT_ACTIVE` |
| `consume_invalid_challenge` | `INVALID_SIGNATURE_CONSUMED`, `RESOURCE_NOT_FOUND`, `CHALLENGE_EXPIRED`, `SESSION_NOT_ACTIVE`, `CHALLENGE_NOT_ACTIVE` |
| `claim_verified_device_v1` | `OK_NEW`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `ATTESTATION_ALREADY_CLAIMED`, `CHALLENGE_EXPIRED`, `SESSION_NOT_ACTIVE`, `CHALLENGE_NOT_ACTIVE`, `DEVICE_NOT_PENDING`, `EXISTING_VERIFIED_OWNER_CONFLICT`, `VERIFIED_DEVICE_LIMIT` |
| `revoke_identity_device_v1` | `OK`, `OK_REPLAY`, `RESOURCE_NOT_FOUND` |
| `bind_social_identity_v1` | `OK`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `SOCIAL_IDENTITY_REQUIRED` |
| `get_dataset_token_subject_v1` | `OK`, `RESOURCE_NOT_FOUND`, `SOCIAL_BINDING_REQUIRED` |
| `issue_dataset_upload_v1` | `OK_NEW`, `RESOURCE_NOT_FOUND`, `SOCIAL_BINDING_REQUIRED` |
| `consume_dataset_upload_v1` | `OK`, `UPLOAD_TOKEN_NOT_ACTIVE`, `UPLOAD_TOKEN_REPLAY` |
| `expire_identity_artifact_v1` | `OK`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `SESSION_NOT_ACTIVE`, `CHALLENGE_NOT_ACTIVE` |
| `list_expired_attestation_session_ids_v1` | no business outcome; `SETOF UUID` |
| `expire_attestation_session_v1` | `OK`, `OK_REPLAY`, `RESOURCE_NOT_FOUND`, `SESSION_NOT_ACTIVE` |

`OK_NEW`は作成・初回遷移、`OK`は単一の成功結果、`OK_REPLAY`は同一authorityの再取得・再実行にだけ使用する。Functionはこの表にない別のoutcomeを返してはならない。

Entry functionの`RETURNS TABLE`列順と型は次である。`outcome`は`public.identity_outcome_v1`、`identity_state`/status/typeは各Sectionのclosed text enum、時刻は`TIMESTAMPTZ`、digest/key/nonceは`BYTEA`である。

```text
issue_attestation_session_v1:
  outcome, session_id UUID, device_id UUID, binding_nonce BYTEA,
  binding_value TEXT, expires_at TIMESTAMPTZ
issue_identity_challenge_v1:
  outcome, attestation_session_id UUID, binding_nonce BYTEA, binding_value TEXT,
  challenge_id UUID, challenge_nonce BYTEA, expires_at TIMESTAMPTZ,
  device_id UUID, tlsn_attestation_id BYTEA, verified_member_id TEXT,
  public_id UUID, challenge_replayed BOOLEAN
get_claim_challenge_v1:
  outcome, attestation_session_id UUID, binding_nonce BYTEA, binding_value TEXT,
  challenge_id UUID, api_member_id TEXT, public_id UUID,
  canonical_user_id UUID, device_id UUID, device_public_key BYTEA,
  tlsn_attestation_id BYTEA, challenge_nonce BYTEA,
  notary_time public.fusou_uint64, result_time public.fusou_uint64,
  profile_sha256 BYTEA, server_identity TEXT, verifier_key_id TEXT,
  notary_key_id TEXT, verifier_result_sha256 BYTEA,
  request_transcript_sha256 BYTEA, response_transcript_sha256 BYTEA,
  request_ranges JSONB, response_ranges JSONB, proof_purpose TEXT,
  challenge_status TEXT, terminal_reason TEXT, expires_at TIMESTAMPTZ
consume_invalid_challenge: outcome
claim_verified_device_v1:
  outcome, claim_id UUID, device_id UUID, public_id UUID,
  identity_state TEXT, claim_type TEXT, claim_replayed BOOLEAN,
  currently_authorized BOOLEAN
revoke_identity_device_v1:
  outcome, device_id UUID, public_id UUID, device_status TEXT,
  revoke_replayed BOOLEAN, identity_state TEXT
bind_social_identity_v1:
  outcome, public_id UUID, social_user_id UUID, identity_state TEXT,
  binding_replayed BOOLEAN
get_dataset_token_subject_v1:
  outcome, device_id UUID, public_id UUID, verifier_key_id TEXT,
  notary_key_id TEXT
validate_dataset_credential_state_v1:
  authorized BOOLEAN, verifier_key_id TEXT, notary_key_id TEXT
issue_dataset_upload_v1:
  outcome, ingest_id UUID, nonce BYTEA, expires_at TIMESTAMPTZ
consume_dataset_upload_v1:
  outcome, ingest_id UUID, consumed_at TIMESTAMPTZ
list_expired_identity_artifact_ids_v1: SETOF UUID
expire_identity_artifact_v1: outcome
list_expired_attestation_session_ids_v1: SETOF UUID
expire_attestation_session_v1: outcome
```

`get_claim_challenge_v1`はread-onlyで、expiry判定前に`v_db_now := pg_catalog.transaction_timestamp()`を一度だけ取得し、次の順序とoutcomeだけを返す。`OK`/`OK_REPLAY`ではSessionから再計算した`binding_value`を含むSession ID/nonceを返し、non-OKでは全authority fieldsをNULLにする。

```text
missingまたはdifferent owner                         -> RESOURCE_NOT_FOUND
actor-owned ACTIVE、linked Session ACTIVE、Challenge expires_at <= v_db_now -> CHALLENGE_EXPIRED
actor-owned ACTIVE、linked Session EXPIRED/REVOKED または Session expires_at <= v_db_now -> SESSION_NOT_ACTIVE
actor-owned ACTIVE、linked device pending_expires_at <= v_db_now -> SESSION_NOT_ACTIVE
actor-owned ACTIVEかつunexpired                       -> OK + authority fields
actor-owned CONSUMED/CLAIM_ACCEPTEDかつlinked Claim   -> OK_REPLAY + authority fields
actor-owned CONSUMED/INVALID_SIGNATURE|DEVICE_REVOKED -> CHALLENGE_NOT_ACTIVE
actor-owned EXPIRED                                   -> CHALLENGE_NOT_ACTIVE
```

`OK_REPLAY`ではlinked Claimのactor/device/public/AttestationがChallengeとexact一致しなければcorruptionとしてraiseする。Non-OK時はauthority fieldsを全てNULLにする。Dataset subject/validation functionsは当該deviceのunique accepted Claimをjoinして両key IDを返す。Unauthorized時は`authorized=false`またはnon-OKとしkey IDsはNULLにする。ほかのfunctionは`outcome`を第1列とするnamed composite resultを返し、non-OK時のauthority/result columnsはすべてNULLとする。

`issue_dataset_upload_v1(device_id, public_id, route_id, content_sha256, content_size)`はdeviceをpre-readし、Identity、mapping、ownership、deviceの順にlockしてSection 11.2のDB root条件を再検証する。Upload issuanceはPENDING/VERIFIED数またはdevice key lifecycleを変更しないため、User-quota/Device-key advisory lockは取得しない。Success時は`v_db_now`をtransaction-wideなDB timestampとして使用し、`v_ledger_created_at = date_trunc('second', v_db_now)`、`expires_at = v_ledger_created_at + interval '1 hour'`でSection 9.8 rowをINSERTして`OK_NEW`を返す。Client指定ingest ID/nonce/timeを受け取らない。

`consume_dataset_upload_v1(ingest_id, device_id, public_id, route_id, content_sha256, content_size, nonce)`はledgerをnon-locking pre-readしてlocatorを得た後、Identity、Device-key、mapping、ownership、device、ledgerの順にlockし、DB root条件と7 immutable token fieldsを再検証する。Missingまたはimmutable field mismatchは`UPLOAD_TOKEN_NOT_ACTIVE`、`consumed_at IS NOT NULL`はexpiry後であっても先に評価して`UPLOAD_TOKEN_REPLAY`、未消費で`expires_at <= v_db_now`なら`UPLOAD_TOKEN_NOT_ACTIVE`とする。残るactive rowは`v_consumed_at = date_trunc('milliseconds', v_db_now)`を1回取得し、`UPDATE ... SET consumed_at=v_consumed_at WHERE ingest_id=$1 AND consumed_at IS NULL AND expires_at > v_db_now`のaffected row exactly 1で`OK`、`ingest_id`、`v_consumed_at`を返す。CASのaffected rowが0なら、lock済みrowを再確認して`consumed_at IS NOT NULL`なら`UPLOAD_TOKEN_REPLAY`、`expires_at <= v_db_now`なら`UPLOAD_TOKEN_NOT_ACTIVE`を返し、両方を満たさない場合はinvariant corruptionとしてraiseする。Non-OK時は後2列をNULLにする。CAS transactionをcommitしてから最初のQueue/storage mutationを行う。

CAS commit後のexternal failureでも`consumed_at`をrollback/NULL化せず、same Upload Token replayを拒否する。ClientはStage 1から新しい`ingest_id`を取得する。これはduplicate external mutationよりavailability lossを選ぶsecurity ruleであり、同じ`ingest_id`のserver/Queue retryはSection 11.4のidempotent sink contractだけが許可する。

`list_expired_identity_artifact_ids_v1(INTEGER)`はread-only、`RETURNS SETOF UUID`で、limitは1..100、ID以外を返さない。関数は`v_db_now := pg_catalog.transaction_timestamp()`を一度だけ取得し、`claim_challenges`、linked `attestation_sessions`、`user_devices`をjoinして、`ACTIVE`かつ`expires_at <= v_db_now`のChallenge、またはlinked Sessionが`ACTIVE`かつ`expires_at <= v_db_now`、または`PENDING`かつ`pending_expires_at <= v_db_now`のdeviceに紐づくChallengeを候補とする。複数の retained Challengeが同じdeviceに紐づく場合は`challenge_id`最小の1件だけを返し、結果全体は`challenge_id`昇順とする。したがって、Session expiry、invalid signature、またはdevice revokeでChallengeがusableでなくなった後も、期限切れPENDINGをcleanupできる。Cleanup schedulerは`list_expired_identity_artifact_ids_v1(100)`でopaque Challenge IDsを取得し、各IDを別transactionの`expire_identity_artifact_v1(UUID)`へ渡す。結果が空になるまでこのbatch処理を繰り返し、1 transactionで複数identityを処理しない。後者は`outcome`だけのtyped resultを返し、Attestation、Identity、User-quota、Device-key、Session、mapping、Challenge、deviceの順にlockする。lock後に選択されたChallenge rowと当該deviceの全ACTIVE Challenge rowのunionを`challenge_id`昇順で`FOR UPDATE`し、linked Session rowとdevice rowも`FOR UPDATE`する。期限切れACTIVE ChallengeとそのACTIVE Sessionを`EXPIRED/TTL_EXPIRED`へ、期限切れPENDINGを`REVOKED/expired_pending`へ同じ`v_db_now`で遷移する。既に別transactionが遷移済みなら`OK_REPLAY`、対象が存在しなければ`RESOURCE_NOT_FOUND`、対象Challengeがterminalでlinked deviceも未期限なら`CHALLENGE_NOT_ACTIVE`を返す。Challenge rowの削除は行わず、`UNIQUE(tlsn_attestation_id)`によるlifecycle全体の一回性を維持する。

`list_expired_attestation_session_ids_v1(INTEGER)`はread-only、`RETURNS SETOF UUID`で、Challengeにまだ結び付いていない`ACTIVE` Sessionのうち`expires_at <= v_db_now`だけを`session_id`昇順で返す。Cleanup schedulerはこのIDを別transactionの`expire_attestation_session_v1(UUID)`へ渡し、ChallengeのないSessionも漏れなくterminal化する。後者はDevice-key advisory lock、Session rowの順にlockし、再queryでChallengeが存在しないことを確認する。対象SessionがACTIVEかつ期限切れなら`EXPIRED/TTL_EXPIRED`へ遷移して`OK`、既にEXPIREDなら`OK_REPLAY`、CONSUMED/REVOKEDまたは未期限なら`SESSION_NOT_ACTIVE`、missingなら`RESOURCE_NOT_FOUND`を返す。Session rowは削除しない。

---

## 11. Social Binding、JWT、Telemetry Attribution

### 11.1 Explicit Social Binding

`POST /api/identity/v1/social-bindings`はBearer認証済みでbody `{ "device_id": "<uuidv4>" }`だけを受ける。v1 social providerはrepositoryのlogin allowlistと同じexact `google`である。FUSOU-WEBとDB functionの両方が、actor userに`auth.identities.provider = 'google'`のrowがあることを確認する。

FUSOU-WEBは`bind_social_identity_v1(authenticated_user_id, device_id)`を1回呼ぶ。Functionはdeviceをpre-readしてIdentity、mapping、ownership、deviceの順にlockし、次を要求する。Social BindingはPENDING/VERIFIED数とdevice key lifecycleを変更しないため、User-quota/Device-key advisory lockは取得しない。

1. Actor user = ownership canonical user。
2. 入力`device_id`自身がactor/public IDに属するcurrent VERIFIED deviceである。
3. `social_user_id` が NULL または actor と同値。

成功時に `member_ownership.social_user_id` を actor へ設定し、`web_user_member_map` projection を upsert する。同値再実行はidempotent success、different userまたはdeviceは`404 RESOURCE_NOT_FOUND`。新規/idempotentとも`200`で、bodyは`public_id`、`social_user_id`、`identity_state = SOCIAL_ACCOUNT_BOUND`、`binding_replayed`の4 fieldsだけである。v1にunbind/transfer APIを作らない。

### 11.2 Dataset JWT v1

`POST /api/identity/v1/dataset-tokens`はBearer認証済みでbody `{ "device_id": "<uuidv4>" }`だけを受ける。FUSOU-WEBは`get_dataset_token_subject_v1(authenticated_user_id, device_id)`を呼ぶ。Functionはdeviceをpre-readし、Identity、mapping、ownership、deviceの順にlockして、Section 11.2のlive-root条件とactor一致を再検証する。これはread-only subject lookupでありPENDING/VERIFIED数またはdevice key lifecycleを変更しないため、User-quota/Device-key advisory lockは取得しない。DB失敗は`404 RESOURCE_NOT_FOUND`または`409 SOCIAL_BINDING_REQUIRED`であり、projectionを参照しない。DB success後、FUSOU-WEBは返されたNotary/Verifier key IDsをcurrent registriesへ照合する。ACTIVE/VERIFY_ONLYだけを許可し、RETIRED、missing、REVOKEDは`409 IDENTITY_TRUST_REVOKED`としてtokenを発行しない。RETIREDを許可するのはaccepted Claimのexact replayだけである。

成功時だけFUSOU-WEBがEd25519署名を行い、`200`で次の3 fieldsだけを返す。

```json
{
  "dataset_token": "<compact-JWS>",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

`token_type`はresponse metadataとしての表示であり、`X-Dataset-Token`のheader grammarを変更しない。Dataset Token headerは`Bearer` scheme prefixなしのraw compact JWSだけを受け付ける。

Protected header は次の3 fieldsだけで、この順序、UTF-8、whitespaceなしでserializeする。

```json
{"alg":"EdDSA","typ":"JWT","kid":"<active-key-id>"}
```

Payloadのfieldは次の9個だけで、この順序、UTF-8、whitespaceなしでserializeする。

```json
{
  "iss": "fusou-identity",
  "aud": "fusou-upload",
  "kid": "<same-active-key-id>",
  "sub": "<device_id>",
  "dataset_id": "<public_id>",
  "typ": "dataset",
  "credential_version": 1,
  "iat": 1788134400,
  "exp": 1788220800
}
```

`sub = device_id`、`dataset_id = public_id`。DB success後、署名前にFUSOU-WEBがtrusted UTC wall clockを1回だけ読み、そのmillisecond値を`v_issuance_time_ms`とする。`iat = floor(v_issuance_time_ms / 1000)`、`exp = iat + 86400`であり、JSON Numberのcanonical non-negative safe integerだけを許可する。Header/Payload `kid` は一致しなければならない。Unknown/duplicate field、escape、whitespace、noncanonical Numberを拒否し、parse後の再serialize bytesがdecoded segment bytesと一致しなければならない。

Compact JWSは3個のnon-empty strict unpadded base64url segmentsだけである。Signature inputは第1 segment、ASCII dot、第2 segmentのASCII bytesであり、signatureはSection 5.3と同じstrict RFC 8032 pure Ed25519 profileの64 bytesである。Public keyのnoncanonical point、identity/small-order/torsion component、signatureのnoncanonical `R`または`S >= L`を拒否する。`alg` confusion、`none`、HS256、embedded `jwk`/`jku`/`x5u`、unknown `kid`を拒否する。

Validatorはtrusted UTC whole seconds `now`に対して`iat <= now + 60`、`exp > now`、`exp - iat = 86400`を要求する。この60秒future-skewは全validatorで共通のv1 acceptance ruleであり、P0-16は`iat = now + 60`のaccept、`iat = now + 61`のreject、expiry境界のgolden fixtureと、各runtimeが同じruleを使う証跡を含まなければならない。`iss`、`aud`、`typ`、`credential_version`はexact matchである。

Token issuanceと全validationでrootsをlive lookupし、次を要求する。

1. Device が token `sub` と一致し status VERIFIED、`revoked_at IS NULL`。
2. Device public ID が token `dataset_id` と一致。
3. Ownership canonical user が device canonical user と一致。
4. Ownership social user が canonical user と一致。
5. Mapping に public ID が存在。
6. Deviceのunique accepted Claimが存在し、その`verifier_key_id`と`notary_key_id`がcurrent registryに存在してREVOKEDではない。

`primary_device_id` と projection を authorization に使用しない。旧tokenはsignature algorithm、claim shape、`kid`、credential versionのいずれかで拒否し、upgrade/refreshしない。

Dataset TokenはWorkers Fetch APIが公開する正規化後の単一`request.headers.get("X-Dataset-Token")` valueをraw compact JWSとして受け付ける。Observable valueの`Bearer` prefix、comma、whitespaceを拒否し、query/body/cookie credentialを受け付けない。Outer OWSとduplicate foldingはSection 7.1と同じplatform境界/testに従う。署名・strict parser・JWT key window検証後に、accepting serviceは`validate_dataset_credential_state_v1(device_id, public_id)`を1回呼ぶ。Functionはmappingからmember IDをpre-readしIdentity lockを取得してからmapping、ownership、device、当該deviceのunique Claimを再読し、上記6条件のDB部分と両attestation key IDsを単一statement snapshotで返す。Serviceは同じrequest内でcurrent Notary/Verifier registriesを照合し、ACTIVE/VERIFY_ONLYだけを許可、RETIRED、missing、REVOKEDは拒否する。Failure responseは理由を区別しない`401 INVALID_DATASET_TOKEN`。Root/key lookup結果をrequest間でcacheしない。

二段階uploadはStage 1とStage 2の両方でDataset Tokenを要求する。Stage 1はlive validation後に`issue_dataset_upload_v1`を呼び、同じDataset JWT active Ed25519 keyをdistinct `typ`/`aud`でdomain separateしてsingle-use `X-Upload-Token`を発行する。Headerとpayloadは次のexact canonical JSONであり、Dataset JWTと同じstrict compact JWS規則を使う。

```json
{"alg":"EdDSA","kid":"<active-key-id>","typ":"FUSOU-UPLOAD-V1"}
```

```json
{"aud":"fusou-upload-stage2","content_sha256":"<strict-base64url-32>","content_size":123,"device_id":"<uuidv4>","exp":1788138000,"iat":1788134400,"ingest_id":"<uuidv4>","iss":"fusou-identity","nonce":"<strict-base64url-32>","public_id":"<uuidv4>","route":"<canonical-route-id>","typ":"upload","version":1}
```

Upload Token header/payloadのproperty orderは上記の表示順をwire contractとして固定する（payloadでは`version`が最後）。Serializerはpropertyを追加、削除、並替えしてはならず、Dataset JWTのpayload orderとは別のこのupload payload orderを使用する。

`iat`はledger `created_at`のwhole second、`exp=iat+3600`でledger `expires_at`のwhole secondと一致する。ledger `created_at`はSection 9.8/10.5のとおり`date_trunc('second', v_db_now)`なので、fractional `v_db_now`でもtoken expiryとledger expiryはexact一致する。`content_size`は0以上のJSON safe integerかつroute上限以下、routeはSection 11.4の6値だけである。Unknown/duplicate field、noncanonical JSON/base64url/number、header/payload `kid`不一致を拒否する。Upload TokenをDataset credentialの代用にしない。

Stage 2の処理順は、全6 routeで次の一つだけを使用する。

```text
1. request framing: normalized single-value credential headers、Content-Length/
  Transfer-Encoding grammar、body-size limit、content decodingを検証する。
2. stage detection: X-Upload-Token の normalized presence だけで Stage 2 と
  判定する。空値・複数値は Upload Token validation の失敗として扱う。
3. Dataset Token validation: 同じ X-Dataset-Token の signature/time/subject
  一致、current registry、live root/key lookup を再実行する。失敗時は401で
  DBを変更しない。
4. Upload Token validation: compact-JWS、current JWT registry、発行時刻・有効
  期限、route/device/public/ingest/nonce claim の形式を検証する。失敗時は
  409または401の規定された error code でDBを変更しない。
5. exact input validation: Stage 2 execution input bytesを再serializeせず読み、
  tokenのcontent_sizeとの完全一致、SHA-256との完全一致、reserved-field/
  duplicate-key detector、route-owned schema、token claimとの一致を検証する。
6. CAS: 7 immutable token fieldsを`consume_dataset_upload_v1`へ渡し、ledger
  rowの`consumed_at IS NULL` CASを行う。既消費なら先に replay、期限切れなら
  not-activeを返す。
7. commit: CAS transactionをcommitし、成功した`consumed_at`を固定する。commit
  前に外部 Queue/storage mutationを行わない。
8. sink convergence: route manifestで固定したrequired sinkを同じ`ingest_id`で
  insertまたはexact-match no-opへ収束させ、全sink成功後だけ2xxを返す。
```

Upload Tokenの`kid`はStage 2検証時にcurrent JWT registryで`ACTIVE`または`VERIFY_ONLY`であり、tokenの発行時刻・有効期限window内でなければならない。発行後に`VERIFY_ONLY`へ移行したkeyのtokenはこの条件で受理し、`RETIRED`、`REVOKED`、missing keyは拒否する。Stage 1後にdevice、ownership、Social Binding、JWT key、Notary key、Verifier keyのいずれかが失効した場合、Stage 2は401でledger consumeも書込みも0件とする。Upload Token replayは409で拒否する。

二段階uploadのHTTP境界は、Section 11.4の6つの同一POST endpointについて次に固定する。Stage判定は`X-Upload-Token` headerのnormalized single-valueが**存在するかどうかだけ**で行い、query、body、cookie、別headerでStageを選択してはならない。

```text
Stage 1 (prepare)
  Request: POST <one of the six Section 11.4 paths>
  Headers: exactly one X-Dataset-Token; X-Upload-Token absent
  Body: route-owned preparation JSON with exactly the route schema fields plus
  content_sha256 (strict base64url, decoded 32 bytes) and
  content_size (non-negative JSON safe integer)
  Server: route path selects the closed route ID; device/public/user and all
    authority values come from the live Dataset Token/root lookup
  DB: issue_dataset_upload_v1(UUID, UUID, TEXT, BYTEA, BIGINT)
  Success: HTTP 201 and exactly
           {"upload_token":"<compact-JWS>","ingest_id":"<uuidv4>","expires_at":"<YYYY-MM-DDTHH:MM:SS.sssZ>"}

Stage 2 (execute)
  Request: POST <the same endpoint path used by Stage 1>
  Headers: exactly one X-Dataset-Token and exactly one X-Upload-Token
  Body: route-owned execution bytes; common code hashes the exact Stage 2
    input bytes before server envelope or compression
  Server: executes the exact eight-step Stage 2 sequence below; route schema
    validation is part of exact input validation and precedes CAS
  DB: consume_dataset_upload_v1(UUID, UUID, UUID, TEXT, BYTEA, BIGINT, BYTEA)
  Success: route-owned 2xx only after CAS commit and convergence of every
    required sink fixed by the target route manifest
```

`content_sha256`と`content_size`は、HTTP transfer framingとrouteが明示的に許可するcontent decoding後、route schema parse、server envelope生成、compressionより前の、Stage 2が受け取るexecution input byte列だけを対象とする。Common codeはそのbytesを再serializeせずhashし、Stage 1のledger/Upload TokenとStage 2の再計算値を一致させる。R2 envelopeの`content_sha256`はこのStage 2 input digestを格納するfieldであり、envelope自身（またはgzip wrapper）のdigestではない。したがって、envelopeをuncompressed canonical bodyとして保存する場合も、digestの入力はenvelope外のStage 2 input bytesである。

各routeのrequired sinkは、次のtarget route manifest tableで定めるQueue、Turso、D1、R2のexact subsetだけであり、全sinkを暗黙にrequiredとはしない。ここでSection 11.4に列挙したchecked-in handler/schema pathは、現行legacy implementationを authority とする意味ではなく、target implementationで置換される route contract の ownership path である。Required sink 自体は現行コードから推測せず、この表とP0-17 manifestへ固定する。Successはそのsubsetの各sinkがinsertまたは同一値のexact-match no-opを返した場合だけとする。CAS後にrequired sinkが収束できない場合は共通の`500 INTERNAL_ERROR`を返し、ledgerの`consumed_at`は保持する。Server/Queueのretry/recoveryは同じ`ingest_id`で不足sinkだけを再試行する。Clientの同じUpload Token再送は許可せず、再送を必要とする場合はStage 1から新しい`ingest_id`を取得する。

Stage 1のroute-specific preparation/execution fieldsはSection 11.4で指定したowning schemaがcanonicalであり、identity layerはそれらをauthorityとして解釈しない。`route`、`device_id`、`public_id`、`ingest_id`、nonce、timestampsをclient bodyから受け取らず、token/endpoint/ledgerから復元する。Stage 1/2でDataset Tokenがmissing、複数、invalid、expired、root/key mismatchなら、Stage判定後に`401 INVALID_DATASET_TOKEN`としてDBを変更しない。`X-Upload-Token`が存在するStage 2で空値または複数値なら`409 UPLOAD_TOKEN_NOT_ACTIVE`としてDBを変更しない。

### 11.3 JWT key registry と rotation

FUSOU-WEBのprivate keyは`createEnvContext()`と`getEnv()`だけで読むsecret `DATASET_JWT_ED25519_PRIVATE_JWK`、active IDは`DATASET_JWT_ACTIVE_KID`である。Direct `process.env` readとclient HTMLへの埋込みを禁止する。Private JWKはexact `kty=OKP`、`crv=Ed25519`、RFC 8037の32-byte Ed25519 seedである`d`、32-byte `x`、registryと一致する`kid`だけを持つ。Startup時に`d`からpublic keyを導出し、JWK `x`、registry `x`、active `kid`の4値をconstant-time比較して不一致ならfail closedとする。

Public registry artifact `packages/fusou-auth/keys/dataset-jwt-public-keys-v1.json`はRFC 8785 canonical JSONの次のexact shapeを持つ。Top-level unknown/duplicate field、entry unknown/duplicate field、duplicate `kid`/`x`、keysの`kid`昇順以外を拒否する。

```json
{"keys":[{"kid":"dataset-2026-09","not_after":1790899260,"not_before":1788134400,"status":"ACTIVE","stop_issuing_at":1790812800,"x":"<strict-unpadded-base64url-32-bytes>"}],"version":1}
```

`kid`は`^[A-Za-z0-9._-]{1,64}$`、keysは`kid`のASCII bytewise lexicographic昇順、timesはnon-negative safe-integer NumericDate、statusは`ACTIVE | VERIFY_ONLY | RETIRED | REVOKED`である。`not_before < stop_issuing_at`、`stop_issuing_at + 86460 <= not_after`を要求する。Issuer artifactにはexactly one ACTIVE keyがあり、`DATASET_JWT_ACTIVE_KID`と一致し、`not_before <= iat < stop_issuing_at`の間だけ使用する。ValidatorはACTIVEとVERIFY_ONLYだけをverification keyとして扱い、trusted `now >= not_before`かつ`not_before <= iat < stop_issuing_at`かつ`exp <= not_after`の場合だけ受理する。RETIREDは通常失効後の不可逆tombstone、REVOKEDはcompromise用の不可逆・遡及失効であり、どちらもtokenを拒否する。

通常rotationは次のtwo-generation sequenceに固定する。

1. 全validatorへのR1配布完了より後のactivation instant `A`を固定する。R1はOld=`ACTIVE`、new=`VERIFY_ONLY`、New `not_before=A`とし、new private keyはissuerへ置かない。
2. `now < A`の間にR1を全validatorとissuerへdeployし、old fixtureのacceptと、cryptographically validなnew fixtureのpre-activation rejectを確認する。Issuerはoldを継続使用する。
3. 全validatorのR1反映を確認し`now >= A`になってからR2を作る。Old=`VERIFY_ONLY`、new=`ACTIVE`。IssuerへR2、new private key、`DATASET_JWT_ACTIVE_KID=new.kid`をatomic deployする。先行validatorのR1も`now >= A`ならnew VERIFY_ONLY keyを検証できるため停止しない。
4. R2を全validatorへdeployする。Old tokenはold `not_after`まで検証できる。
5. Old `stop_issuing_at + 86460`以降かつold tokenが全失効した後、old entryを`RETIRED`へ変更しprivate keyを破棄する。Public entryの`kid`、`x`、timesは永久保持する。

Registryはappend-onlyであり、RETIRED/REVOKED entryの削除、`kid`/`x`の再利用、RETIRED/REVOKEDからの遷移を禁止する。Compromise時だけold keyをREVOKEDへ変更し、全validatorへの反映完了までissuance/ingestをfail closedにする。Private keyとpublic registryを同じartifactへ格納しない。

### 11.4 Telemetry

Telemetry payload contentsはUNTRUSTEDである。Ingest schemaは`member_id`、`api_member_id`、`public_id`、`dataset_id`、`owner_user_id`、`device_id`、`submitted_by_device_id`、`received_at`を深さに関係なくreserved fieldとしてrejectする。Clientの`metadata` objectへserver attributionをmergeしてはならない。

Serverはvalidated Dataset JWTとlive rootsからpayloadとは別のimmutable envelope columnsとして次を付加して保存する。

```text
public_id = JWT.dataset_id
submitted_by_device_id = JWT.sub
received_at = committed upload-ledger `consumed_at`をUTC `YYYY-MM-DDTHH:MM:SS.sssZ`へformatした値
```

この3値を`IdentityEnvelopeV1`と呼ぶ。Stage 2はsuccessful `consume_dataset_upload_v1`が返した`consumed_at`だけを`received_at`へ使用し、request clockから再生成しない。SerializerはまずそのTIMESTAMPTZ instantをUTCへ変換し、UTCの4桁year、2桁month、2桁day、`T`、2桁hour、2桁minute、2桁second、`.`、`consumed_at`のmillisecondを3桁decimal、`Z`の順にASCII bytesへ出力する。出力は正規表現 `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$` に一致し、offset、locale、rounding、追加fraction、`Date` object経由の再解釈を許可しない。`consumed_at`はmillisecondへ切り捨て済みなのでserializerは再度丸めない。Queueを使うrouteのmessageはexact top-level shape `{"content_sha256":"<base64url-32>","identity":<IdentityEnvelopeV1>,"ingest_id":"<uuidv4>","payload":<validated route payload>,"route":"<closed route ID>","version":1}`とし、identity objectのexact fieldsは`public_id`、`received_at`、`submitted_by_device_id`だけである。Route IDはendpoint順に`FLEET_SNAPSHOT`、`BATTLE_DATA_UPLOAD`、`QUEST_TREE_INGEST`、`REMODEL_DATA_INGEST`、`SHIP_GROWTH_INGEST`、`SOKU_SPEED_OBSERVED_INGEST`とする。`ingest_id`はSection 9.8 ledger由来でありclient payloadから読まない。

Target storage contractは次である。

1. New Turso hot tablesは`ingest_id TEXT NOT NULL`、`record_ordinal INTEGER NOT NULL`とIdentityEnvelopeV1の3列を持ち、Queue messageからexplicit column listでINSERTする。`UNIQUE(ingest_id, route_id, record_ordinal)`を持ち、Legacy `dataset_id`/`uploaded_by`/`timestamp`をauthority fallbackに使わない。
2. Direct D1 tablesは同じingest/ordinal/identity列とUNIQUEを持つ。Compaction/block-index D1 rowはobject locatorと`public_id`を持つが、aggregate内全recordのdevice authorityとは扱わない。
3. Avro target schemaの各client-derived recordは`ingest_id`、0-based `record_ordinal`、IdentityEnvelopeV1をserver-owned record wrapperに持つ。複数device/datasetを含み得るR2 objectではper-record wrapperがauthorityであり、single deviceをR2 object metadataへ代表値として書かない。
4. Non-Avro JSON R2 objectのuncompressed bodyはexact RFC 8785 `{"content_sha256":"<base64url-32>","identity":<IdentityEnvelopeV1>,"ingest_id":"<uuidv4>","payload":<validated JSON>,"route":"<route ID>","version":1}`である。Gzipを使う場合もdecompression後bytesをこのcanonical bodyと一致させるが、body内の`content_sha256`はStage 2 input bytesのdigestをcopyした値であり、canonical bodyまたはgzip wrapperへ再計算しない。Envelopeを持たないdirect binary objectをv1 routeから保存してはならない。
5. R2 metadataはdirect objectなら`identity_epoch`、`ingest_id`、schema fingerprint、content digest、aggregate objectなら`identity_epoch`、schema fingerprint、content digestだけをserver生成し、client metadataをmergeしない。
6. Queue/Turso/D1/Avro/R2 serializerはidentity/ingest fieldsをpayloadから読まず、missing/extra/mismatchをinternal invariant failureとしてwriteを停止する。

Cloudflare Queueのat-least-once deliveryを前提とする。同じ`ingest_id`/route/ordinal/content digestの再配信は各sinkでno-op、同じkeyの値/digest不一致はcorruptionとしてackせずalertする。Consumerは全required sinkがinsert済みまたはexact-match no-opを返した後だけmessageをackする。途中failureは同じmessage/`ingest_id`を再実行してmissing sinkだけを収束させる。Direct R2 writeはdeterministic keyに`If-None-Match: *`を使い、既存時はbody digest exact matchだけをsuccessとする。

この規則を適用するpublic endpointsとowning schemasは次のclosed setである。

```text
POST /api/fleet/snapshot                 -> src/server/schemas/fleet.ts
POST /api/battle-data/upload             -> src/server/schemas/battle-data.ts
POST /api/quest-tree/ingest              -> src/server/schemas/quest-tree.ts
POST /api/remodel-data/ingest            -> src/server/schemas/remodel-data.ts
POST /api/ship-growth/ingest              -> src/server/schemas/ship-growth.ts
POST /api/soku-speed-observed/ingest      -> src/server/schemas/soku-speed.ts
```

各routeはparse前のduplicate-key detectorとschemaのreserved-field rejectを通し、storage DML/Queue message/R2 metadataではserver envelopeを明示的な列/field listで書く。Object spread、recursive merge、client metadataのpass-throughを禁止する。新しいdataset-bearing ingest routeはこのclosed setとcross-route substitution testsを同じchangeで更新しなければならない。

Target route の required sink は次の閉じた表である。`HTTP sink` は Stage 2 の CAS commit 後に直接収束させる sink、`downstream sink` はその HTTP sink が Queue の場合に同じ `ingest_id` で consumer が収束させる sink である。表にない sink、現行legacy handlerの偶発的な書込み先、cache invalidation は required sink ではない。

| Route ID | Target owning schema path | HTTP sink | Downstream sink |
| --- | --- | --- | --- |
| `FLEET_SNAPSHOT` | `src/server/schemas/fleet.ts` | `fleet-bucket-target` R2 | — |
| `BATTLE_DATA_UPLOAD` | `src/server/schemas/battle-data.ts` | `compaction-queue-target` Queue | `battle-bucket-target` R2 via `fusou-workflow` |
| `QUEST_TREE_INGEST` | `src/server/schemas/quest-tree.ts` | `quest-index-target` D1 | — |
| `REMODEL_DATA_INGEST` | `src/server/schemas/remodel-data.ts` | `remodel-index-target` D1 and `ship-growth-bucket-target` R2 | — |
| `SHIP_GROWTH_INGEST` | `src/server/schemas/ship-growth.ts` | `ship-growth-index-target` D1 and `ship-growth-bucket-target` R2 | — |
| `SOKU_SPEED_OBSERVED_INGEST` | `src/server/schemas/soku-speed.ts` | `soku-index-target` D1 | — |

The named schema paths are target ownership paths and must be strict replacement implementations before traffic is enabled; the currently checked-in legacy handlers and schemas are not normative. The target manifest must contain this exact route-to-sink table, and a route is successful only after its listed HTTP sinks converge. A Queue consumer must additionally satisfy its downstream sink contract before acknowledging the message.

v1 が保証する「who」は bearer credential の `device_id`、「which dataset」は `public_id` である。Payload の出来事の真正性、現在の Game session、token を使用した物理端末は保証しない。

---

## 12. Migration Specification

### 12.1 Baseline

Fresh DB は repository の全既存 migration を順番に適用した後、本節の migration を適用する。既存 migration を飛ばした独立 bootstrap を想定しない。Existing DB は実在する最新baseline `20260825010000_provider_tokens_acl_hardening.sql` まで適用済みであることをpreflightで確認する。

新規PostgreSQL migration fileは次の2 filesに固定する。Profile、registry、evidence、storage manifest、executor、およびSection 12.7で指定する別のTurso bootstrap SQLはこの2 filesの件数に含めない。Turso bootstrapはPostgreSQL migration fileではない。

```text
packages/FUSOU-WEB/supabase/preflight/tlsn_identity_preflight.sql
packages/FUSOU-WEB/supabase/migrations/20260831010000_tlsn_identity_cutover.sql
```

Preflight fileは`BEGIN TRANSACTION READ ONLY -> checks/report -> ROLLBACK`だけを行う。Cutover fileはpreflight checksを先頭で再実行し、`BEGIN`から`COMMIT`まで1個のtop-level transactionで全DDL/DML/postflightを行う。Transaction controlを行うprocedure、`CREATE INDEX CONCURRENTLY`、外部network/storage mutationを含めない。別commitの段階migrationへ分割してはならない。

Production cutoverはSection 12.7 Step 1の独立edge blockとStep 2のproducer/cron/consumer barrierを維持し、Step 4のrestore test後にだけ実行する。P0-17 reportはPostgreSQLへ接続可能な全writer role/applicationを列挙する。Migration connection以外について、列挙したwriterのwrite-attempt logが0で、`pg_stat_activity`の`xact_start IS NOT NULL`なsessionが0であることを確認する。Idle pool connectionは許可するが、unknown application/roleまたはidle-in-transactionを含むopen transactionがあれば停止する。Transaction開始後、`pg_advisory_xact_lock(1179997099, 0)`を取得し、次のexisting tablesを記載順の単一`LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`でlockしてからpreflight checksを再実行する。Lock取得完了をDB内の最終no-concurrent-writer barrierとする。

```text
public.anon_sync_nonce_consumptions
public.anon_sync_rate_limits
public.member_id_mapping
public.pending_member_syncs
public.user_devices
public.user_member_map
public.web_user_member_map
```

これによりpreflight再検査とDDL/DMLの間にlegacy writerやRLS readが割り込まない。Lock timeoutは10秒で、取得失敗時はtransaction全体をabortしtraffic blockを維持する。

### 12.2 Preflight: mutation より前

Preflight は永続 domain data を変更しない。次の不整合を検出したら `RAISE EXCEPTION` で停止する。

1. 必須 schema/table/column/function/extension、baseline migration versionの欠落。
2. noncanonical/duplicate `api_member_id`、duplicate `public_id`。
3. duplicate non-null device key。複数 device が同じ `public_id` を持つことは正常であり reject しない。
4. mapping、auth user に対する orphan device/projection。
5. purge candidate (`public_id IS NULL OR device_pubkey IS NULL`) を参照する全 FK dependency。
6. `user_devices.pubkey_algo <> 'ed25519'`、invalid key length、invalid UUID variant/version。
7. Partial TLSNotary table/function/role/domainが既に存在する状態。
8. projection の duplicate `public_id`、または`user_member_map`/`web_user_member_map`のtarget外column shape。
9. Migration operatorがrole作成、`auth.users`/`auth.identities`への限定grant、table ownership transferを実行できない状態。

### 12.3 Composite FK dependency query

FK の child/parent column は `conkey` と `confkey` を同じ ordinality で pair にする。Constraint ごとに全 pair を `AND` で連結する。

```sql
SELECT
  con.oid,
  child_ns.nspname AS child_schema,
  child_rel.relname AS child_table,
  con.conname,
  string_agg(
    format('d.%I = u.%I', child_att.attname, parent_att.attname),
    ' AND ' ORDER BY pair.ord
  ) AS join_predicate
FROM pg_constraint AS con
JOIN pg_class AS child_rel ON child_rel.oid = con.conrelid
JOIN pg_namespace AS child_ns ON child_ns.oid = child_rel.relnamespace
CROSS JOIN LATERAL ROWS FROM (
  pg_catalog.unnest(con.conkey),
  pg_catalog.unnest(con.confkey)
) WITH ORDINALITY
  AS pair(child_attnum, parent_attnum, ord)
JOIN pg_attribute AS child_att
  ON child_att.attrelid = con.conrelid
 AND child_att.attnum = pair.child_attnum
JOIN pg_attribute AS parent_att
  ON parent_att.attrelid = con.confrelid
 AND parent_att.attnum = pair.parent_attnum
WHERE con.contype = 'f'
  AND con.confrelid = 'public.user_devices'::regclass
GROUP BY con.oid, child_ns.nspname, child_rel.relname, con.conname;
```

各 result に対して次を `format(%I, %I, %s)` で実行する。Schema/table identifier は `%I`、catalog から生成した predicate だけを `%s` に渡す。

```text
SELECT EXISTS (
  SELECT 1
  FROM <quoted child schema>.<quoted child table> AS d
  JOIN public.user_devices AS u ON <paired join predicate>
  WHERE u.public_id IS NULL OR u.device_pubkey IS NULL
)
```

Dependency が1件でもあれば DELETE 前に停止する。`ON DELETE CASCADE` でも自動削除しない。

### 12.4 Atomic cutover order

Cutover transaction内の順序を固定する。

Cutover transactionはStep 1のlock取得後にDB timestampを一度だけ`cutover_v_db_now`として取得し、以後の全legacy lifecycle normalizationとreport timestampに再利用する。client時刻やstatementごとのclock readを使用しない。

1. Advisory lockとSection 12.1のfixed-order `ACCESS EXCLUSIVE` locksを取得し、Section 12.2 preflightを再実行する。
2. `fusou_identity_owner`、`fusou_identity_auditor`、`public.fusou_uint64`を作り、必要最小限の`auth` read grantを設定する。
3. 旧RPCのEXECUTEをrevokeする。`DROP POLICY IF EXISTS user_member_map_select_own ON public.user_member_map`と`DROP POLICY IF EXISTS user_devices_select_own ON public.user_devices`を実行し、この時点で存在する`member_id_mapping`、`user_devices`、両projectionの全direct privilegeを`PUBLIC`、`anon`、`authenticated`、`service_role`からrevokeする。未作成の`claim_challenges`、`member_ownership`、`member_identity_claims`を参照してはならず、それらはStep 12の各`CREATE TABLE`直後に同じREVOKEを行う。
4. `supabase_realtime`から`pending_member_syncs`を外し、`web_user_member_map`、`user_member_map`を全削除する。
5. Section 12.3を全FKへ実行してdependency 0件を再確認し、`DELETE FROM public.user_devices WHERE public_id IS NULL OR device_pubkey IS NULL`だけを実行する。Affected row countをreportし、同predicateが0件になったことをassertする。
6. `device_pubkey`を`device_public_key`へrenameし、nullable lifecycle columnsを追加する。
7. 全legacy deviceを`device_status='REVOKED'`、`revoked_at=COALESCE(revoked_at, cutover_v_db_now)`、`revoked_reason=COALESCE(NULLIF(revoked_reason,''), 'legacy_unverified')`へnormalizeする。`pending_expires_at`と`verified_at`はNULLにする。
8. `user_devices_public_id_key`、`user_devices_algo_known`、`pubkey_algo`、旧active index、`user_devices_canonical_user_id_fkey`をこの順でdropする。Canonical-user FKを`ON DELETE RESTRICT`で再作成する。
9. `chk_member_id_mapping_api_member_id`をtarget regexへ置換する。`uq_member_id_mapping_api_member_id_public_id`を追加する。
10. Device target CHECK、global key UNIQUE、`uq_user_devices_device_public_owner`、status別indexesを追加し、全constraintをvalidateする。
11. `user_member_map_pkey`をdropして`PRIMARY KEY (user_id, public_id)`を同名で追加する。既存`UNIQUE(public_id)`を保持する。`web_user_member_map`の既存composite PKと`UNIQUE(public_id)`を検証する。
12. `attestation_sessions -> claim_challenges -> member_ownership -> member_identity_claims -> dataset_upload_ledger_v1`の順でcreateする。各child FKより先にmapping/device parent UNIQUEとSession composite UNIQUEが存在しなければならない。各table作成直後にSection 9.9のREVOKE/ownerを適用する。
13. Immutable/lifecycle/append-only triggers、internal helpers、entry functionsを作成する。既存4 root/projection tablesと`public.member_id_mapping_id_seq`を含む全identity relation/sequence、new tables、trigger/helper/entry functionsを`fusou_identity_owner`へ移管する。各object作成直後にowner/revoke/grantを適用する。
14. Projectionはownershipから再構築する。このcutoverではlegacy ownershipを作らないため両projectionは0件でなければならない。
15. 旧anonymous authority objectsをdropする。
16. Catalog、owner、ACL、RLS policy absence、constraint validation、0件projection、legacy object absenceのpostflightを実行する。`attestation_sessions`のrow-shape/lifecycle/composite UNIQUEとSession/Challenge composite FK、Session単独expiry cleanupをassertする。`aclexplode`/`has_*_privilege`で4 application rolesにtable/sequence direct privilegeがなく、`service_role`がSection 10.5のclosed entry function setとexact signatureだけをEXECUTEできることをassertする。

Phase 0がliteral`N`とprofile hashを固定する前にcutover fileをcommit・applyしてはならない。Legacy deviceへrandom `public_id`やfake keyを設定せず、TLSNotary proofなしでVERIFIEDへbackfillしない。`auth.users`と`member_id_mapping`は保持するが、anonymous accountをownershipへ移行しない。

### 12.5 Legacy authority removal

Step 15は依存trigger/functionを先にdropし、次をexact signature/nameで除去する。

```text
rpc_register_public_id(text)
rpc_get_registered_public_id(text)
rpc_register_user_device(uuid, text)
rpc_consume_anon_sync_rate_limit(text, integer, integer)
pending_member_syncs table, policies, indexes, publication membership
anon_sync_nonce_consumptions table and refresh-result columns/functions
anon_sync_rate_limits table
user_member_map_select_own policy
user_devices_select_own policy
old anonymous-sync grants, triggers, policies, publication entries
```

`member_id_mapping` 自体は保持する。旧 self-reported mapping は新 Claim が同じ verified member ID を提示したときに同じ `public_id` を返すが、旧 device/projection は authority を持たない。

### 12.6 Fresh DB / Existing DB acceptance

Fresh DB test は空の PostgreSQL/Supabase test instance に repository 全 migration を適用し、target catalog と smoke Claim を検証する。

Existing DB test fixture は次を含む。

1. canonical mapping と複数 legacy devices。
2. revoked device。
3. legacy projections。
4. NULL purge candidate を持つ旧 schema variant。
5. valid/invalid FK dependency variants。
6. duplicate/invalid data variant。

Preflight failure fixtureはmutation前後のtable checksumが同一でなければならない。Cutoverの各logical stepへtest-only forced failureを挿入し、全table/catalog checksumとlegacy RPC availabilityがtransaction開始前と同一へrollbackすることを検証する。成功後は4 roots、Attestation Session、Challenge、projection、roles、ACL、function owner/search_path/signature、FK action、validated constraintをcatalog assertionする。

### 12.7 Legacy identity epoch storage cutover

旧self-report epochの`public_id`を含むrow/objectと、それらを入力にしたaggregateは、新しいverified identityへ継承しない。Lineageを完全復元できないためrow単位deleteは禁止し、identity-derived resource全体を空の`tlsn-v1`世代へ交換する。

現行`docs/sql/turso/migration_0001_create_buffer_tables.sql`はlegacy backup/restore検査専用であり、target bootstrapへ使用しない。Target Tursoのauthoritative artifactは新規`docs/sql/turso/migration_0002_tlsn_identity_epoch_v1.sql`で、empty dedicated-group databaseだけへ適用する。`buffer_logs_active`と`buffer_logs_processing`はexactly同じ次のcolumns/constraintsを持つ。

```text
id INTEGER PRIMARY KEY AUTOINCREMENT
ingest_id TEXT NOT NULL
route_id TEXT NOT NULL CHECK (route_id IN ('FLEET_SNAPSHOT', 'BATTLE_DATA_UPLOAD', 'QUEST_TREE_INGEST', 'REMODEL_DATA_INGEST', 'SHIP_GROWTH_INGEST', 'SOKU_SPEED_OBSERVED_INGEST'))
record_ordinal INTEGER NOT NULL CHECK (record_ordinal >= 0)
content_sha256 TEXT NOT NULL CHECK (length = 43, strict base64url-32)
public_id TEXT NOT NULL
submitted_by_device_id TEXT NOT NULL
received_at TEXT NOT NULL CHECK (UTC YYYY-MM-DDTHH:MM:SS.sssZ)
table_name TEXT NOT NULL
period_tag TEXT NOT NULL DEFAULT 'latest'
table_version TEXT NOT NULL
timestamp INTEGER NOT NULL
data BLOB NOT NULL
created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
UNIQUE (ingest_id, route_id, record_ordinal)
```

`timestamp`と`data`はuntrusted payload contentでありauthorityではない。各tableはordering index `(table_version, table_name, period_tag, public_id, id)`とhot index `(public_id, table_name, timestamp)`を持つ。Swap/recreate pathもこのartifactのliteral DDLを使用し、legacy `dataset_id`、`uploaded_by`、`trust_tag` columnsを再作成してはならない。P0-17はこのfileからfresh targetを作り、fingerprint profileとruntime insert/select/swap smokeを通す。

Required manifest artifact（現行repositoryには未作成）は`packages/FUSOU-WEB/scripts/manifests/tlsn-identity-storage-v1.json`、executorは新規`packages/FUSOU-WEB/scripts/cutover-tlsn-identity-storage.mjs`である。既存no-op `purge-d1-member-data.mjs`は削除する。ManifestはRFC 8785 canonical JSONのexactly次のtop-level shapeを持つ。

```json
{"bindings":[],"epoch":"tlsn-v1","generation_id":"<uuidv4>","legacy_resources":[],"preserved_resources":[],"queue_consumers":[],"target_resources":[],"transitions":[],"version":1}
```

Resource arrayは物理resourceだけ、`bindings`はpackage alias、`queue_consumers`はbinding名を持たないconsumer registration、`transitions`はdestructive legacy-to-target mappingだけを表す。同じ物理resourceを複数bindingが参照してよい。全entryはunknown/duplicate fieldを拒否し、resourceは`ref`昇順、binding/consumerは`package`、`binding`または`script_name`の順、transitionは`from_resource_ref`昇順、`modes`はASCII昇順とする。Top-level `generation_id`はCSPRNG UUIDv4で、initial cutover/recoveryごとに新規生成する。

Resource entryはkindごとにexactly次のshapeを持つ。Property orderはRFC 8785出力順である。

```text
d1:    {"expected_schema_sha256":"<lowercase-hex-64>","kind":"d1","locator":<d1-locator>,"ref":"<ref>"}
kv:    {"expected_keyspace":["<prefix>"],"kind":"kv","locator":<kv-locator>,"ref":"<ref>"}
queue: {"expected_configuration_sha256":"<lowercase-hex-64>","kind":"queue","locator":<queue-locator>,"ref":"<ref>"}
r2:    {"expected_keyspace":["<prefix>"],"kind":"r2","locator":<r2-locator>,"ref":"<ref>"}
turso: {"expected_schema_sha256":"<lowercase-hex-64>","kind":"turso","locator":<turso-locator>,"ref":"<ref>"}
```

`action`はresourceでなくtransitionにだけ存在する。`ref`は3 resource arrays全体でuniqueな`^[a-z0-9][a-z0-9._-]{0,63}$`、`kind`は`d1 | kv | queue | r2 | turso`である。`expected_keyspace`はUTF-8 key prefixのbytewise昇順unique arrayで、`""`は全key、empty arrayはbusiness key 0件を表す。Target R2 markerはbusiness keyから除外する。Executorは全live keyをpagination終了まで列挙し、legacy/preservedではexactlyいずれかのprefixにmatch、targetでは0件であることを要求する。

D1/Turso schema fingerprintは新規`packages/FUSOU-WEB/scripts/fingerprint-storage-schema.mjs`だけが生成する。ScriptはSQLite `sqlite_schema`の`sql IS NOT NULL`なtable/index/trigger/viewを取得する。P0-17 artifact `docs/security/evidence/storage-epoch-v1/schema-fingerprint-profile-v1.json`はexact `{"resources":[{"business_objects":[{"name":"<exact>","type":"<index|table|trigger|view>"}],"provider_owned_objects":[{"name":"<exact>","type":"<index|table|trigger|view>"}],"ref":"<d1-or-turso-ref>"}],"version":1}`である。Resourcesはref、object arraysはtype/nameのASCII bytewise lexicographic昇順でduplicateなしとする。全取得objectをexactly一方へ分類し、未分類、両方分類、profile entry未使用を拒否する。Business rowsを`type`、`name`、`tbl_name`のbinary昇順に並べ、exact objects `{"name":"...","sql":"...","table_name":"...","type":"..."}`のRFC 8785 arrayへserializeしたSHA-256を`expected_schema_sha256`とする。Fresh baselineとlive targetで同digestを要求する。

Queue `expected_configuration_sha256`はmanagement APIのexact normalized `{"delivery_delay":<integer>,"message_retention_period":<integer>}`をRFC 8785 serializeしたSHA-256である。一時的な`delivery_paused`、producer list、consumer listをこのdigestへ含めず、それぞれprocedure、`bindings`、`queue_consumers`で検査する。

Provider locatorは次のexact objectとする。

```text
d1:    {"account_id":"<hex>","name":"<exact>","uuid":"<uuid>"}
kv:    {"account_id":"<hex>","id":"<hex>","jurisdiction":"<exact>","title":"<exact>"}
queue: {"account_id":"<hex>","queue_id":"<cloudflare-resource-id-max-32>","queue_name":"<exact>"}
r2:    {"account_id":"<hex>","jurisdiction":"<exact>","marker_key":"__fusou_epoch__/tlsn-v1/<generation_id>.json","marker_sha256":"<lowercase-hex-64>","name":"<exact>"}
turso: {"database_id":"<provider-uuid>","group":"<exact>","hostname":"<lowercase-host>","name":"<exact>","organization":"<exact>"}
```

Cloudflare APIがR2/KV `jurisdiction`を省略した場合はexact String `default`へ正規化する。R2には独立したimmutable bucket IDがないため、account、jurisdiction、exact nameとmanagement credentialで作成したmarker objectのcanonical content digestを一組のidentityとする。Marker contentはRFC 8785 exact `{"epoch":"tlsn-v1","generation_id":"<same-manifest-uuidv4>","version":1}`であり、`marker_sha256`はそのbytesのSHA-256である。Target bucketはこのmarker 1 objectだけを許可し、business key count 0を「empty」と定義する。Turso locatorはmanagement APIが返すdatabase UUIDを必須とし、URL/tokenはmanifestへ記録しない。Target Tursoはlegacyと異なるdedicated groupに作成する。Management APIが上記locatorを返せないresourceはP0-17 FAILである。

Binding entryはexact `{"binding":"<name>","from_resource_ref":"<ref>","modes":["<mode>"],"package":"<package>","to_resource_ref":"<ref>"}`である。Modesは`credential-secret | producer | read | url-secret | write`のclosed set。同一`(package,binding)`を禁止し、from/to refsは同kindで、destructive resourceでは対応transition、preserved resourceでは同じrefを指す。Physical locatorのduplicateはresource arrays全体で禁止するが、binding aliasのduplicate locator参照は許可する。

Queue consumer entryはexact `{"consumer_type":"worker","dead_letter_from_resource_ref":"<ref-or-empty>","dead_letter_to_resource_ref":"<ref-or-empty>","from_consumer_id":"<cloudflare-resource-id-max-32>","from_resource_ref":"<queue-ref>","from_settings":<settings>,"package":"<package>","script_name":"<exact>","to_consumer_id":"<cloudflare-resource-id-max-32>","to_resource_ref":"<queue-ref>","to_settings":<settings>}`である。`settings`はmanagement APIをexact normalizedした`{"batch_size":<integer>,"max_concurrency":<integer-or-null>,"max_retries":<integer>,"max_wait_time_ms":<integer>,"retry_delay":<integer>}`。No DLQはempty String。Management APIのconsumer ID/type/script/queue/DLQ/settings relationをexact照合する。

Transition entryはexact `{"action":"<action>","from_resource_ref":"<legacy-ref>","to_resource_ref":"<target-ref>"}`である。Actionは`EMPTY_DATABASE_REBUILD | EMPTY_NAMESPACE | EMPTY_QUEUE | EMPTY_SCHEMA_REBUILD | MARKER_ONLY_BUCKET`のclosed setで、from/to kind一致を要求する。各legacy/target refはexactly 1 transitionに現れ、preserved refは現れない。

Tursoの`TURSO_DATABASE_URL`と`TURSO_AUTH_TOKEN`はそれぞれmode `url-secret`、`credential-secret`でlegacy/target Turso refsを結ぶ。Release reportにはsecret value/token IDを記録せず、Worker deployment version ID、binding name、runtime self-checkが返すtarget Turso database ID/hostnameだけを記録する。

`TBD`、empty locator、name-only Cloudflare lookup、wildcard account discoveryを禁止する。Executorはlive management APIから全locator、alias、schema/keyspaceを再取得してmanifestとexact一致しなければmutation前に停止する。Scriptはcanonical manifest bytesのSHA-256をoperatorに表示し、`--apply`にはそのdigest、backup report digest、change-ticket IDの3値を要求する。

Legacy -> target mappingは次に固定する。Target locatorはP0-17で作成しmanifestへ確定する。表のbindingは全package aliasを列挙する。

| Physical refs / binding aliases | Legacy name | Target name | Action |
| --- | --- | --- | --- |
| `battle-index-legacy -> battle-index-target` / Web+Workflow `BATTLE_INDEX_DB` | management API canonical name for ID `700f4191-f93c-4db4-873d-d5fee9a901e3` | `dev-kc-battle-index-tlsn-v1` | EMPTY_SCHEMA_REBUILD |
| `quest-index-legacy -> quest-index-target` / Web+Workflow `QUEST_INDEX_DB` | `dev-kc-quest-index` | `dev-kc-quest-index-tlsn-v1` | EMPTY_SCHEMA_REBUILD |
| `remodel-index-legacy -> remodel-index-target` / Web `REMODEL_INDEX_DB` | `dev-kc-remodel-index` | `dev-kc-remodel-index-tlsn-v1` | EMPTY_SCHEMA_REBUILD |
| `soku-index-legacy -> soku-index-target` / Web `SOKU_SPEED_OBSERVED_DB` | `dev-kc-soku-speed-observed` | `dev-kc-soku-speed-observed-tlsn-v1` | EMPTY_SCHEMA_REBUILD |
| `ship-growth-index-legacy -> ship-growth-index-target` / Web `SHIP_GROWTH_DB` | `dev-kc-ship-growth` | `dev-kc-ship-growth-tlsn-v1` | EMPTY_SCHEMA_REBUILD |
| `fleet-bucket-legacy -> fleet-bucket-target` / Web `FLEET_SNAPSHOT_BUCKET` | `dev-kc-fleets` | `dev-kc-fleets-tlsn-v1` | MARKER_ONLY_BUCKET |
| `battle-bucket-legacy -> battle-bucket-target` / Web+Workflow `BATTLE_DATA_BUCKET` | `dev-kc-battle-data` | `dev-kc-battle-data-tlsn-v1` | MARKER_ONLY_BUCKET |
| `ship-growth-bucket-legacy -> ship-growth-bucket-target` / Web `SHIP_GROWTH_ARCHIVE_BUCKET` | `dev-kc-ship-growth-archive` | `dev-kc-ship-growth-archive-tlsn-v1` | MARKER_ONLY_BUCKET |
| `loader-cache-legacy -> loader-cache-target` / Web `DATA_LOADER_CACHE_KV` | management API canonical name for current namespace ID | `dev-kc-data-loader-cache-tlsn-v1` | EMPTY_NAMESPACE |
| `session-legacy -> session-target` / generated Web `SESSION` | P0-17 management inventory | `dev-fusou-session-tlsn-v1` | EMPTY_NAMESPACE |
| `compaction-queue-legacy -> compaction-queue-target` / Web+Workflow producer plus Workflow consumer inventory | `dev-kc-compaction-queue` | `dev-kc-compaction-queue-tlsn-v1` | EMPTY_QUEUE |
| `compaction-dlq-legacy -> compaction-dlq-target` / Web producer plus Workflow consumer inventory | `dev-kc-compaction-dlq` | `dev-kc-compaction-dlq-tlsn-v1` | EMPTY_QUEUE |
| `hot-buffer-legacy -> hot-buffer-target` / Workflow Turso secrets | management API locator for current database/group | dedicated group database `dev-kc-hot-buffer-tlsn-v1` | EMPTY_DATABASE_REBUILD |

`session-target`はtarget KV namespaceとしてP0-17のresource provisioning時にmanagement APIで`dev-fusou-session-tlsn-v1`を作成する。候補のFUSOU-WEB deploymentへ生成対象の`SESSION` bindingを宣言してdeployし、deploymentが返すbinding metadataとKV namespace locator（ID、account、jurisdiction、title）を取得してからmanifestへ記録する。現在のchecked-in `wrangler.toml`に`SESSION`がないことから名前やIDを推測してはならず、生成binding metadataを取得できない場合はP0-17 FAILとする。

R2 identity-derived keyspacesは`dev-kc-fleets: fleets/<legacy-public_id>/...`、`dev-kc-battle-data: <table_version>/<period_tag>/<tier>/<group>/<table>-<index>.avro`（複数datasetを同一objectへcompactionするためbucket全体）、`dev-kc-ship-growth-archive: ship-growth/archive/<period_tag>/<table_version>/...`である。3 legacy bucketsの`expected_keyspace`は空prefix `""`、すなわち全objectをquarantine対象とする。

Preserve allowlistは次の5 physical resources、6 binding aliasesだけである。

```text
assets-bucket / Web ASSETS_BUCKET + ASSET_SYNC_BUCKET: dev-kc-assets
asset-index / Web ASSET_INDEX_DB: dev-kc-asset-index
master-data-bucket / Web MASTER_DATA_BUCKET: dev-kc-master-data, keyspace master_data/
master-data-index / Web MASTER_DATA_INDEX_DB: dev_kc_master_data_index
asset-sync-index / Web ASSET_SYNC_INDEX_KV
```

The manifest binding cardinality `24` is the exact count of `(package,binding)` pairs below, not a count of physical resources. Preserve aliases are 6: `FUSOU-WEB/ASSETS_BUCKET`, `FUSOU-WEB/ASSET_SYNC_BUCKET`, `FUSOU-WEB/ASSET_INDEX_DB`, `FUSOU-WEB/MASTER_DATA_BUCKET`, `FUSOU-WEB/MASTER_DATA_INDEX_DB`, and `FUSOU-WEB/ASSET_SYNC_INDEX_KV`. Transition aliases are 18: `FUSOU-WEB/BATTLE_INDEX_DB`, `FUSOU-WORKFLOW/BATTLE_INDEX_DB`, `FUSOU-WEB/QUEST_INDEX_DB`, `FUSOU-WORKFLOW/QUEST_INDEX_DB`, `FUSOU-WEB/REMODEL_INDEX_DB`, `FUSOU-WEB/SOKU_SPEED_OBSERVED_DB`, `FUSOU-WEB/SHIP_GROWTH_DB`, `FUSOU-WEB/FLEET_SNAPSHOT_BUCKET`, `FUSOU-WEB/BATTLE_DATA_BUCKET`, `FUSOU-WORKFLOW/BATTLE_DATA_BUCKET`, `FUSOU-WEB/SHIP_GROWTH_ARCHIVE_BUCKET`, `FUSOU-WEB/DATA_LOADER_CACHE_KV`, `FUSOU-WEB/SESSION`, `FUSOU-WEB/COMPACTION_QUEUE`, `FUSOU-WORKFLOW/COMPACTION_QUEUE`, `FUSOU-WEB/COMPACTION_DLQ`, `FUSOU-WORKFLOW/TURSO_DATABASE_URL`, and `FUSOU-WORKFLOW/TURSO_AUTH_TOKEN`. `FUSOU-WEB/SESSION` is a required generated target alias and is not present in the current checked-in `wrangler.toml`; P0-17 must obtain and record its generated binding metadata before approval. Service bindings such as `COMPACTION_WORKFLOW` and `SHORTENER_SERVICE` are outside this storage binding cardinality. Queue consumer registrations are counted separately as the two `queue_consumers` entries.

`legacy_resources`と`target_resources`は上表13 transitionsの各from/to ref、`preserved_resources`はこの5 refsだけをexactly 1回含む。`bindings`は両表に列挙した24 `(package,binding)` aliases、`queue_consumers`はFUSOU-WORKFLOW script `fusou-workflow`のmain Queue consumerとDLQ consumerの2 entriesだけを含む。ExecutorはFUSOU-WEB/FUSOU-WORKFLOWのchecked-in config、generated Worker binding metadata、Cloudflare/Turso management inventoryを列挙し、storage binding/resource/producer/consumerのmissingまたはextraをmutation前に拒否する。

Quest master、remodel summary、soku observation、ship-growth bounds/caps、battle/quest inference、Turso hot rows、compaction metadataはclient upload由来またはそのaggregateなのでpreserveしない。新D1/Tursoには完全なreproducible baseline migrationを適用し、business row count 0、D1 `foreign_key_check` 0件、schema hash一致を要求する。現行battle D1とTursoの初期schemaがchecked-in migrationsだけでは再現できない場合はP0-17 FAILである。

P0-17はchecked-in `docs/security/evidence/storage-epoch-v1/queue-drain-profile-v1.json`を生成する。Exact shapeは`{"backlog_zero_rounds":3,"consumer_max_wall_seconds":900,"max_initial_delay_seconds":<integer>,"max_retry_delay_seconds":<integer>,"sample_interval_seconds":60,"version":1,"visibility_horizon_seconds":<integer>}`である。`max_initial_delay_seconds`はqueue-level `delivery_delay`とproducer codeの全send `delaySeconds`、`max_retry_delay_seconds`はconsumer `retry_delay`とconsumer codeの全retry `delaySeconds`の各最大値である。非定数またはinventory外のdelay pathはFAILする。各Queue/consumerについて次を計算し、その最大値を`visibility_horizon_seconds`へ固定する。

```text
max_initial_delay_seconds
+ (max_retries + 1) * (consumer_max_wall_seconds + max_wait_time_ms / 1000)
+ max_retries * max_retry_delay_seconds
```

Division結果はceiling integer secondsとする。ProviderのQueue consumer wall limitが900秒でない場合は本仕様をrevisionし、artifact値だけを変更してはならない。

P0-17 preflightはlegacy Turso databaseへ有効なcredentialを使う全deployment/consumerを列挙する。同じcredentialが別databaseまたはinventory外consumerでも使われている場合は、cutover前に別credentialへrotateして再inventoryできるまでFAILする。Target dedicated groupにはfresh database credentialを発行し、legacy credential/tokenを再利用しない。Secret valueはmanifest/reportへ記録しない。

Cross-store procedureは次の順序で、各stepとdigestをappend-only JSON reportへfsyncする。途中失敗はtraffic freezeを維持する。PostgreSQL COMMIT前は同じtarget resources/manifestを再検証してresumeし、COMMIT後またはresource locator変更後は下記forward recoveryを使う。Legacy Queueをpauseした時点からbinding cut替え完了まで、legacy Tursoを含む全storeへのapplication write attempt countは0でなければならない。

**Step 1.** Application codeと独立したCloudflare edge maintenance ruleでIdentity、fleet、battle、quest、remodel、soku、ship-growthの全HTTP ingestを503へ切替え、rule ID、version、有効化時刻を記録する。
**Step 2.** FUSOU-WEB/FUSOU-WORKFLOWをlegacy Queue producer bindingなし、Workflow cronなしのdrain versionへdeployし、両deployment versionとlast enqueue時刻を記録する。Management APIでlegacy Queue/DLQの`producers_total_count=0`を確認する。Main consumerは処理を継続し、DLQ consumerはdeliveryされた各messageをaccess-restricted quarantine objectへ保存し、message ID/body digest/countを記録してからackする。Last enqueueからprofile `visibility_horizon_seconds`以上待ち、両Queueのrealtime `backlog_count=0`を60秒間隔で3回、Queue `WriteMessage` operation 0、consumer error/retry収束、legacy store write 0とともに観測する。次に両legacy Queueの`delivery_paused=true`をmanagement APIで設定し、acknowledged `pause_time`を記録する。Queue drain barrierは`pause_time + 900 seconds`で判定し、その時点でpause前に開始した全invocation（`started_at < pause_time`）がterminal outcomeを持ち、terminal timestampがboundary以下であり、`pause_time`以後のdelivery logとlegacy store writeが0でなければならない。boundary時点でrunning invocationが1件でも残る、またはpause後のdeliveryが1件でもある場合はFAILする。その後consumer registrationsを削除し、producer/consumer count 0と全active deploymentからlegacy queue ID不在を確認する。Metricsだけをexact in-flight証明とは扱わず、producer removal、pause、900秒wall-limit barrier、invocation突合、binding absenceの組をsecurity barrierとする。遅延・hidden messageが残る場合も旧Queue内に隔離しtargetへ移行しない。いずれかのinventory/logを完全に取得できなければFAILする。
**Step 3.** PostgreSQL `pg_dump`、各D1 logical export、3 R2 bucketの全object、KV keys、Turso schemaと`buffer_logs_active`/`buffer_logs_processing`を含む全tableのconsistent logical dumpをaccess-restricted backupへ取得する。File size、SHA-256、D1/Turso table/row count、R2 key/etag/size、KV key count、producer-stop version、Queue metrics/log observation window、quarantine object count/digestをbackup reportへ記録する。Secret/token/valueをreportへ記録しない。
**Step 4.** Backupを別account/projectのstagingへrestoreし、PostgreSQL/D1/R2/KV/TursoとDLQ quarantine objectsのinventory digest一致、read smoke testを実行する。Queue contents自体はrestoreせず、新規staging Queue/DLQにproducer/consumerを接続する前のcreation auditをempty evidenceとする。成功前にdestructive stepへ進まない。
**Step 5.** Section 12.4 PostgreSQL transactionをcommitする。
**Step 6.** Target D1/R2/KV/Queue/DLQ/Tursoがmanifest locatorと一致することを確認する。Target D1/Turso schemaをbootstrapしbusiness tables 0件、KV 0件、R2 object count 1、key/digestがmanifest markerとexact一致することを確認する。Target Queue/DLQは`delivery_paused=true`、manifestのconsumer registrations/settingsだけが存在し、`producers_total_count=0`、creation以後の`WriteMessage` operation 0、realtime backlog 0であることをempty evidenceとする。
**Step 7.** FUSOU-WEBとFUSOU-WORKFLOWの全bindings、queue producer bindings、Turso URL/auth secret references、`CACHE_EPOCH=tlsn-v1`を同じrelease manifestへ切替える。Runtime self-checkは各physical locatorをmanagement API inventoryと照合し、old/new resourceの混在を拒否する。Producer/consumer/target store postflight後にtarget Queue/DLQの`delivery_paused=false`を設定する。ReportはWorker deployment versionとtarget Turso database ID/hostnameを記録する。
**Step 8.** Pausedかつunboundのlegacy D1/KV/Queueをdeleteし、legacy R2の全objectをdelete後bucketをdeleteする。Provider-supported operationでlegacy Turso database credentialを全invalidateしてdatabaseをdeleteし、target dedicated-group credentialが別物で有効なことをruntime self-checkする。Target credentialをinvalidateしてはならない。Deletion不能ならwrite/read IAM deny、secret/binding absence、network denyを確認してquarantineし、release blockerとして残す。
**Step 9.** New epoch smoke uploadを行い、new Turso/Queue/D1/R2だけが変化しlegacy backup/checksumが不変であることを確認してtrafficを再開する。

Step 5 PostgreSQL transactionのCOMMIT前はtransactionをrollbackし、target resourcesをpaused/emptyのまま保持してlocator/marker/schemaを再検証後、同じmanifestでresumeする。Target resourceを変更・削除した場合はCOMMIT前でも新しい`generation_id`、locator、manifest approvalを要求する。COMMIT後かつtraffic再開前のfailureは旧schema/applicationへ戻すrollbackを禁止し、次のforward recoveryだけを許可する。

1. 同一pre-cutover backup generationをfresh isolated PostgreSQL/D1/R2/KV/Turso resourcesへrestoreしてdigestを照合する。
2. 復元PostgreSQLへ同じSection 12.4 cutover transactionを再適用しpostflightを通す。Legacy identity-derived D1/R2/KV/Turso dataは検査用quarantineに残し、active v1へbindしない。
3. Fresh marker-only/empty `tlsn-v1` D1/R2/KV/Queue/Turso resourcesを新しい`generation_id`でprovisionする。新locatorを持つrecovery manifest/releaseを生成し、backup generation digestを参照して別operatorが再承認し、P0-17 validation/postflightを再実行してから全bindingを一括切替する。Pre-failure manifest digestの再利用を禁止する。
4. Full smoke後だけtrafficを再開する。旧self-report route/writer、partial store restore、old/new epoch merge、legacy rowsのv1 importを禁止する。

Traffic再開後はbackup rollbackを行わず、new v1 dataを保持したforward fixまたはincident-specific migrationだけを使う。受入れ後7日でlegacy backupをcryptographic eraseし、削除証跡をreportへ追記する。

---

## 13. Active Code Cleanup と Deployment

### 13.1 Active runtime から削除する symbol/path

次を active source、active route、active schema、generated deploy artifact から除去する。Historical migration text は変更しない。

```text
is_verified
verified_user_id
PRE_REGISTERED
DEVICE_BOUND
member_id_hash
anon_sync_pepper_runtime
anon_sync_pepper_versions
signInAnonymously
ensureCanonicalUserForPublicId
rpc_register_public_id
rpc_register_user_device
pending_member_syncs
TAKEOVER_FROM_LEGACY
```

旧 route は router に登録せず Platform Generic 404 を返す。410 handler、compatibility response、legacy token refresh を残してはならない。

### 13.2 Required implementation areas

```text
packages/FUSOU-PROXY/proxy-https
  - require_info classifier
  - no-retry MPC transport
  - send-state latch
  - post-T3 finalization worker

packages/FUSOU-TLSN-VERIFIER (new package; absent in current repository)
  - pinned TLSNotary profile
  - proof/transcript verification
  - canonical Verifier Result serializer

packages/FUSOU-WEB
  - strict Verifier Result decoder
  - strict HTTP/JSON require_info parser
  - Identity APIs
  - ClaimBindingBytes verifier
  - canonical JWT v1 issuer/validator
  - telemetry server-derived attribution
  - removal of anonymous-sync routes

packages/fusou-auth and FUSOU-APP
  - device key use
  - ClaimBindingBytes serializer
  - v1 credential storage
  - removal of old registration/refresh paths

packages/FUSOU-WEB/supabase/migrations
  - Section 12 atomic cutover migration and real-DB tests

docs/sql/turso/migration_0002_tlsn_identity_epoch_v1.sql
  - empty target hot-buffer schema from Section 12.7
  - active/processing swap-safe indexes and constraints
```

### 13.3 Deployment order

```text
1. Complete evidence/profile gates P0-01..05 and auth/privacy gates P0-13..15
2. Build immutable proxy/verifier/web/app, migration, manifest, and executor candidates
3. On the pinned staging environment, complete P0-06..10, the P0-11 candidate migration suite, and P0-16 rotation/revoke rehearsal
4. Read production PostgreSQL version/extensions without mutation; select that exact immutable OCI image, rerun the full migration/test suite, and mark P0-11 PASS
5. Provision target D1/R2/KV/Queue/Turso resources and complete the P0-17 rehearsal
6. Block all old/new Identity and identity-derived ingest traffic
7. Stop old writers/Workflow cron and complete Section 12.7 Queue quiescence plus legacy Queue/DLQ quarantine
8. Create and restore-test the coordinated PostgreSQL/D1/R2/KV/Turso backup generation
9. Restore that generation to staging and run read-only preflight plus cutover/postflight
10. Run production read-only P0-12 preflight and archive its non-secret provisional report; do not mark PASS yet
11. Apply the single 010000 cutover transaction, repeat P0-12 checks under table locks, then mark P0-12 PASS
12. Switch every D1/R2/KV/Queue/Turso binding or secret reference to `tlsn-v1` and run cross-store postflight
13. Deploy Dedicated Verifier, FUSOU-WEB with old routes absent, and proxy/app profile v1 while traffic remains blocked
14. Deploy the production JWT registry/private-key generation, complete rotation/revoke checks, then mark P0-16 PASS
15. Run production end-to-end smoke and verify all P0-01..17 evidence artifacts
16. Destroy/quarantine legacy resources and enable traffic only when every Gate is PASS
```

Migration途中のDBへ old/new Application を接続しない。Old write path と new write path の dual operation を禁止する。

### 13.4 Failure recovery and rollback boundary

1. Phase 0 failure: code/schema rolloutを開始しない。
2. Cutover `COMMIT`前のfailure: 単一transactionをrollbackし、traffic blockを維持、原因を修正してbackup restore環境のdry runから再開する。
3. Cutover `COMMIT`後かつtraffic再開前のfailure: maintenance modeを維持し、Section 12.7のforward recoveryを実行する。Restore直後のpre-cutover schemaへtarget applicationを接続せず、Section 12.4再適用とpostflight後のschemaだけをrecovery manifestへbindする。
4. Traffic再開後のfailure: new v1 dataを保持するforward fixまたはincident-specific migrationだけを使う。Production instance上のdown migration、backup rollback、partial restore、旧authorityの再有効化、epoch混在を禁止する。

### 13.5 Privacy と Observability

Log に `api_member_id`、revealed response bytes、game token/cookie、nonce、signature、JWT を出力しない。Log は hashed Attestation correlation ID、profile version、stage、error code、duration、upstream send count を持つ。

必須 metrics:

```text
tlsn_require_info_total{stage,outcome}
tlsn_upstream_send_count histogram
tlsn_mpc_response_seconds
tlsn_finalize_seconds
identity_challenge_total{outcome}
identity_claim_total{outcome,claim_type}
identity_owner_conflict_total
dataset_token_validation_total{outcome}
```

Raw revealed bytes は request lifetime 終了時に破棄する。

---

## 14. Test Strategy

### 14.1 Cross-language protocol tests

Rust Prover/Verifier、TypeScript FUSOU-WEB、Rust/TypeScript client serializer は同じ checked-in golden fixtures を使用する。

1. Canonical JSON exact bytes。
2. VerifierResultSignBytes exact hex。
3. ClaimBindingBytes exact hex。
4. Ed25519 valid/invalid signature。
5. noncanonical point、`S >= L`、identity/small-order/torsion inputsのreject。
6. every integer boundary、length overflow、base64url noncanonical form。
7. range overlap/order/decoded-length/transcript-bound failures。
8. profile/purpose/hash/key-window mismatch。
9. full request/response transcript digest mismatchとsafe Request range extraction。
10. JWT header/payload/signing-input/registry canonical bytesをTypeScript/Rustで一致確認。
11. bad Web PKI chain、SNI/certificate/result hostname不一致、allowlist外server、Host mismatch、request body、request trailing bytesをそれぞれreject。

### 14.2 Parser tests

1. valid raw `require_info` capture。
2. duplicate keys at root、`api_data`、`api_basic`。
3. String/member Number mismatch、leading zero、negative、fraction、exponent、17 digits。
4. `api_result != 1`。
5. duplicate/conflicting `Content-Length`/`Transfer-Encoding`、Content-LengthのOWS/sign/leading-zero/overflow、malformed chunking、gzip multi-member/bomb、trailing JSON bytes。
6. target text inside unrelated String/object。
7. missing/intermediate non-object/escaped target key、depth/string/header/count limit。

### 14.3 API と credential tests

```text
valid Bearer plus arbitrary Cookie -> Bearer alone is authoritative
Cookie without Bearer -> AUTHENTICATION_REQUIRED and no DB call
anonymous auth user -> reject in Web and RPC
Session issuance -> 201/OK_NEW, client receives only binding_value and expires_at, duplicate key -> 409 with no new Session
Proof(A) + User B -> reject before Challenge/Claim mutation
Proof(A) + Device B -> reject before Challenge/Claim mutation
Proof(A) + Challenge B -> reject before Claim/device/ownership transition
Proof(A, Session A) rewritten as Session B -> Verifier Result signature or Session equality check rejects
Session binding header missing, duplicated, noncanonical, or moved -> Verifier rejects before Result creation
cross-user Challenge locator -> indistinguishable 404
cross-user invalid-signature consume -> no mutation
Challenge new -> 201/replayed false; exact ACTIVE retry -> 200/replayed true with same IDs/nonce/expiry
expired Challenge -> EXPIRED/TTL_EXPIRED and same Attestation reissue -> 410
invalid signature before expiry -> CONSUMED/INVALID_SIGNATURE and same Attestation reissue -> 409
invalid signature after expiry -> EXPIRED/TTL_EXPIRED and HTTP 410
invalid signature -> linked Challenge and Session transition atomically; standalone expired Session cleanup -> EXPIRED/TTL_EXPIRED
device revoke -> linked active Challenge/Session transition atomically with Challenge DEVICE_REVOKED and Session REVOKED
accepted CONSUMED Challenge -> authority readable for exact Claim replay only
new Claim with Notary/Verifier ACTIVE or VERIFY_ONLY -> accept; RETIRED/REVOKED/missing -> reject before device signature
exact accepted Claim replay with RETIRED Notary/Verifier -> idempotent accept; REVOKED/missing -> reject
Claim new -> 201/replayed false; exact replay -> 200/replayed true with same claim ID/stored claim type/current root state
Social Binding requires google auth.identity and current VERIFIED device
Dataset Token requires explicit Social Binding
EdDSA valid/current key -> accept
HS256, none, unknown/revoked kid, malformed/extra claim -> reject
duplicate registry kid/x, unsorted keys, private/public/registry mismatch -> startup reject
expired/revoked-device/wrong-dataset token -> reject after live-root lookup
old JWT remains valid through VERIFY_ONLY until token expiry; RETIRED tombstone rejects thereafter
future-not_before VERIFY_ONLY key with valid signature -> reject until trusted now reaches activation
normalized comma/additional-whitespace Authorization or X-Dataset-Token -> reject before credential validation
raw duplicate/outer-OWS requests through deployed Worker -> observable normalized behavior matches Section 7.1
oversize plus unauthenticated -> 413; malformed outer JSON plus unauthenticated -> 400
foreign plus expired Challenge -> 404; owned expired plus bad signature -> 410
foreign Social device plus actor lacking Google identity -> 404
Stage 1 accepted then device/key/root revoked -> Stage 2 401 and zero Queue/storage mutation
Upload Token replay -> 409 and zero second mutation
two concurrent Stage 2 requests with one Upload Token -> one CAS OK, one UPLOAD_TOKEN_REPLAY, exactly one first external mutation
CAS commit then injected Queue/storage failure -> ledger remains consumed, client replay is 409, new Stage 1 uses a different ingest_id
```

### 14.4 Real PostgreSQL tests

Mock Supabase client は DB acceptance に使用しない。実 PostgreSQL で次を実行する。

#### Identity

```text
fake client member_id path -> no callable authority
valid verified member_id -> one immutable mapping
same member_id repeated -> same public_id
different member_id -> different public_id
```

#### Device

```text
PENDING -> VERIFIED
PENDING -> REVOKED
VERIFIED -> REVOKED
REVOKED -> transition reject
actor-owned PENDING revoke without ownership -> allowed
same user multiple VERIFIED devices
different user VERIFIED device reject
global duplicate device key reject
PENDING limit concurrent race
```

#### Owner conflict

```text
same owner additional device allowed
different owner with current VERIFIED reject
different owner with only REVOKED devices reject
same historical owner with only REVOKED devices allowed
unverified legacy history without ownership -> INITIAL_VERIFIED; legacy row is not authority
```

#### Challenge / Claim

```text
same Attestation concurrent issuance -> one row and one response identity
same Attestation different binding -> conflict
same device concurrent issuance across Attestations -> one ACTIVE row
same user concurrent issuance across public IDs -> pending quota <= 5
existing device reuse at pending quota -> replay/reuse succeeds; new device -> limit
expired ACTIVE -> EXPIRED and same Attestation cannot create another row
expired PENDING with only terminal Challenge rows -> cleanup selects one retained Challenge ID and revokes the device
invalid signature consume vs valid Claim -> one winner
valid Claim x valid Claim -> one insert/idempotent result
cleanup x Claim -> shared Session/Challenge/device locks; one typed terminal outcome and no accepted expired Claim
cleanup x device pending expiry -> User-quota/Device-key and row locks; no usable ACTIVE artifact
same exact Claim repeated -> idempotent
same Attestation different device/user/public -> reject
Claim x Revoke -> serialized outcomes
Claim x Challenge issuance -> no post-Claim ACTIVE row
Social Binding x Revoke -> serialized, root-consistent outcome
Token subject lookup x Revoke -> serializable authorization outcome
1000 mixed operations -> no deadlock and all lock-order assertions pass
direct DML/EXECUTE as anon/authenticated/service_role -> denied except entry functions
all identity relation/sequence/function owners -> fusou_identity_owner
legacy user_member_map_select_own/user_devices_select_own policies -> absent
fixed ACCESS EXCLUSIVE locks held before cutover recheck
revoked primary pointer plus another VERIFIED device -> state/token authorization remains positive
projection rows tampered by privileged fixture -> root-derived state/token result is unchanged
accepted Claim whose Notary/Verifier key becomes REVOKED -> token issuance and validation reject
upload ledger PRIMARY KEY/nonce UNIQUE, immutable authority columns, consumed_at one-way transition, owner/ACL -> catalog PASS
concurrent upload consume -> exactly one OK with stable millisecond consumed_at and one UPLOAD_TOKEN_REPLAY
stored request/response Range array cardinality 3/1 -> constraint PASS; all other counts reject
```

#### Migration

```text
Fresh DB full chain
Existing DB baseline
legacy rows
invalid legacy rows
preflight failure has zero domain mutation
DDL failure rollback
single-column FK
2-column FK
3-column FK
valid dependency
invalid purge dependency
unrelated FK
multiple FKs to user_devices
quoted schema/table/column identifiers
```

Composite FK detector acceptance は false positive = 0、false negative = 0。

Executable fixtureは`packages/FUSOU-WEB/supabase/tests/tlsn_identity_spec_primitives.sql`である。Fixture自身が`server_version_num = 160015`をassertする。2026-09-01にimage `postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`をdatabase serverとして実行し、UInt64境界、4 lock domains、1/2/3-column FK、valid/invalid dependency、nullable child、same childからのmultiple FK、unrelated FK、quoted schema/table/columnを含む7対象constraintがPASSした。再実行commandは次である。

```bash
CONTAINER=fusou-tlsn-spec-pg
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm --name "$CONTAINER" -d -e POSTGRES_PASSWORD=spec \
  postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
until docker exec "$CONTAINER" sh -c \
  'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres >/dev/null'; do
  docker inspect --format '{{.State.Running}}' "$CONTAINER" | grep -qx true
done
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 \
  < packages/FUSOU-WEB/supabase/tests/tlsn_identity_spec_primitives.sql
```

これはprimitive fixtureのPASSであり、target migrationまたはproduction preflightのPASSを意味しない。P0-11はproduction `SHOW server_version_num`とextension versionsを記録し、対応するimmutable test image digestを`docs/security/evidence/postgres-target-v1.json`へ固定して同じfixtureとmigration suiteを通すまでPHASE-0である。

### 14.5 Gameplay integration tests

Controllable TLS origin は logical request ID ごとの observed request count を記録する。次を実 Proxy transport で fault injection する。

```text
normal MPC success -> write attempts 1, complete origin requests 1
MPC setup failure before send + normal TLS fallback -> attempts 1, complete 1
failure in first write call -> attempts 1, complete 0..1
failure after full request before response -> attempts 1, complete 1
process crash in SEND_COMMITTED -> persisted attempts 1, complete 0..1
response acquired + finalization failure -> attempts 1, complete 1
Verifier failure -> attempts 1, complete 1
DB failure -> attempts 1, complete 1
redirect response -> attempts 1, complete 1, follow count 0, identity rejected
```

全caseでattempt countは`<= 1`、complete origin request countは`<= 1`でなければならず、2以上はprotocol violationである。正常系/pre-send fallback成功系でcomplete countが0ならavailability failureである。Unit mockのsend invocation countだけではNo Re-submission PASSとしない。

### 14.6 Delivery と cross-store tests

```text
Verifier receives authenticated full request; Result exposes only request-line/Host/binding-header ranges
Verifier Result -> Proxy Vec<u8> -> APP base64url -> Web decoded bytes are identical
Result delivery retry never increments Game origin request count
queue full / APP unauthenticated / APP restart -> identity unverified, no upstream replay
manifest unknown/duplicate/mismatched physical locator or binding alias -> apply refuses before mutation
manifest missing/extra transition, any of 24 bindings, either Queue consumer, SESSION rotation, or preserved ref -> apply refuses
manifest from/to kind/action mismatch or Queue consumer ID/script/DLQ/settings mismatch -> apply refuses
schema fingerprint unclassified/missing/extra object or hash mismatch -> apply refuses
R2 marker key/content/generation/digest mismatch -> apply refuses
backup restore inventory digest mismatch -> apply refuses before mutation
target D1/KV/Queue/Turso business data non-empty or R2 has keys other than marker -> apply refuses
failure injection before PostgreSQL COMMIT -> freeze remains; unchanged paused/empty resources resume with same manifest
failure injection after PostgreSQL COMMIT or resource replacement -> new generation/recovery manifest approval; old manifest reuse rejected
Queue drain rehearsal -> producer count 0, visibility horizon plus 3 zero samples, delivery pause, 900-second completion barrier, no unmatched invocation
postflight -> only tlsn-v1 bindings mutate; legacy resources are absent or IAM-quarantined
forward recovery -> restored PostgreSQL is cut over again and all active stores use one empty tlsn-v1 generation; mixed epoch rejected
each of six ingest routes rejects reserved fields at root/nested/duplicate positions
each route persists exact IdentityEnvelopeV1 values derived from JWT/live roots only
queued path preserves exact envelope through Queue -> Turso -> Avro/R2; D1 index is non-authoritative
duplicate Queue delivery -> exact sink values are no-op and acknowledged; same ingest/route/ordinal with different value or digest alerts without ack
archive containing records from two VERIFIED devices for one public_id -> each record retains its own submitted_by_device_id/received_at; object metadata has no representative device
IdentityEnvelopeV1 received_at -> exact committed ledger consumed_at on initial write and every retry/redelivery
Stage 1 success then root/key revoke before Stage 2 -> no Queue/Turso/D1/R2 mutation
cross-route payload under a valid token -> route schema reject with no storage mutation
```

---

## 15. Phase 0 GO Gates

Production trafficは全GateがPASSするまでenableしない。P0-01..10とP0-13..15はcandidate/stagingで完了する。P0-11はproduction PostgreSQL read-only inventory後かつmutable resource変更前に完了する。P0-17はtarget provisioning後かつcutover COMMIT前に完了する。P0-12はread-only結果をprovisional evidenceとし、cutover transactionのtable lock取得後の再検査成功時だけPASSとする。P0-16はstaging rehearsal後、production registry/private keyをtraffic freeze下でdeployして最終PASSとする。

| ID | Gate | PASS artifact |
| --- | --- | --- |
| P0-01 | TLSNotary revision | exact commit、dependency lock、license/security review |
| P0-02 | Attestation ID | official extraction API、golden bytes、literal `N` |
| P0-03 | Authenticated time | `notary_time` source、tamper test、wire fixture |
| P0-04 | Real `require_info` | 各supported Game client build/allowlisted hostでnatural requestを1件以上captureし、Number token、HTTP framing、compression、response sizeをmanifest化 |
| P0-05 | Strict disclosure profile | Dedicated Verifierでfull request + full response認証、500 KiB/16 MiB limit boundary fixture、Resultはexact request-line/Host/binding-headerの3 safe rangesだけ、digest golden fixture |
| P0-06 | T3/T4 delivery lifecycle | Browser response後にsame session finalization、signed ResultのProxy -> APP -> Web byte一致 |
| P0-07 | No FUSOU resubmission | Section 14.5でattempt <= 1、complete <= 1、正常/fallback成功はcomplete = 1、2以上 = 0件 |
| P0-08 | Performance | 固定した同一matched network/origin profileで、pair IDを対応付けたbaseline 1000回とMPC 1000回を完了し、両runの全request outcome、failure count、paired latency sample countをreportする。PASSはbaseline/MPCが各1000回、latency sampleが欠落せずpaired added latency P95 <= 300 ms、かつMPC failure count <= baseline failure count。測定値またはoutcomeが欠落した場合はFAIL |
| P0-09 | Direct topology | Game request streamのpacket/egress-flow manifestでlocal proxyからallowlisted Game Server peerへdirect、FUSOU relay宛Game bytes 0件 |
| P0-10 | Cross-language determinism | JSON/Binary/Claim golden fixtures all exact match。Session binding value、Verifier Result fields、ClaimBindingBytesのSession/nonce/value順序を含む |
| P0-11 | PostgreSQL execution | production `server_version_num`/extensionsとimmutable OCI digestを記録し、target imageでmigration/test suite PASS |
| P0-12 | Existing production preflight | read-only catalog/data report、invalid row count = 0 |
| P0-13 | Non-anonymous auth | Supabase Bearer user identification and anonymous rejection test |
| P0-14 | Login frequency | real clientのsupported build/sessionごとにnatural `require_info` frequency（capture window、login/session event数、Game request count）を記録する。これは閾値を導入しない観測値であり、PASSはreportのsample metadataが完全で、FUSOU/Proxyが生成したGame `require_info` request = 0件であること。Identity API callはこの件数に含めず、metadata欠落または生成requestが1件以上ならFAIL |
| P0-15 | Privacy review | full response disclosure、non-persistence、log redaction承認 |
| P0-16 | JWT key rollout | Ed25519 public registry先行配布、ACTIVE/VERIFY_ONLY/RETIRED tombstone rotation、pre-activation reject、60秒future-skew/expiry境界fixture、全validator rule一致、emergency revoke rehearsal |
| P0-17 | Storage epoch cutover | 13 transitions/24 bindings/2 consumers/SESSIONを含むexact manifest、schema/Queue-drain profiles、backup restore、pause/in-flight barrier、binding/forward-recovery rehearsal |

Gate failure時は fallback実装で Security Goal を弱めず、NO-GO とする。

---

## 16. Specification Traceability

| Source | Authority | Enforcement | Test |
| --- | --- | --- | --- |
| Game response | TLSNotary + Verifier signature | profile/ranges/parser | P0-01..06、parser suite |
| Result delivery | Verifier signature | opaque in-process bytes + Bearer API | delivery byte-identity/retry suite |
| Attestation Session | Authenticated user/device/key and exact binding header | pre-proof issuance, Verifier Result fields, Session/Challenge composite checks | Session lifecycle and Proof Copy adversarial suite |
| verified member ID | FUSOU-WEB parser | no client identity input | client authority test |
| public ID | mapping root | `get_or_create_public_id` | mapping concurrency |
| device | device root | challenge signature/state trigger | device/claim races |
| owner | ownership root | conflict rule/Identity lock | owner conflict suite |
| claim history | claims root | unique Attestation/append-only | replay/privilege tests |
| Social Binding | ownership root | explicit Google identity function | cross-user bind test |
| projection | roots -> projection only | grants/rebuild test | projection tamper test |
| JWT | roots live lookup | exact v1 claims | legacy/revoke tests |
| Telemetry attribution | JWT + roots | server-injected IDs | payload substitution test |
| Migration | ordered files | traffic block/postflight | Fresh/Existing suites |
| Legacy identity data | storage generation manifest | freeze/backup/empty-resource rebind | cross-store failure-injection suite |
| Gameplay | proxy send latch | no retry after send | origin counter suite |

Static self-audit result:

```text
Architecture <-> Security Goal: aligned
Security Goal <-> Threat Model: aligned
Threat Model <-> Enforcement: aligned
State Machine <-> DB: aligned
DB <-> RPC: aligned
RPC <-> API: aligned
API <-> Verifier Result: aligned subject to Phase 0 profile freeze
Verifier Result <-> Canonical Binary: defined subject to literal N
member_id <-> mapping <-> public_id: one authority path
public_id <-> devices <-> ownership: root constraints and locks defined
ownership <-> projections: one-way
roots <-> JWT <-> Telemetry: live validation and server attribution
Migration <-> Fresh/Existing DB: sequence defined; target migration absent
Migration <-> Deployment/Test: acceptance criteria aligned; execution pending
Issue ledger: P0=0, P1=0, P2=0 remaining (historical dispositions: P0=36, P1=58, P2=15)
Phase 0: 0/17 PASS
Runtime implementation: absent
```

---

## 17. FINAL FREEZE AUDIT

```text
FINAL FREEZE AUDIT

Repository:
FUSOU

Specification Revision:
7f847bb2285e95d9b8c310d9527b0fdce5d38622

Reference Baseline:
0d2a85a8c474271ecf6bf7e2cf062365a9608e83

Document:
docs/operations/member-id-preemptive-attack-and-recovery.md

Specification:
DESIGN-COMPLETE

Design Freeze:
MAINTAIN

Implementation:
NO-GO

Phase 0:
0/17 PASS

Specification reconstruction:
PASS

Proof Copy Attack:
PASS

Primary Security Goal:
PASS

Cross-Specification Consistency:
PASS

P0:
0 remaining (36 historical items; all dispositioned)

P1:
0 remaining (58 historical items; all dispositioned)

P2:
0 remaining (15 historical items; all dispositioned)

Automatically fixed:
- Reference Baseline / Specification Revision metadata separation.
- Upload ledger `created_at`/`expires_at` whole-second precision and Upload Token `iat`/`exp` exact alignment.
- Canonical `consumed_at` millisecond precision, rationale, and schema CHECK invariant.

Design dispositions:
Canonical state/ownership rules, RPC authority boundaries, lock order, replay/CAS,
cross-store cutover/recovery, target Turso bootstrap source, and report cardinality

Resolved review items:
P1-01 RESOLVED - Challenge expiry is bounded by `v_db_now`, Session expiry, and
Device pending expiry; Session-expired getter/Claim/cleanup outcomes are explicit.
P1-02 RESOLVED - authenticated FUSOU-WEB Claim handler is the only supported
production caller; `service_role` process provenance is not claimed, and ACL,
caller inventory, registry gate, and B1-B6 remain Phase 0 evidence gates.
P2-01 RESOLVED - Reference Baseline and Specification Revision are separate.
P2-02 RESOLVED - the four Identity Authorization Root tables are explicit.
P2-03 RESOLVED - same-user reuse of a non-REVOKED device key issues a new Session;
terminal Sessions are never reused and ACTIVE Session uniqueness is partial.

Remaining contradictions:
NONE in the canonical specification

Remaining design decisions:
NONE. External facts below are Phase 0 evidence gates, not open design decisions.

Remaining Phase 0 evidence:
P0-01..P0-06 TLSNotary revision/profile, Attestation ID bytes and literal N, authenticated notary_time,
real require_info capture, strict disclosure, and T3/T4 delivery evidence.
P0-07..P0-10 no-resubmission, performance, direct topology, and cross-language determinism evidence.
P0-11..P0-12 target PostgreSQL migration and existing-production preflight evidence.
P0-13..P0-16 non-anonymous auth, login-frequency, privacy, and JWT key lifecycle evidence.
P0-17 storage epoch manifest, resource provisioning, Queue drain, backup/restore, and cutover rehearsal.

Canonical Definitions:
PASS

Protocol Consistency:
PASS

Lock Ordering:
PASS

Authority Boundary:
PASS

Transaction Timestamp:
PASS - field-specific precision derives from one transaction-wide `v_db_now`

Upload Timestamp:
PASS - whole-second ledger/token `iat` and `exp` are exactly aligned

Upload CAS:
PASS - one-way millisecond `consumed_at` CAS; external sinks follow commit

Architecture:
PASS - runtime absent

Security Goal:
PASS - runtime unverified

Threat Model:
PASS - Proof Copy rejection is an explicit v1 MUST; same-user/device proof reuse is outside the stated guarantee

State Machine:
PASS - runtime unverified

State ↔ DB:
PASS - target migration not yet verified

Owner Conflict:
PASS - concurrency suite pending

Device Lifecycle:
PASS - runtime unverified

Challenge Lifecycle:
PASS - runtime unverified

Claim Lifecycle:
PASS - runtime unverified

API ↔ RPC:
PASS - canonical contract and outcome subsets are defined; target RPC implementation is absent

Verifier Protocol:
PHASE-0 - revision and authenticated-time evidence not yet verified

Canonical Serialization:
PHASE-0 - literal Attestation ID length N not yet verified

Parser:
PHASE-0 - real capture and parser fixtures pending

JWT:
PHASE-0 - key registry rotation and live validation not yet verified

Telemetry:
PHASE-0 - route integration and attribution tests pending

PostgreSQL:
PHASE-0 - PostgreSQL 16.15 primitive fixture passed; target migration not yet verified

Composite FK:
PHASE-0 - seven primitive fixture cases passed; production preflight pending

Fresh DB Migration:
PHASE-0

Existing DB Migration:
PHASE-0

Cross-store Cutover:
PHASE-0

Concurrency:
PHASE-0

No Re-submission:
PHASE-0

Gameplay Critical Path:
PHASE-0

Legacy Cleanup:
PHASE-0 - removal set/order specified; executor and evidence absent

Third-party implementation determinism:
PHASE-0 - TLSNotary profile artifact and golden fixtures pending

Overengineering:
PASS - no new architecture, security mechanism, proxy, hash, or recovery mechanism added

Runtime verification:
0/17 Phase 0 gates; PostgreSQL primitive fixture only

Target migration:
PHASE-0 - absent

Production preflight:
PHASE-0 - absent

Runtime implementation:
PHASE-0 - absent

FINAL DESIGN DECISION: FREEZE

FINAL DECISION: FREEZE

IMPLEMENTATION: NO-GO
```
